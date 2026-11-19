"use client";
import { useMemo, useState } from "react";
import { api, Button, Empty, Pill, Spinner } from "./ui";
import { parseDomains, POSTURE, RULES, stageOf, THREAD_STATUS, verdictLine, type Row, type Stage, type Status } from "./shared";
import type { Toast } from "./Dashboard";

type Job = { domain: string; state: "waiting" | "running" | "done" | "error"; result?: string };
type Lead = { domain: string; name: string; note: string; source: string; known: string | null };
type FindMode = "paste" | "search" | "list";

const STAGES: { id: Exclude<Stage, "all">; label: string; hint: string }[] = [
  { id: "good", label: "Good fit", hint: "Passed all 4 checks" },
  { id: "review", label: "Needs your decision", hint: "Agent couldn't tell" },
  { id: "outreach", label: "Emails ready", hint: "Person found, draft written" },
  { id: "contacted", label: "Emailed", hint: "First email sent" },
  { id: "booked", label: "Meetings booked", hint: "On the calendar" },
];

export default function CompaniesView({
  rows, status, refresh, setToast,
}: {
  rows: Row[]; status: Status | null; refresh: () => Promise<void>; setToast: (t: Toast) => void;
}) {
  const [mode, setMode] = useState<FindMode>("paste");
  const [text, setText] = useState("");
  const [queries, setQueries] = useState("");
  const [listUrl, setListUrl] = useState("");
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [finding, setFinding] = useState(false);
  const [findNotes, setFindNotes] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stage, setStage] = useState<Stage>("all");
  const [q, setQ] = useState("");
  const [posture, setPosture] = useState<"all" | Row["posture"]>("all");
  const running = jobs.some((j) => j.state === "running" || j.state === "waiting");
  const domains = parseDomains(text);
  const stopped = !!status?.stopped;

  async function check(list: string[]) {
    if (!list.length) return;
    setJobs(list.map((domain) => ({ domain, state: "waiting" })));
    for (const domain of list) {
      setJobs((js) => js.map((j) => (j.domain === domain ? { ...j, state: "running" } : j)));
      try {
        const r = await api<{ companies: { status: string; error?: string }[] }>("/api/pipeline/run", { method: "POST", json: [domain] });
        const c = r.companies[0];
        const result =
          c.status === "qualified" ? "Good fit" : c.status === "needs_review" ? "Needs your decision" : c.status === "disqualified" ? "Not a fit" : c.error ?? "Couldn't check";
        setJobs((js) => js.map((j) => (j.domain === domain ? { ...j, state: c.status === "error" ? "error" : "done", result } : j)));
      } catch (e) {
        setJobs((js) => js.map((j) => (j.domain === domain ? { ...j, state: "error", result: (e as Error).message } : j)));
        if (/stopped/i.test((e as Error).message)) break;
      }
      await refresh();
    }
    setText("");
    setLeads(null);
    setToast({ kind: "ok", text: `Checked ${list.length} compan${list.length === 1 ? "y" : "ies"}` });
  }

  async function find() {
    setFinding(true);
    setLeads(null);
    setFindNotes([]);
    try {
      const r = await api<{ leads: Lead[]; notes: string[] }>("/api/discover", {
        method: "POST",
        json: mode === "search" ? { mode, queries: queries.split("\n") } : { mode, url: listUrl },
      });
      setLeads(r.leads);
      setFindNotes(r.notes);
      setPicked(new Set(r.leads.filter((l) => !l.known).slice(0, 10).map((l) => l.domain)));
    } catch (e) {
      setToast({ kind: "err", text: (e as Error).message });
    } finally {
      setFinding(false);
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) for (const s of stageOf(r)) c[s] = (c[s] ?? 0) + 1;
    return c;
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (stage !== "all" && !stageOf(r).includes(stage)) return false;
    if (posture !== "all" && r.posture !== posture) return false;
    if (q && !`${r.name} ${r.domain} ${r.description}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const good = filtered.filter((r) => r.status === "qualified").sort((a, b) => (b.fit?.score ?? 0) - (a.fit?.score ?? 0));
  const review = filtered.filter((r) => r.status === "needs_review");
  const bad = filtered.filter((r) => r.status === "disqualified" || r.status === "error");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Find companies that need SOC 2</h1>
        <p className="mt-1 text-muted">Find or paste companies. We check each one, find the best person to email and write a draft for you to approve.</p>
      </div>

      {/* Funnel */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <FunnelCard label="Checked" hint="All companies looked at" n={counts.all ?? 0} active={stage === "all"} onClick={() => setStage("all")} />
        {STAGES.map((s) => (
          <FunnelCard key={s.id} label={s.label} hint={s.hint} n={counts[s.id] ?? 0} active={stage === s.id} onClick={() => setStage(stage === s.id ? "all" : s.id)} alert={s.id === "review" && (counts.review ?? 0) > 0} />
        ))}
      </div>

      {/* Finder */}
      <section className="surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1 w-fit">
          {([
            ["paste", "Paste websites"],
            ["search", "Search the web"],
            ["list", "Read a list page"],
          ] as [FindMode, string][]).map(([m, label]) => (
            <button key={m} onClick={() => { setMode(m); setLeads(null); }} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${mode === m ? "bg-white shadow-sm text-ink" : "text-muted hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>

        {mode === "paste" && (
          <div className="mt-4">
            <p className="text-sm text-muted">One per line or separated by commas, e.g. <span className="font-mono text-ink-2">bitespeed.co, quickreply.ai</span></p>
            <textarea className="field mt-2 h-24 resize-y font-mono text-[13px]" placeholder={"acme.com\nanother-company.io"} value={text} disabled={running} onChange={(e) => setText(e.target.value)} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button kind="primary" size="lg" disabled={!domains.length || running || stopped} onClick={() => check(domains)}>
                {running && <Spinner />}
                {running ? "Checking…" : domains.length ? `Check ${domains.length} compan${domains.length === 1 ? "y" : "ies"}` : "Check companies"}
              </Button>
              {status && (
                <Button kind="ghost" disabled={running} onClick={() => setText(status.demoDomains.join("\n"))}>
                  Use {status.demoDomains.length} practice companies
                </Button>
              )}
              <label className="cursor-pointer text-sm text-muted hover:underline">
                or upload a list
                <input type="file" accept=".json,.txt,.csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
              </label>
            </div>
          </div>
        )}

        {mode === "search" && (
          <div className="mt-4">
            <p className="text-sm text-muted">Describe the companies you want, one search per line (up to 5). The AI searches Google and lists matching company websites.</p>
            <textarea className="field mt-2 h-24 resize-y" placeholder={"B2B SaaS startups in India hiring enterprise sales\nSeries A HR software companies"} value={queries} onChange={(e) => setQueries(e.target.value)} />
            <div className="mt-3"><Button kind="primary" size="lg" disabled={!queries.trim() || finding || stopped} onClick={find}>{finding && <Spinner />} {finding ? "Searching…" : "Find companies"}</Button></div>
          </div>
        )}

        {mode === "list" && (
          <div className="mt-4">
            <p className="text-sm text-muted">Paste a page that lists startups (a directory, a "top 50" article). We pick out the company websites it links to.</p>
            <input className="field mt-2" placeholder="https://www.example.com/top-saas-startups" value={listUrl} onChange={(e) => setListUrl(e.target.value)} />
            <div className="mt-3"><Button kind="primary" size="lg" disabled={!listUrl.trim() || finding || stopped} onClick={find}>{finding && <Spinner />} {finding ? "Reading…" : "Find companies"}</Button></div>
          </div>
        )}

        {mode !== "paste" && leads && (
          <div className="mt-4 rounded-xl border border-line">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 text-sm">
              <span className="font-medium">{leads.length} found</span>
              <span className="text-muted">{findNotes.join(" · ")}</span>
              <span className="flex-1" />
              <button className="text-accent text-sm" onClick={() => setPicked(new Set(leads.filter((l) => !l.known).map((l) => l.domain)))}>Select all new</button>
              <button className="text-muted text-sm" onClick={() => setPicked(new Set())}>Clear</button>
              <Button kind="primary" disabled={!picked.size || running || stopped} onClick={() => check([...picked])}>
                {running && <Spinner />} Check {picked.size} selected
              </Button>
            </div>
            <ul className="max-h-80 divide-y divide-line overflow-y-auto">
              {leads.map((l) => (
                <li key={l.domain}>
                  <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="mt-1 accent-[var(--color-accent)]"
                      checked={picked.has(l.domain)}
                      onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(l.domain); else n.delete(l.domain); return n; })}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm"><span className="font-medium">{l.name !== l.domain ? l.name : l.domain}</span> {l.name !== l.domain && <span className="text-muted">{l.domain}</span>}</div>
                      {l.note && <div className="text-xs text-muted line-clamp-1">{l.note}</div>}
                    </div>
                    {l.known && <Pill>Already checked</Pill>}
                  </label>
                </li>
              ))}
              {leads.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Nothing found. Try a different search or page.</li>}
            </ul>
          </div>
        )}

        {jobs.length > 0 && (
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
            {jobs.map((j) => (
              <li key={j.domain} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-5">
                  {j.state === "running" ? <Spinner className="h-4 w-4 text-accent" /> : j.state === "waiting" ? <span className="mx-auto block h-2 w-2 rounded-full bg-slate-300" /> : j.state === "error" ? "⚠️" : "✓"}
                </span>
                <span className="font-medium">{j.domain}</span>
                <span className="ml-auto max-w-[60%] truncate text-muted">
                  {j.state === "running" ? "Reading their website, checking the fit, finding people…" : j.state === "waiting" ? "Waiting" : j.result}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">About a minute per company. Nothing is sent at this step.</p>
      </section>

      {/* Filters */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input className="field max-w-xs" placeholder="Search companies…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="field w-auto" value={posture} onChange={(e) => setPosture(e.target.value as typeof posture)}>
            <option value="all">Any certificate status</option>
            <option value="none">No certificate found</option>
            <option value="hint">Hint in page code only</option>
            <option value="shown">Certified (shown on site)</option>
          </select>
          {(stage !== "all" || posture !== "all" || q) && (
            <button className="text-sm text-accent" onClick={() => { setStage("all"); setPosture("all"); setQ(""); }}>Clear filters</button>
          )}
          <span className="ml-auto text-sm text-muted">{filtered.length} of {rows.length} shown</span>
        </div>
      )}

      {rows.length === 0 ? (
        <Empty title="No companies yet">Search the web, read a list page, paste websites, or try the practice companies.</Empty>
      ) : (
        <>
          {review.length > 0 && (
            <div>
              <SectionTitle title="Needs your decision" sub={`${review.length} the agent couldn't decide`} />
              <ul className="surface divide-y divide-line border-amber-200">
                {review.map((r) => (
                  <li key={r.id}>
                    <a href={`#/company/${r.id}`} className="flex items-start gap-3 px-5 py-3.5 hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><span className="font-medium">{r.name}</span><span className="text-xs text-muted">{r.domain}</span></div>
                        <p className="mt-0.5 text-sm text-muted">{verdictLine(r)}</p>
                      </div>
                      <Pill tone="warn">Decide →</Pill>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <SectionTitle title="Good fit" sub={`${good.length} ready for you, best first`} />
            {good.length === 0 ? (
              <Empty title="No good fits here">None of these companies match all four checks.</Empty>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">{good.map((r) => <GoodCard key={r.id} r={r} />)}</div>
            )}
          </div>

          {bad.length > 0 && (
            <div>
              <SectionTitle title="Not a fit" sub={`${bad.length} skipped, with the reason`} />
              <ul className="surface divide-y divide-line">
                {bad.map((r) => (
                  <li key={r.id}>
                    <a href={`#/company/${r.id}`} className="flex items-start gap-3 px-5 py-3.5 hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{r.name}</span>
                          <span className="text-xs text-muted">{r.domain}</span>
                          {r.decidedBy && <Pill>Your decision</Pill>}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-sm text-muted">{verdictLine(r)}</p>
                      </div>
                      <RuleDots r={r} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SectionTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <span className="text-sm text-muted">{sub}</span>
    </div>
  );
}

function FunnelCard({ label, hint, n, active, onClick, alert }: { label: string; hint: string; n: number; active: boolean; onClick: () => void; alert?: boolean }) {
  return (
    <button onClick={onClick} className={`surface p-3.5 text-left transition hover:border-accent/40 ${active ? "!border-accent ring-2 ring-accent-soft" : ""}`}>
      <div className={`text-2xl font-semibold tabular-nums ${alert ? "text-warn" : ""}`}>{n}</div>
      <div className="text-sm font-medium leading-tight">{label}</div>
      <div className="mt-0.5 text-[11.5px] leading-tight text-muted">{hint}</div>
    </button>
  );
}

function RuleDots({ r }: { r: Row }) {
  if (!r.rules) return null;
  return (
    <div className="hidden gap-1 pt-1 sm:flex" aria-label="checks">
      {RULES.map((x) => (
        <span key={x.key} title={`${x.label}: ${r.rules![x.key].pass ? "yes" : "no"}`} className={`h-2 w-5 rounded-full ${r.rules![x.key].pass ? "bg-good/70" : "bg-bad/60"}`} />
      ))}
    </div>
  );
}

function GoodCard({ r }: { r: Row }) {
  const state = r.threadStatus
    ? THREAD_STATUS[r.threadStatus]
    : r.draftsPending
      ? { label: "Email ready to review", tone: "accent" as const }
      : { label: r.contacts ? "Reviewed" : "No contact found", tone: "neutral" as const };
  return (
    <a href={`#/company/${r.id}`} className="surface group block p-5 transition hover:border-accent/40 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{r.name}</span>
            {r.fit && <span title={r.fit.reasons.join("\n")} className="rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent">{r.fit.score}/100</span>}
          </div>
          <div className="text-xs text-muted">{r.domain}</div>
        </div>
        <Pill tone={state.tone}>{state.label}</Pill>
      </div>
      {r.description && <p className="mt-2 line-clamp-2 text-sm text-ink-2">{r.description}</p>}
      <p className="mt-2 text-sm text-muted">{verdictLine(r)}</p>
      <div className="mt-2"><Pill tone={POSTURE[r.posture].tone}>{POSTURE[r.posture].label}</Pill></div>
      <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm">
        <span className="truncate text-muted">
          {r.topContact ? (<>Best person: <span className="font-medium text-ink">{r.topContact.name}</span>, {r.topContact.position}</>) : "No contact found"}
        </span>
        <span className="shrink-0 font-medium text-accent transition group-hover:translate-x-0.5">Open →</span>
      </div>
    </a>
  );
}
