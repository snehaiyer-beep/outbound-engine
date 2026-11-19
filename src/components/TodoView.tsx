"use client";
import { useState } from "react";
import { api, Button, Empty, Pill, Spinner } from "./ui";
import { RULES, type Row, type ThreadsData } from "./shared";
import { ActionCard } from "./ConversationsView";
import type { Toast } from "./Dashboard";

/** Everything waiting on a person, in one place. Nothing here happens until you act. */
export default function TodoView({
  rows, threads, refresh, setToast,
}: {
  rows: Row[]; threads: ThreadsData | null; refresh: () => Promise<void>; setToast: (t: Toast) => void;
}) {
  const [busy, setBusy] = useState("");
  async function act(label: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(label);
    try {
      await fn();
      setToast({ kind: "ok", text: ok });
      await refresh();
    } catch (e) {
      setToast({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy("");
    }
  }

  const decide = rows.filter((r) => r.status === "needs_review");
  const emails = rows.filter((r) => r.status === "qualified" && r.draftsPending > 0 && !r.sent).sort((a, b) => (b.fit?.score ?? 0) - (a.fit?.score ?? 0));
  const pending = threads?.actions.filter((a) => a.status === "pending") ?? [];
  const human = threads?.threads.filter((t) => t.status === "needs_human") ?? [];
  const total = decide.length + emails.length + pending.length + human.length;
  const who = (threadId: string) => {
    const t = threads?.threads.find((x) => x.id === threadId);
    return t ? `${t.contact?.name ?? ""} · ${t.company}` : "";
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">To do</h1>
        <p className="mt-1 text-muted">Everything waiting on you. Nothing here happens until you act.</p>
      </div>

      {total === 0 && <Empty title="All clear">Nothing is waiting on you right now.</Empty>}

      {decide.length > 0 && (
        <Group title="Companies to decide" n={decide.length} hint="The agent looked twice and still couldn't tell, so it didn't guess.">
          {decide.map((r) => (
            <div key={r.id} className="surface flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{r.name} <span className="text-sm font-normal text-muted">{r.domain}</span></div>
                <div className="text-sm text-muted">Couldn't find out: {r.undecided.map((k) => RULES.find((x) => x.key === k)!.label.toLowerCase()).join(", ")}</div>
              </div>
              <a href={`#/company/${r.id}`} className="text-sm font-medium text-accent">See evidence</a>
              <Button kind="primary" size="sm" disabled={!!busy} onClick={() => act("q" + r.id, () => api(`/api/companies/${r.id}/decide`, { method: "POST", json: { decision: "qualify" } }), `${r.name}: qualified, people found and drafts written`)}>
                {busy === "q" + r.id && <Spinner className="h-3.5 w-3.5" />} It's a fit
              </Button>
              <Button size="sm" disabled={!!busy} onClick={() => act("d" + r.id, () => api(`/api/companies/${r.id}/decide`, { method: "POST", json: { decision: "disqualify" } }), `${r.name}: marked not a fit`)}>
                Not a fit
              </Button>
            </div>
          ))}
        </Group>
      )}

      {emails.length > 0 && (
        <Group title="Emails to approve" n={emails.length} hint="Best fits first.">
          {emails.map((r) => (
            <a key={r.id} href={`#/company/${r.id}`} className="surface flex flex-wrap items-center gap-3 p-4 hover:border-accent/40">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  Email to {r.topContact?.name ?? "—"} <span className="font-normal text-muted">at {r.name}</span>
                </div>
                <div className="text-sm text-muted">{r.topContact?.position}</div>
              </div>
              {r.fit && <Pill tone="accent">Priority {r.fit.score}</Pill>}
              <span className="text-sm font-medium text-accent">Review & send →</span>
            </a>
          ))}
        </Group>
      )}

      {pending.length > 0 && (
        <Group title="Replies & bookings to OK" n={pending.length} hint="The agent read a reply and prepared the next step.">
          {pending.map((a) => <ActionCard key={a.id} a={a} who={who(a.threadId)} busy={busy} act={act} />)}
        </Group>
      )}

      {human.length > 0 && (
        <Group title="Conversations that need you" n={human.length} hint="Unclear or silent replies. Answer these yourself from your inbox.">
          {human.map((t) => (
            <a key={t.id} href="#/conversations" className="surface flex flex-wrap items-center gap-2 p-4">
              <Pill tone="bad">Needs you</Pill>
              <span className="font-medium">{t.contact?.name}</span>
              <span className="text-sm text-muted">· {t.company}</span>
              <span className="w-full text-sm text-ink-2">{t.needsHumanReason}</span>
            </a>
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ title, n, hint, children }: { title: string; n: number; hint: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-200 px-1.5 text-xs font-semibold">{n}</span>
        <span className="text-sm text-muted">{hint}</span>
      </div>
      {children}
    </div>
  );
}
