"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lintEmail } from "@/lib/pipeline/lint";
import { REJECT_CATEGORIES, type CertHit, type Contact, type Draft, type EditRecord } from "@/lib/types";
import { api, Button, Check, Pill, Section, Spinner } from "./ui";
import { LINT_CHECKS, RULES, THREAD_STATUS, type Detail, type Status } from "./shared";
import type { Toast } from "./Dashboard";

export default function CompanyDetail({
  companyId, status, refresh, setToast,
}: {
  companyId: string; status: Status | null; refresh: () => Promise<void>; setToast: (t: Toast) => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const detail = await api<Detail>(`/api/companies/${companyId}`);
      setD(detail);
      const sent = detail.drafts.find((x) => x.status === "sent");
      setContactId((c) => c ?? sent?.contactId ?? detail.contacts[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [companyId]);
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="text-bad">{error}</p>;
  if (!d)
    return (
      <div className="flex items-center gap-2 text-muted">
        <Spinner /> Loading…
      </div>
    );

  const { company } = d;
  const q = company.qualification;
  const s = company.scrape;
  const good = company.status === "qualified";
  const draft = d.drafts.find((x) => x.contactId === contactId);
  const contact = d.contacts.find((c) => c.id === contactId);
  const sentDraft = d.drafts.find((x) => x.status === "sent");
  const thread = d.threads[0];

  return (
    <div className="space-y-6">
      <a href="#/" className="text-sm text-muted hover:text-ink">← All companies</a>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
        <Pill tone={good ? "good" : company.status === "error" ? "bad" : company.status === "needs_review" ? "warn" : "neutral"}>
          {good ? "Good fit" : company.status === "error" ? "Couldn't check" : company.status === "needs_review" ? "Needs your decision" : "Not a fit"}
        </Pill>
        {company.fit && good && <Pill tone="accent">Priority {company.fit.score}/100</Pill>}
        <a href={`https://${company.domain}`} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
          {company.domain} ↗
        </a>
      </div>

      {(company.description || s?.description) && <p className="-mt-3 max-w-3xl text-ink-2">{company.description || s?.description}</p>}
      {company.decidedBy && <p className="-mt-3 text-sm text-muted">You decided this by hand: “{company.decisionNote}”</p>}
      {company.error && <p className="surface p-4 text-bad">{company.error}</p>}

      {company.status === "needs_review" && q && (
        <DecideBox companyId={company.id} undecided={q.undecided.map((k) => RULES.find((r) => r.key === k)!.question)} onDone={async () => { await load(); await refresh(); }} setToast={setToast} />
      )}

      {thread && (
        <a href="#/conversations" className="flex items-center justify-between rounded-[14px] border border-accent/30 bg-accent-soft px-5 py-3 text-sm">
          <span>
            Email sent to <b>{d.contacts.find((c) => c.id === thread.contactId)?.name}</b>. Status:{" "}
            <b>{THREAD_STATUS[thread.status].label}</b>
          </span>
          <span className="font-medium text-accent">See conversation →</span>
        </a>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="space-y-6 min-w-0">
          {q && (
            <Section title={good ? "Why it's a good fit" : "Why it's not a fit"} hint="We check four things. All four need to be yes.">
              <ul className="space-y-3">
                {RULES.map((r) => (
                  <li key={r.key} className="flex gap-3">
                    <Check ok={q.rules[r.key].pass} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{r.question}</div>
                      <div className="text-sm text-muted">{q.rules[r.key].reason}</div>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted">
                Checked by {q.model.startsWith("mock") ? "built-in rules" : q.model}
                {q.extraPagesFetched.length > 0 && `; it went back for more info (${q.extraPagesFetched.map(prettyPath).join(", ")})`}.
              </p>
            </Section>
          )}

          {good && company.fit && (
            <Section title={`Priority score: ${company.fit.score}/100`} hint="How strongly to go after this one, compared with other good fits.">
              <ul className="space-y-1 text-sm text-ink-2">
                {company.fit.reasons.map((r) => (
                  <li key={r} className="flex gap-2"><span className="text-accent">•</span>{r}</li>
                ))}
              </ul>
            </Section>
          )}

          {s && (
            <Section title="What we found" hint="The evidence behind the checks.">
              <div className="space-y-4 text-sm">
                <Fact label="Pages read">
                  <div className="flex flex-wrap gap-1.5">
                    {s.pages.map((p) => (
                      <span key={p.path} title={p.text.slice(0, 300)} className={`rounded-md px-2 py-0.5 text-xs ${p.ok ? "bg-slate-100 text-ink-2" : "bg-slate-50 text-slate-400 line-through"}`}>
                        {prettyPath(p.path)}
                      </span>
                    ))}
                  </div>
                </Fact>
                <Fact label="Security certificates">
                  {s.certs.visible.length === 0 && s.certs.hidden.length === 0 && <span className="text-muted">None mentioned anywhere on the site.</span>}
                  {s.certs.visible.map((c, i) => (
                    <div key={i}>
                      <b>{c.cert}</b> shown on {prettyPath(c.page)}
                      {c.source === "image" ? " (as a badge image)" : ""}
                    </div>
                  ))}
                  {s.certs.hidden.map((c, i) => (
                    <div key={i} className="mt-1 rounded-lg bg-warn-soft p-2.5 text-warn">
                      <b>{c.cert}</b> {hiddenMeaning(c)} <span className="block mt-1 font-mono text-[11px] text-ink-2 break-all">{c.snippet}</span>
                    </div>
                  ))}
                </Fact>
                <Fact label={`Open jobs (${s.openRoles})`}>
                  {s.jobTitles.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {s.jobTitles.slice(0, 12).map((t) => (
                        <span key={t} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs">{t}</span>
                      ))}
                      {s.jobTitles.length > 12 && <span className="text-xs text-muted">+{s.jobTitles.length - 12} more</span>}
                    </div>
                  ) : (
                    <span className="text-muted">No job list found on the site.</span>
                  )}
                </Fact>
                {s.pages
                  .filter((p) => p.path.startsWith("web:"))
                  .map((p) => (
                    <Fact key={p.path} label={p.path === "web:headcount" ? "Web search: team size" : "Web search: open jobs"}>
                      <p className="text-ink-2">{p.text.replace(/^Web search answer:\s*/, "")}</p>
                    </Fact>
                  ))}
              </div>
            </Section>
          )}
        </div>

        <div className="space-y-6 min-w-0">
          {good && (
            <Section title="Who to email" hint="Ranked by who most likely owns security and compliance.">
              {d.contacts.length === 0 && <p className="text-sm text-muted">{company.contactsNote ?? "No contacts found."}</p>}
              <ul className="space-y-2">
                {d.contacts.map((c, i) => {
                  const cd = d.drafts.find((x) => x.contactId === c.id);
                  const selected = c.id === contactId;
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => setContactId(c.id)}
                        title={c.rankReason}
                        className={`w-full rounded-xl border px-3.5 py-2.5 text-left transition ${selected ? "border-accent bg-accent-soft/60 ring-2 ring-accent-soft" : "border-line hover:bg-slate-50"}`}
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium">{c.name}</span>
                          <span className="text-sm text-muted">{c.position}</span>
                          <span className="flex-1" />
                          {i === 0 && <Pill tone="accent">Best pick</Pill>}
                          {cd?.status === "sent" && <Pill tone="good">Emailed</Pill>}
                          {cd?.status === "rejected" && <Pill>Skipped</Pill>}
                        </div>
                        {selected && <div className="mt-0.5 text-xs text-muted">Why: {c.rankReason}</div>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {good && draft && contact && (
            <EmailEditor
              key={draft.id + draft.status}
              draft={draft}
              contact={contact}
              examples={d.examples.filter((e) => draft.examplesUsed.includes(e.id))}
              otherEmailed={sentDraft && sentDraft.id !== draft.id ? d.contacts.find((c) => c.id === sentDraft.contactId)?.name : undefined}
              status={status}
              onDone={async () => {
                await load();
                await refresh();
              }}
              setToast={setToast}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      {children}
    </div>
  );
}

function prettyPath(p: string): string {
  if (p === "/") return "Homepage";
  if (p === "web:headcount") return "web search: team size";
  if (p === "web:open-roles") return "web search: jobs";
  if (p.includes(":")) return `${p.split(":")[0]} job board`;
  return p.replace(/^\//, "");
}

function hiddenMeaning(c: CertHit): string {
  if (c.source === "html-comment") return `is mentioned only in a hidden note in the page code on ${prettyPath(c.page)}. Visitors can't see it, so an audit may be in progress.`;
  if (c.source === "script") return `appears only in a script on ${prettyPath(c.page)}, not shown to visitors.`;
  return `appears in an image name marked as pending on ${prettyPath(c.page)}.`;
}

function EmailEditor({
  draft, contact, examples, otherEmailed, status, onDone, setToast,
}: {
  draft: Draft; contact: Contact; examples: EditRecord[]; otherEmailed?: string; status: Status | null; onDone: () => Promise<void>; setToast: (t: Toast) => void;
}) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [mode, setMode] = useState<"edit" | "confirm" | "skip">("edit");
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  // Review timer: counts seconds while this email is open and the tab is visible.
  const seconds = useRef(0);
  useEffect(() => {
    if (draft.status !== "draft") return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") seconds.current += 1;
    }, 1000);
    return () => clearInterval(t);
  }, [draft.status]);
  const lint = useMemo(() => lintEmail(subject, body, { firstName: contact.firstName }), [subject, body, contact.firstName]);
  const failed = new Set(lint.issues.map((i) => i.rule));
  const editable = draft.status === "draft";
  const dirty = subject !== draft.subject || body !== draft.body;
  const to = status?.sending.testRecipient || (status?.sending.liveSending ? contact.email : null);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      setToast({ kind: "ok", text: ok });
      setMode("edit");
      await onDone();
    } catch (e) {
      setToast({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (draft.status === "sent")
    return (
      <Section title="Email sent" hint={`Sent ${draft.sentAt ? new Date(draft.sentAt).toLocaleString() : ""}`}>
        <div className="rounded-xl bg-slate-50 p-4 text-sm">
          <div className="font-medium">{draft.subject}</div>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-ink-2">{draft.body}</pre>
        </div>
        <a href="#/conversations" className="mt-4 inline-block text-sm font-medium text-accent">Go to the conversation →</a>
      </Section>
    );

  return (
    <Section
      title={`Email to ${contact.firstName}`}
      hint={draft.status === "rejected" ? `You skipped this one: ${draft.rejectReason}` : "Edit anything you like. The checklist updates as you type."}
      right={editable && dirty ? <Pill tone="warn">Unsaved changes</Pill> : null}
    >
      <div className="space-y-3">
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">
          To: <span className="text-ink">{contact.name} &lt;{contact.email}&gt;</span>
          {to && to !== contact.email && <> · in test mode this goes to <b className="text-warn">{to}</b></>}
        </div>
        <input className="field font-medium" value={subject} disabled={!editable} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
        <textarea className="field h-72 resize-y leading-relaxed" value={body} disabled={!editable} onChange={(e) => setBody(e.target.value)} aria-label="Email body" />
        <p className="text-xs text-muted">A one-line unsubscribe note is added at the bottom when it's sent.</p>

        <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 rounded-xl border border-line p-3">
          {LINT_CHECKS.filter((c) => c.rule !== "subject" || failed.has("subject")).map((c) => (
            <div key={c.rule} className="flex items-start gap-2 text-sm">
              <Check ok={!failed.has(c.rule)} />
              <span className={failed.has(c.rule) ? "text-bad" : "text-ink-2"}>
                {c.label}
                {c.rule === "length" && <span className="text-muted"> ({lint.wordCount})</span>}
              </span>
            </div>
          ))}
        </div>
        {!lint.ok && (
          <ul className="list-disc pl-5 text-xs text-bad">
            {lint.issues.map((i, k) => (
              <li key={k}>{i.message}</li>
            ))}
          </ul>
        )}

        <details className="text-sm">
          <summary className="cursor-pointer text-muted">What {contact.firstName} likely cares about</summary>
          <ul className="mt-2 list-disc pl-5 text-ink-2">
            {draft.painPoints.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {examples.length > 0 && <p className="mt-2 text-xs text-muted">This draft learned from {examples.length} of your earlier edits.</p>}
        </details>

        {editable && otherEmailed && (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">You already emailed {otherEmailed} here. We only email one person per company, so this one can't be sent.</p>
        )}

        {editable && mode === "edit" && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button kind="primary" size="lg" disabled={!lint.ok || busy || !to || !!otherEmailed} onClick={() => setMode("confirm")} title={!lint.ok ? "Fix the checklist first" : ""}>
              Approve & send
            </Button>
            <Button disabled={!dirty || busy} onClick={() => act(() => api(`/api/drafts/${draft.id}`, { method: "PUT", json: { subject, body } }), "Saved. Future drafts will learn from this edit.")}>
              Save changes
            </Button>
            <Button kind="ghost" disabled={busy} onClick={() => setMode("skip")}>
              Skip this person
            </Button>
          </div>
        )}

        {editable && mode === "confirm" && (
          <div className="rounded-xl border border-accent/30 bg-accent-soft p-4">
            <p className="text-sm">
              Send <b>{subject}</b> now to <b>{to}</b>?
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                kind="primary"
                disabled={busy}
                onClick={() => act(() => api(`/api/drafts/${draft.id}/approve`, { method: "POST", json: { subject, body, confirm: true, reviewSeconds: seconds.current } }), `Sent to ${to}`)}
              >
                {busy && <Spinner />} Yes, send it
              </Button>
              <Button kind="ghost" disabled={busy} onClick={() => setMode("edit")}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {editable && mode === "skip" && (
          <div className="rounded-xl border border-line p-4">
            <div className="text-sm font-medium">Why skip? This teaches future drafts and feeds the safety checks.</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {REJECT_CATEGORIES.map((c) => (
                <button key={c} onClick={() => setCategory(c)} className={`rounded-full border px-3 py-1 text-sm transition ${category === c ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-slate-50"}`}>
                  {c}
                </button>
              ))}
            </div>
            <input id="skip" className="field mt-2" placeholder="Anything to add? (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="mt-3 flex gap-2">
              <Button kind="danger" disabled={(!category && !reason.trim()) || busy} onClick={() => act(() => api(`/api/drafts/${draft.id}/reject`, { method: "POST", json: { reason, category, reviewSeconds: seconds.current } }), "Skipped. We'll learn from your reason.")}>
                Skip
              </Button>
              <Button kind="ghost" onClick={() => setMode("edit")}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function DecideBox({ companyId, undecided, onDone, setToast }: { companyId: string; undecided: string[]; onDone: () => Promise<void>; setToast: (t: Toast) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  async function decide(decision: "qualify" | "disqualify") {
    setBusy(decision);
    try {
      await api(`/api/companies/${companyId}/decide`, { method: "POST", json: { decision, note } });
      setToast({ kind: "ok", text: decision === "qualify" ? "Qualified. We found people and wrote drafts." : "Marked as not a fit." });
      await onDone();
    } catch (e) {
      setToast({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="rounded-[14px] border border-amber-200 bg-warn-soft p-5">
      <div className="font-semibold text-warn">The agent couldn't decide this one, so it's your call</div>
      <p className="mt-1 text-sm text-ink-2">
        It looked again (more pages and a web search) but still couldn't answer: <b>{undecided.join(" ")}</b> Rather than guess, it's handing it to you.
      </p>
      <input className="field mt-3 bg-white" placeholder="Why? e.g. I know they have ~40 people (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button kind="primary" disabled={!!busy} onClick={() => decide("qualify")}>{busy === "qualify" && <Spinner />} It's a fit: find people & draft</Button>
        <Button disabled={!!busy} onClick={() => decide("disqualify")}>{busy === "disqualify" && <Spinner />} Not a fit</Button>
      </div>
    </div>
  );
}
