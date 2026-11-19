"use client";
import { useCallback, useEffect, useState } from "react";
import { api, Button, Pill, Section, Spinner } from "./ui";
import { serviceLabel, type SafetyData, type Status, type Suppression } from "./shared";
import type { Toast } from "./Dashboard";

export default function SettingsView({ status, refresh, setToast }: { status: Status | null; refresh: () => Promise<void>; setToast: (t: Toast) => void }) {
  const [list, setList] = useState<Suppression[]>([]);
  const [email, setEmail] = useState("");
  const load = useCallback(async () => setList(await api<Suppression[]>("/api/suppression")), []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  if (!status) return null;
  const s = status.sending;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-muted">How the engine is set up right now. Changes are made in the hosting settings.</p>
      </div>

      <KillSwitch refresh={refresh} setToast={setToast} />

      <Section title="Safety rules">
        <ul className="space-y-3 text-sm">
          <Item title="Test mode is on" tone="warn">
            Every email goes to <b>{s.testRecipient ?? "nobody (sending is off)"}</b>, never to the real person.
          </Item>
          <Item title={`Daily limit: ${s.sentToday} of ${s.dailyCap} sent today`}>Sending stops for the day at the limit.</Item>
          <Item title="One person per company">Once someone at a company is emailed, nobody else there will be.</Item>
          <Item title={status.autopilot ? "Autopilot is ON" : "You approve everything"} tone={status.autopilot ? "bad" : "good"}>
            {status.autopilot ? "Replies, bookings and CRM logs go out without asking." : "First emails, replies, bookings and CRM logs all wait for your click."}
          </Item>
          <Item title="Unsubscribe line on every email">People who ask to stop are added to the do-not-email list automatically.</Item>
          {status.authDisabled && (
            <Item title="No sign-in" tone="warn">
              Anyone with the link can open this app, so it is locked to test mode: it can only email you.
            </Item>
          )}
        </ul>
      </Section>

      <Section title="Connections">
        <ul className="divide-y divide-line">
          {Object.entries(status.services).map(([k, v]) => {
            const l = serviceLabel(k, v);
            return (
              <li key={k} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span>{l.name}</span>
                <Pill tone={l.live ? "good" : "neutral"}>{l.state}</Pill>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted">Practice mode means that part is simulated so you can test the full flow safely.</p>
      </Section>

      <Section title="Do-not-email list" hint="People here are never emailed again. This list only grows.">
        <div className="flex gap-2">
          <input className="field" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button
            kind="primary"
            disabled={!email.trim()}
            onClick={async () => {
              try {
                await api("/api/suppression", { method: "POST", json: { email } });
                setEmail("");
                await load();
                await refresh();
                setToast({ kind: "ok", text: "Added to the do-not-email list" });
              } catch (e) {
                setToast({ kind: "err", text: (e as Error).message });
              }
            }}
          >
            Add
          </Button>
        </div>
        <ul className="mt-4 divide-y divide-line text-sm">
          {list.length === 0 && <li className="py-2 text-muted">Nobody yet.</li>}
          {list.map((x) => (
            <li key={x.email} className="flex justify-between gap-3 py-2">
              <span>{x.email}</span>
              <span className="text-xs text-muted">{x.reason}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Item({ title, tone = "good", children }: { title: string; tone?: "good" | "warn" | "bad"; children: React.ReactNode }) {
  const dot = { good: "bg-good", warn: "bg-warn", bad: "bg-bad" }[tone];
  return (
    <li className="flex gap-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-muted">{children}</div>
      </div>
    </li>
  );
}

function KillSwitch({ refresh, setToast }: { refresh: () => Promise<void>; setToast: (t: Toast) => void }) {
  const [d, setD] = useState<SafetyData | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setD(await api<SafetyData>("/api/safety")), []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function post(json: object, ok: string) {
    setBusy(true);
    try {
      setD(await api<SafetyData>("/api/safety", { method: "POST", json }));
      setReason("");
      setToast({ kind: "ok", text: ok });
      await refresh();
    } catch (e) {
      setToast({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!d) return null;
  const on = d.killSwitch.engaged;
  return (
    <Section title="Kill switch" hint="One button stops everything at once. It also trips by itself if the tool isn't earning its keep.">
      <div className={`rounded-xl p-4 ${on ? "bg-bad-soft" : "bg-good-soft"}`}>
        <div className={`flex items-center gap-2 font-semibold ${on ? "text-bad" : "text-good"}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${on ? "bg-bad" : "bg-good"}`} />
          {on ? `Stopped ${d.killSwitch.by === "auto" ? "automatically" : "by you"}` : "Running"}
        </div>
        <p className="mt-1 text-sm text-ink-2">
          {on
            ? d.killSwitch.reason
            : "Emails, bookings, company checks, web searches and AI drafting are all available."}
        </p>
        <p className="mt-1 text-xs text-muted">
          While stopped: nothing is sent, booked, checked, searched or drafted. You can still read everything. Only a person can release it.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input className="field max-w-sm bg-white" placeholder={on ? "Why release? (optional)" : "Why stop? (optional)"} value={reason} onChange={(e) => setReason(e.target.value)} />
          {on ? (
            <Button kind="primary" disabled={busy} onClick={() => post({ action: "release", reason }, "Released. Everything is running again.")}>{busy && <Spinner />} Release</Button>
          ) : (
            <Button kind="danger" disabled={busy} onClick={() => post({ action: "engage", reason }, "Stopped. Nothing will go out.")}>{busy && <Spinner />} Stop everything</Button>
          )}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <div className="text-sm font-semibold">Kill criteria</div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" className="accent-[var(--color-accent)]" checked={d.autoTrip} disabled={busy} onChange={(e) => post({ autoTrip: e.target.checked }, e.target.checked ? "Automatic stop is on" : "Automatic stop is off")} />
          Stop automatically
        </label>
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        {d.metrics.map((m) => (
          <div key={m.key} className={`rounded-xl border p-3.5 ${m.tripped ? "border-red-300 bg-bad-soft" : "border-line"}`}>
            <div className="text-sm font-medium">{m.label}</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${m.tripped ? "text-bad" : ""}`}>{m.display}</div>
            <div className="mt-1 text-xs text-muted">Target {m.target} · stops at {m.killLine}</div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (m.samples / m.needed) * 100)}%` }} />
            </div>
            <div className="mt-1 text-[11px] text-muted">
              {m.samples >= m.needed ? "Enough data to judge" : `${m.samples} of ${m.needed} needed before it can stop anything`}
            </div>
            <div className="mt-1.5 text-xs text-ink-2">{m.explain}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        From the case: stop if more than half the emails need rewriting, if the right person is picked less than 60% of the time, or if reviewing takes longer than the 15–20 minutes of manual work it replaces. &quot;Right person&quot; counts skips marked &quot;Wrong contact&quot;.
      </p>

      {d.history.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted">History ({d.history.length})</summary>
          <ul className="mt-2 space-y-1">
            {d.history.map((h, i) => (
              <li key={i} className="text-ink-2">
                <span className="text-xs text-muted">{new Date(h.at).toLocaleString()}</span> — {h.action === "engaged" ? "Stopped" : "Released"} by {h.by === "auto" ? "the kill criteria" : "you"}: {h.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}
