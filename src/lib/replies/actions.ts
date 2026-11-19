import { assertRunning } from "../safety/kill";
import { config } from "../config";
import { mutate, newId, now, readStore } from "../store";
import { sendEmail } from "../safety/outbox";
import { getCalendar } from "../services/calendar";
import { getCrm } from "../services/crm";
import { HttpError } from "../drafts";
import type { Action, ActionType, Slot, Thread } from "../types";

export interface SendEmailPayload {
  subject: string;
  body: string;
  proposeSlots?: Slot[];
}
export interface BookPayload {
  slot: Slot;
}
export interface CrmPayload {
  outcome: string;
  note: string;
}

async function threadBits(threadId: string) {
  const s = (await readStore());
  const thread = s.threads.find((t) => t.id === threadId);
  if (!thread) throw new HttpError(404, "Thread not found");
  const contact = s.contacts.find((c) => c.id === thread.contactId)!;
  const company = s.companies.find((c) => c.id === thread.companyId)!;
  return { thread, contact, company };
}

async function updateThread(threadId: string, fn: (t: Thread) => void) {
  await mutate((s) => {
    const t = s.threads.find((x) => x.id === threadId)!;
    fn(t);
  });
}

async function sendInThread(threadId: string, subject: string, body: string, by: "human" | "autopilot") {
  const { thread, contact } = await threadBits(threadId);
  const log = await sendEmail({
    kind: "reply",
    companyId: thread.companyId,
    contactId: thread.contactId,
    intendedTo: contact.email,
    approval: { by },
    subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
    body,
    threadId,
    inReplyTo: thread.messageIds[thread.messageIds.length - 1],
    references: thread.messageIds,
  });
  await updateThread(threadId, (t) => {
    t.messageIds.push(log.messageId);
    t.lastOutboundAt = log.at;
    t.history.push({ at: log.at, text: `Sent "${log.subject}" to ${log.actualTo} (approved by ${by})` });
  });
  return log;
}

/** Queues an outward action. Runs it at once only when AUTOPILOT=true. */
export async function createAction(threadId: string, type: ActionType, summary: string, payload: object): Promise<Action> {
  const action: Action = {
    id: newId("act"),
    threadId,
    type,
    summary,
    payload: payload as Record<string, unknown>,
    status: "pending",
    createdAt: now(),
  };
  await mutate((s) => {
    s.actions.push(action);
  });
  if (config.autopilot()) return executeAction(action.id, "autopilot");
  return action;
}

export async function executeAction(actionId: string, by: "human" | "autopilot"): Promise<Action> {
  const action = await mutate((s) => {
    const a = s.actions.find((x) => x.id === actionId);
    if (!a) throw new HttpError(404, "Action not found");
    if (a.status !== "pending") throw new HttpError(409, `Action is already ${a.status}`);
    assertRunning(s);
    if (by === "autopilot" && !config.autopilot()) throw new HttpError(403, "AUTOPILOT is off");
    a.status = "executed"; // claim it so a double click can't run it twice
    a.approvedBy = by;
    return { ...a };
  });

  let result = "";
  try {
    if (action.type === "send_email") {
      const p = action.payload as unknown as SendEmailPayload;
      await sendInThread(action.threadId, p.subject, p.body, by);
      if (p.proposeSlots?.length)
        await updateThread(action.threadId, (t) => {
          t.status = "slots_proposed";
          t.proposedSlots = p.proposeSlots!;
        });
      result = "Email sent";
    } else if (action.type === "book_meeting") {
      const p = action.payload as unknown as BookPayload;
      const { contact, company, thread } = await threadBits(action.threadId);
      const { bookingId } = await getCalendar().book(p.slot, { name: contact.name, email: contact.email });
      await updateThread(action.threadId, (t) => {
        t.status = "booked";
        t.booking = { slot: p.slot, bookingId };
        t.history.push({ at: now(), text: `Booked ${p.slot.label} (${bookingId})` });
      });
      await sendInThread(
        action.threadId,
        thread.subject,
        `Hi ${contact.firstName},\n\nConfirmed for ${p.slot.label}. A calendar invite is on its way.\n\nBest,\n${config.senderName()}`,
        by,
      );
      result = `Booked ${p.slot.label}`;
      await createAction(action.threadId, "crm_log", `Log meeting booked with ${contact.name} (${company.name}) to CRM`, {
        outcome: "meeting_booked",
        note: `Meeting ${p.slot.label}, booking ${bookingId}`,
      } satisfies CrmPayload);
    } else if (action.type === "crm_log") {
      const p = action.payload as unknown as CrmPayload;
      const { contact, company } = await threadBits(action.threadId);
      const { id } = await getCrm().log({ email: contact.email, company: company.name, outcome: p.outcome, note: p.note });
      await updateThread(action.threadId, (t) => t.history.push({ at: now(), text: `CRM logged: ${p.outcome}` }));
      result = `CRM record ${id}`;
    }
  } catch (e) {
    const reasons = (e as { reasons?: string[] }).reasons;
    const error = reasons ? reasons.join("; ") : (e as Error).message;
    return mutate((s) => {
      const a = s.actions.find((x) => x.id === actionId)!;
      a.status = "failed";
      a.error = error;
      return a;
    });
  }
  return mutate((s) => {
    const a = s.actions.find((x) => x.id === actionId)!;
    a.result = result;
    a.executedAt = now();
    return a;
  });
}

export async function rejectAction(actionId: string, reason: string): Promise<Action> {
  return mutate((s) => {
    const a = s.actions.find((x) => x.id === actionId);
    if (!a) throw new HttpError(404, "Action not found");
    if (a.status !== "pending") throw new HttpError(409, `Action is already ${a.status}`);
    a.status = "rejected";
    a.error = reason || "Rejected by human";
    const t = s.threads.find((x) => x.id === a.threadId);
    if (t) {
      t.status = "needs_human";
      t.needsHumanReason = `Action rejected: ${a.summary}`;
    }
    return a;
  });
}
