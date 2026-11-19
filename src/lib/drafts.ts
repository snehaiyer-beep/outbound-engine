import { mutate, newId, now, readStore } from "./store";
import { assertRunning, maybeAutoTrip } from "./safety/kill";
import { REJECT_CATEGORIES, type RejectCategory } from "./types";
import { lintEmail } from "./pipeline/lint";
import { contextFor, prepareOutreach, save } from "./pipeline/run";
import { sendEmail } from "./safety/outbox";
import type { Draft, EmailText, StoreData, Thread } from "./types";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

function load(s: StoreData, draftId: string) {
  const draft = s.drafts.find((d) => d.id === draftId);
  if (!draft) throw new HttpError(404, "Draft not found");
  const company = s.companies.find((c) => c.id === draft.companyId)!;
  const contact = s.contacts.find((c) => c.id === draft.contactId)!;
  return { draft, company, contact };
}

function recordEdit(s: StoreData, draft: Draft, next: EmailText): boolean {
  if (next.subject === draft.subject && next.body === draft.body) return false;
  const { company, contact } = load(s, draft.id);
  s.edits.push({
    id: newId("ed"),
    draftId: draft.id,
    companyId: draft.companyId,
    kind: "edit",
    context: contextFor(company, contact),
    before: { subject: draft.subject, body: draft.body },
    after: next,
    at: now(),
  });
  draft.subject = next.subject;
  draft.body = next.body;
  draft.lint = lintEmail(next.subject, next.body, { firstName: contact.firstName });
  return true;
}

export async function saveDraft(draftId: string, next: EmailText): Promise<Draft> {
  return mutate((s) => {
    const { draft } = load(s, draftId);
    if (draft.status !== "draft") throw new HttpError(409, `Draft is already ${draft.status}`);
    recordEdit(s, draft, next);
    return draft;
  });
}

function addReviewTime(d: Draft, seconds?: number) {
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) d.reviewSeconds = (d.reviewSeconds ?? 0) + Math.min(Math.round(seconds), 3600);
}

export async function rejectDraft(draftId: string, reason: string, category?: string, reviewSeconds?: number): Promise<Draft> {
  const cat = (REJECT_CATEGORIES as readonly string[]).includes(category ?? "") ? (category as RejectCategory) : undefined;
  const why = [cat, reason.trim()].filter(Boolean).join(": ");
  if (!why) throw new HttpError(400, "Pick or write a reason for skipping");
  return mutate((s) => {
    const { draft, company, contact } = load(s, draftId);
    if (draft.status !== "draft") throw new HttpError(409, `Draft is already ${draft.status}`);
    s.edits.push({
      id: newId("ed"),
      draftId,
      companyId: draft.companyId,
      kind: "reject",
      context: contextFor(company, contact),
      before: { subject: draft.subject, body: draft.body },
      reason: why,
      at: now(),
    });
    draft.status = "rejected";
    draft.rejectReason = why;
    draft.rejectCategory = cat;
    addReviewTime(draft, reviewSeconds);
    maybeAutoTrip(s);
    return draft;
  });
}

/** Called only by the "Approve & Send" button's route. */
export async function approveAndSend(draftId: string, final: EmailText, reviewSeconds?: number): Promise<{ draft: Draft; actualTo: string }> {
  const { draft, contact } = await mutate((s) => {
    assertRunning(s);
    const loaded = load(s, draftId);
    if (loaded.draft.status !== "draft") throw new HttpError(409, `Draft is already ${loaded.draft.status}`);
    recordEdit(s, loaded.draft, final);
    return loaded;
  });
  const lint = lintEmail(draft.subject, draft.body, { firstName: contact.firstName });
  if (!lint.ok) throw new HttpError(422, "Draft fails the writing rules; edit it first", lint.issues);

  const threadId = newId("th");
  let log;
  try {
    log = await sendEmail({
      kind: "cold",
      companyId: draft.companyId,
      contactId: draft.contactId,
      intendedTo: contact.email,
      approval: { by: "human" },
      subject: draft.subject,
      body: draft.body,
      threadId,
    });
  } catch (e) {
    const reasons = (e as { reasons?: string[] }).reasons;
    if (reasons) throw new HttpError(409, "Send blocked by safety rules", reasons);
    throw e;
  }

  const updated = await mutate((s) => {
    const d = s.drafts.find((x) => x.id === draftId)!;
    d.status = "sent";
    d.sentAt = log.at;
    addReviewTime(d, reviewSeconds);
    maybeAutoTrip(s);
    d.threadId = threadId;
    const thread: Thread = {
      id: threadId,
      companyId: d.companyId,
      contactId: d.contactId,
      draftId,
      subject: d.subject,
      status: "awaiting_reply",
      proposedSlots: [],
      lastOutboundAt: log.at,
      messageIds: [log.messageId],
      history: [{ at: log.at, text: `Cold email sent to ${log.actualTo}${log.actualTo !== log.intendedTo ? ` (redirected from ${log.intendedTo})` : ""}` }],
    };
    s.threads.push(thread);
    return d;
  });
  return { draft: updated, actualTo: log.actualTo };
}

/** A person qualifies or disqualifies a company by hand (e.g. from the "needs review" pile). */
export async function decideCompany(companyId: string, decision: "qualify" | "disqualify", note: string) {
  const s0 = await readStore();
  assertRunning(s0);
  const company = s0.companies.find((c) => c.id === companyId);
  if (!company) throw new HttpError(404, "Company not found");
  if (s0.sends.some((x) => x.companyId === companyId)) throw new HttpError(409, "This company was already emailed");
  company.decidedBy = "human";
  company.decisionNote = note.trim() || (decision === "qualify" ? "Qualified by a person" : "Disqualified by a person");
  if (decision === "disqualify") {
    company.status = "disqualified";
    await save(company, [], []);
    return company;
  }
  company.status = "qualified";
  const { contacts, drafts } = await prepareOutreach(company);
  await save(company, contacts, drafts);
  return company;
}

export async function companyDetail(companyId: string) {
  const s = (await readStore());
  const company = s.companies.find((c) => c.id === companyId);
  if (!company) throw new HttpError(404, "Company not found");
  return {
    company,
    contacts: s.contacts.filter((c) => c.companyId === companyId).sort((a, b) => b.rankScore - a.rankScore),
    drafts: s.drafts.filter((d) => d.companyId === companyId),
    threads: s.threads.filter((t) => t.companyId === companyId),
    examples: s.edits.filter((e) => s.drafts.some((d) => d.companyId === companyId && d.examplesUsed.includes(e.id))),
  };
}
