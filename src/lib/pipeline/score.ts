import type { Company } from "../types";

/**
 * Priority score (0-100) for a good-fit company, so the best ones get looked at first.
 * Deterministic and explained: every point comes with a reason.
 */
export function fitScore(c: Company): { score: number; reasons: string[] } {
  const s = c.scrape;
  if (!s) return { score: 0, reasons: [] };
  let score = 50;
  const reasons: string[] = ["Passed all four checks (+50)"];
  const add = (n: number, why: string) => {
    score += n;
    reasons.push(`${why} (${n > 0 ? "+" : ""}${n})`);
  };

  if (s.certs.hidden.some((h) => h.source === "html-comment")) add(15, "Hidden note in their site code suggests an audit is in progress");
  else if (s.certs.hidden.length) add(8, "Certificate mentioned only in page code");

  if (s.openRoles >= 10) add(10, `Hiring fast: ${s.openRoles} open roles`);
  else if (s.openRoles >= 5) add(5, `${s.openRoles} open roles`);

  if (s.jobTitles.some((t) => /enterprise|account exec|solutions|sales/i.test(t))) add(10, "Hiring for enterprise sales: security reviews are coming");
  if (s.jobTitles.some((t) => /security|compliance|grc|risk/i.test(t))) add(10, "Hiring for security / compliance");

  const n = s.employeeHint;
  if (n !== null) {
    if (n >= 50 && n <= 500) add(5, `Sweet-spot size (~${n} people)`);
    if (n > 1000) add(-15, `Very large (~${n} people): likely has its own compliance team`);
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}
