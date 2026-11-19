import { cosine, tokens } from "../pipeline/learning";
import { now } from "../store";
import type { StoreData } from "../types";

// Kill switch: one flag that stops every outward or costly action (sending, booking,
// scraping, searching, drafting). Kill criteria trip it automatically when the tool is
// not earning its keep, measured from real review decisions.

export class StoppedError extends Error {
  status = 423;
  constructor(reason?: string) {
    super(`Everything is stopped (kill switch)${reason ? `: ${reason}` : ""}. Release it in Settings → Safety.`);
  }
}

export function isStopped(s: StoreData): boolean {
  return s.settings.killSwitch.engaged;
}

export function assertRunning(s: StoreData): void {
  if (isStopped(s)) throw new StoppedError(s.settings.killSwitch.reason);
}

export interface Metric {
  key: "rewrite" | "contact" | "review";
  label: string;
  value: number | null; // null = not enough data yet
  display: string;
  target: string;
  killLine: string;
  samples: number;
  needed: number;
  tripped: boolean;
  explain: string;
}

/** True when the final email was mostly rewritten from the AI's first draft. */
export function heavilyRewritten(original: string, final: string): boolean {
  return cosine(tokens(original), tokens(final)) < 0.5;
}

export function killMetrics(s: StoreData): Metric[] {
  const decided = s.drafts.filter((d) => d.status === "sent" || d.status === "rejected");
  const discarded = decided.filter(
    (d) =>
      (d.status === "rejected" && d.rejectCategory !== "Wrong contact" && d.rejectCategory !== "Not a fit after all") ||
      (d.status === "sent" && heavilyRewritten(d.original.body, d.body)),
  ).length;
  const wrong = decided.filter((d) => d.rejectCategory === "Wrong contact").length;

  const perCompany = new Map<string, number>();
  for (const d of s.drafts) if (d.reviewSeconds) perCompany.set(d.companyId, (perCompany.get(d.companyId) ?? 0) + d.reviewSeconds);
  const times = [...perCompany.values()];
  const avgMin = times.length ? times.reduce((a, b) => a + b, 0) / times.length / 60 : 0;

  const rewrite = decided.length ? discarded / decided.length : 0;
  const accuracy = decided.length ? 1 - wrong / decided.length : 1;
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return [
    {
      key: "rewrite",
      label: "Emails rewritten or thrown away",
      value: decided.length >= 10 ? rewrite : null,
      display: decided.length ? pct(rewrite) : "no data",
      target: "under 20%",
      killLine: "over 50%",
      samples: decided.length,
      needed: 10,
      tripped: decided.length >= 10 && rewrite > 0.5,
      explain: `${discarded} of ${decided.length} reviewed emails were mostly rewritten or skipped as bad drafts.`,
    },
    {
      key: "contact",
      label: "Right person picked",
      value: decided.length >= 10 ? accuracy : null,
      display: decided.length ? pct(accuracy) : "no data",
      target: "at least 90%",
      killLine: "under 60%",
      samples: decided.length,
      needed: 10,
      tripped: decided.length >= 10 && accuracy < 0.6,
      explain: `${wrong} of ${decided.length} reviewed emails were skipped as "Wrong contact".`,
    },
    {
      key: "review",
      label: "Your review time per company",
      value: times.length >= 5 ? avgMin : null,
      display: times.length ? `${avgMin < 1 ? Math.round(avgMin * 60) + " sec" : avgMin.toFixed(1) + " min"}` : "no data",
      target: "under 2 min",
      killLine: "over 15 min (the manual time it replaces)",
      samples: times.length,
      needed: 5,
      tripped: times.length >= 5 && avgMin > 15,
      explain: `Average time with the email open, across ${times.length} compan${times.length === 1 ? "y" : "ies"}.`,
    },
  ];
}

/** Call inside a store mutation after any review decision. */
export function maybeAutoTrip(s: StoreData): void {
  if (!s.settings.autoTrip || isStopped(s)) return;
  const tripped = killMetrics(s).filter((m) => m.tripped);
  if (!tripped.length) return;
  const reason = `Kill criteria hit: ${tripped.map((m) => `${m.label} ${m.display} (kill line ${m.killLine})`).join("; ")}`;
  s.settings.killSwitch = { engaged: true, at: now(), by: "auto", reason };
  s.settings.killHistory.push({ at: now(), action: "engaged", by: "auto", reason });
}

export function setKill(s: StoreData, engaged: boolean, reason: string): void {
  if (engaged === s.settings.killSwitch.engaged) return;
  s.settings.killSwitch = engaged ? { engaged: true, at: now(), by: "human", reason } : { engaged: false };
  s.settings.killHistory.push({ at: now(), action: engaged ? "engaged" : "released", by: "human", reason });
}
