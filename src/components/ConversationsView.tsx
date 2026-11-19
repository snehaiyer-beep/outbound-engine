"use client";
import { useState } from "react";
import type { Action } from "@/lib/types";
import { api, Button, Empty, Pill, Section, Spinner, timeAgo } from "./ui";
import { REPLY_MEANING, THREAD_STATUS, type ThreadRow, type ThreadsData } from "./shared";
import type { Toast } from "./Dashboard";

export const ACTION_LABEL: Record<Action["type"], { title: string; button: string }> = {
  send_email: { title: "Send this reply", button: "Send reply" },
  book_meeting: { title: "Book the meeting", button: "Book it & confirm" },
  crm_log: { title: "Save the outcome to the CRM", button: "Save to CRM" },
};

const TEST_REPLIES: [string, string][] = [
  ["Interested", "Thanks, this is timely. Happy to chat, send me some times."],
  ["Picks option 2", "Option 2 works for me."],
  ["Wants another time", "None of those work, could we do next week afternoon instead?"],
  ["Not interested", "Not interested, we already use another vendor."],
  ["Unsubscribe", "Please unsubscribe me."],
  ["Unclear", "Who else are you working with in our space?"],
];

export default function ConversationsView({ data, refresh, setToast }: { data: ThreadsData | null; refresh: () => Promise<void>; setToast: (t: Toast) => void }) {
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

  if (!data)
    return (
      <div className="flex items-center gap-2 text-muted">
        <Spinner /> Loading…
      </div>
    );

  const pending = data.actions.filter((a) => a.status === "pending");
  const human = data.threads.filter((t) => t.status === "needs_human");
  const threadName = (id: string) => {
    const t = data.threads.find((x) => x.id === id);
    return t ? `${t.contact?.name ?? ""} · ${t.company}` : "";
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Conversations</h1>
          <p className="mt-1 text-muted">Replies are read for you. Anything that goes out waits for your OK here.</p>
        </div>
        <Button kind="primary" disabled={!!busy} onClick={() => act("check", () => api("/api/replies/check", { method: "POST" }), "Checked for new replies")}>
          {busy === "check" && <Spinner />} Check for replies
        </Button>
      </div>

      {(pending.length > 0 || human.length > 0) && (
        <a href="#/todo" className="flex items-center justify-between rounded-[14px] border border-accent/30 bg-accent-soft px-5 py-3 text-sm">
          <span><b>{pending.length + human.length}</b> thing{pending.length + human.length === 1 ? "" : "s"} waiting for you</span>
          <span className="font-medium text-accent">Open To do →</span>
        </a>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">All conversations</h2>
        {data.threads.length === 0 ? (
          <Empty title="No emails sent yet">Open a good-fit company on the Companies tab and approve its email.</Empty>
        ) : (
          [...data.threads].reverse().map((t) => <ThreadCard key={t.id} t={t} busy={busy} act={act} />)
        )}
      </div>

      {data.crm.length > 0 && (
        <Section title="CRM log (practice mode)" hint="What would be saved to your CRM.">
          <ul className="space-y-1 text-sm">
            {data.crm.map((c) => (
              <li key={c.id}>
                <b>{c.company}</b> · {c.email} · {c.outcome.replace("_", " ")} <span className="text-muted">· {c.note}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function ThreadCard({ t, busy, act }: { t: ThreadRow; busy: string; act: (l: string, fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const [reply, setReply] = useState("");
  const st = THREAD_STATUS[t.status];
  const open = t.status === "awaiting_reply" || t.status === "slots_proposed";
  return (
    <div className="surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold">
            {t.contact?.name} <span className="font-normal text-muted">· {t.contact?.position}</span>
          </div>
          <div className="text-sm text-muted">
            {t.company} · “{t.subject}” · last email {timeAgo(t.lastOutboundAt)}
          </div>
        </div>
        <Pill tone={st.tone}>{st.label}</Pill>
      </div>

      {t.booking && <div className="mt-3 rounded-xl bg-good-soft px-4 py-3 text-sm text-good">📅 Meeting booked for <b>{t.booking.slot.label}</b></div>}
      {t.status === "slots_proposed" && (
        <div className="mt-3 text-sm text-ink-2">
          Times offered: {t.proposedSlots.map((s, i) => `${i + 1}) ${s.label}`).join("   ")}
        </div>
      )}

      {t.inbound.length > 0 && (
        <div className="mt-4 space-y-2">
          {t.inbound.map((m) => (
            <div key={m.id} className="rounded-xl bg-slate-50 p-3 text-sm">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                They replied {timeAgo(m.receivedAt)} · we read this as{" "}
                <Pill tone={m.classification?.category === "unclear" ? "bad" : m.classification?.category === "not_interested" ? "neutral" : "good"}>
                  {m.classification ? REPLY_MEANING[m.classification.category] : "—"}
                </Pill>
              </div>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </div>
          ))}
        </div>
      )}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted">Timeline ({t.history.length})</summary>
        <ol className="mt-2 space-y-1 border-l border-line pl-4 text-ink-2">
          {t.history.map((h, i) => (
            <li key={i}>
              <span className="text-xs text-muted">{new Date(h.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> — {h.text}
            </li>
          ))}
        </ol>
      </details>

      {open && (
        <div className="mt-4 rounded-xl border border-dashed border-line p-4">
          <div className="text-sm font-medium">Practice: pretend they replied</div>
          <p className="text-xs text-muted">Reading real replies isn't connected yet, so you can test the flow here.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TEST_REPLIES.map(([label, text]) => (
              <button key={label} onClick={() => setReply(text)} className="rounded-full border border-line px-2.5 py-1 text-xs hover:bg-slate-50">
                {label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input className="field" placeholder="Type their reply…" value={reply} onChange={(e) => setReply(e.target.value)} />
            <Button
              kind="primary"
              disabled={!reply.trim() || !!busy}
              onClick={() =>
                act(
                  "sim" + t.id,
                  async () => {
                    await api("/api/replies/simulate", { method: "POST", json: { threadId: t.id, body: reply } });
                    await api("/api/replies/check", { method: "POST" });
                    setReply("");
                  },
                  "Reply received and read",
                )
              }
            >
              {busy === "sim" + t.id && <Spinner />} Send test reply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ActionCard({ a, who, busy, act }: { a: Action; who: string; busy: string; act: (l: string, fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  return (
    <div className="surface border-accent/30 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="accent">Needs your OK</Pill>
        <span className="font-medium">{ACTION_LABEL[a.type].title}</span>
        <span className="text-sm text-muted">· {who}</span>
      </div>
      <p className="mt-2 text-sm text-ink-2">{a.summary}</p>
      {a.type === "send_email" && (
        <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 font-sans text-sm text-ink-2">{String((a.payload as { body?: string }).body ?? "")}</pre>
      )}
      <div className="mt-4 flex gap-2">
        <Button kind="primary" disabled={!!busy} onClick={() => act(a.id, () => api(`/api/actions/${a.id}/approve`, { method: "POST" }), "Done")}>
          {busy === a.id && <Spinner />} {ACTION_LABEL[a.type].button}
        </Button>
        <Button kind="ghost" disabled={!!busy} onClick={() => act(a.id + "x", () => api(`/api/actions/${a.id}/reject`, { method: "POST", json: { reason: "Declined in dashboard" } }), "OK, not doing that. The conversation now needs you.")}>
          Don't do this
        </Button>
      </div>
    </div>
  );
}
