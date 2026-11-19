"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./ui";
import type { Row, Status, ThreadsData } from "./shared";
import CompaniesView from "./CompaniesView";
import CompanyDetail from "./CompanyDetail";
import ConversationsView from "./ConversationsView";
import SettingsView from "./SettingsView";
import TodoView from "./TodoView";

type Route = { tab: "companies" | "todo" | "conversations" | "settings"; companyId?: string };

function readRoute(): Route {
  const h = typeof window === "undefined" ? "" : window.location.hash.replace(/^#\/?/, "");
  const [a, b] = h.split("/");
  if (a === "company" && b) return { tab: "companies", companyId: b };
  if (a === "conversations") return { tab: "conversations" };
  if (a === "todo") return { tab: "todo" };
  if (a === "settings") return { tab: "settings" };
  return { tab: "companies" };
}

export function go(path: string) {
  window.location.hash = `/${path}`;
}

export type Toast = { kind: "ok" | "err"; text: string } | null;

export default function Dashboard() {
  const [route, setRoute] = useState<Route>({ tab: "companies" });
  const [status, setStatus] = useState<Status | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [threads, setThreads] = useState<ThreadsData | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const refresh = useCallback(async () => {
    const [s, r, t] = await Promise.all([api<Status>("/api/status"), api<Row[]>("/api/companies"), api<ThreadsData>("/api/threads")]);
    setStatus(s);
    setRows(r);
    setThreads(t);
  }, []);

  useEffect(() => {
    setRoute(readRoute());
    const on = () => {
      setRoute(readRoute());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    refresh().catch((e) => setToast({ kind: "err", text: e.message }));
    return () => window.removeEventListener("hashchange", on);
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === "ok" ? 3500 : 9000);
    return () => clearTimeout(t);
  }, [toast]);

  const todo =
    (threads?.actions.filter((a) => a.status === "pending").length ?? 0) +
    (threads?.threads.filter((t) => t.status === "needs_human").length ?? 0) +
    rows.filter((r) => r.status === "needs_review").length +
    rows.filter((r) => r.status === "qualified" && r.draftsPending > 0 && !r.sent).length;
  const tabs: { id: Route["tab"]; label: string; path: string; badge?: number }[] = [
    { id: "companies", label: "Companies", path: "" },
    { id: "todo", label: "To do", path: "todo", badge: todo },
    { id: "conversations", label: "Conversations", path: "conversations" },
    { id: "settings", label: "Settings", path: "settings" },
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 sm:px-6 h-14">
          <a href="#/" className="flex items-center gap-2 font-semibold">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white text-sm">O</span>
            <span className="hidden sm:inline">Outbound Engine</span>
          </a>
          <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {tabs.map((t) => (
              <a
                key={t.id}
                href={`#/${t.path}`}
                className={`relative rounded-lg px-3 py-1.5 text-sm font-medium transition ${route.tab === t.id ? "bg-slate-100 text-ink" : "text-muted hover:text-ink"}`}
              >
                {t.label}
                {!!t.badge && (
                  <span className="ml-1.5 inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-bad px-1.5 text-[11px] font-semibold text-white">{t.badge}</span>
                )}
              </a>
            ))}
          </nav>
          <div className="flex-1" />
          {status && (
            <a href="#/settings" className="hidden md:inline-flex items-center gap-2 rounded-full bg-warn-soft px-3 py-1 text-xs font-medium text-warn" title="All emails go to your own inbox">
              <span className="h-1.5 w-1.5 rounded-full bg-warn" />
              Test mode: emails go to {status.sending.testRecipient ?? "nobody"}
            </a>
          )}
        </div>
      </header>

      {status?.stopped && (
        <a href="#/settings" className="block bg-bad px-4 py-2.5 text-center text-sm font-medium text-white">
          ⛔ Everything is stopped (kill switch). Nothing is sent, booked, searched or drafted. {status.stoppedReason ? `Reason: ${status.stoppedReason}. ` : ""}
          <span className="underline">Release it in Settings</span>
        </a>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 w-[min(560px,calc(100%-2rem))] -translate-x-1/2">
          <div className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg whitespace-pre-wrap ${toast.kind === "err" ? "bg-bad text-white" : "bg-ink text-white"}`}>
            <span className="flex-1">{toast.text}</span>
            <button onClick={() => setToast(null)} className="opacity-70 hover:opacity-100" aria-label="Dismiss">✕</button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
        {route.tab === "companies" && !route.companyId && (
          <CompaniesView rows={rows} status={status} refresh={refresh} setToast={setToast} />
        )}
        {route.tab === "companies" && route.companyId && (
          <CompanyDetail key={route.companyId} companyId={route.companyId} status={status} refresh={refresh} setToast={setToast} />
        )}
        {route.tab === "todo" && <TodoView rows={rows} threads={threads} refresh={refresh} setToast={setToast} />}
        {route.tab === "conversations" && <ConversationsView data={threads} refresh={refresh} setToast={setToast} />}
        {route.tab === "settings" && <SettingsView status={status} refresh={refresh} setToast={setToast} />}
      </main>
    </div>
  );
}
