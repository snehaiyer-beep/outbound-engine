"use client";
import type { ReactNode } from "react";

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Please sign in");
  }
  const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
  if (!res.ok) {
    const details = Array.isArray(data.details)
      ? data.details.map((d: unknown) => (typeof d === "string" ? d : (d as { message: string }).message))
      : [];
    throw new Error([data.error, ...details].filter(Boolean).join("\n• "));
  }
  return data as T;
}

type Tone = "neutral" | "good" | "bad" | "warn" | "accent";
const TONES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-ink-2",
  good: "bg-good-soft text-good",
  bad: "bg-bad-soft text-bad",
  warn: "bg-warn-soft text-warn",
  accent: "bg-accent-soft text-accent",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}>{children}</span>;
}

export function Button({
  kind = "secondary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg" }) {
  const k = {
    primary: "bg-accent text-white hover:bg-indigo-700 shadow-sm",
    secondary: "bg-white text-ink border border-line hover:bg-slate-50",
    ghost: "text-ink-2 hover:bg-slate-100",
    danger: "bg-white text-bad border border-red-200 hover:bg-bad-soft",
  }[kind];
  const s = { sm: "px-2.5 py-1.5 text-xs", md: "px-3.5 py-2 text-sm", lg: "px-5 py-2.5 text-[15px]" }[size];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${k} ${s} ${className}`}
    />
  );
}

export function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Check({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-good-soft text-good" aria-label="yes">
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor"><path d="M7.7 13.3 4.4 10l-1.1 1.1 4.4 4.4 9-9-1.1-1.1z" /></svg>
    </span>
  ) : (
    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bad-soft text-bad" aria-label="no">
      <svg viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor"><path d="M5.3 4.2 10 8.9l4.7-4.7 1.1 1.1L11.1 10l4.7 4.7-1.1 1.1L10 11.1l-4.7 4.7-1.1-1.1L8.9 10 4.2 5.3z" /></svg>
    </span>
  );
}

export function Section({ title, hint, right, children }: { title: string; hint?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="surface p-5 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[14px] border border-dashed border-line bg-white/60 px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
