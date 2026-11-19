// Pure module (no Node imports): used by the server and by the dashboard editor live.
import type { LintIssue, LintResult } from "../types";

export const MAX_WORDS = 90;

const GREETING = /^(hi|hello|hey|dear)\b[^\n]*,?\s*$/i;
const SIGNOFF = /^(best|thanks|cheers|regards|best regards|kind regards|warmly|thank you)\b[^\n]*,?\s*$/i;

export const GAP_TERMS = /\b(soc ?2|iso ?27001|hipaa|pci|certif\w*|compliance|audit\w*|trust (page|center|centre)|security page|security review\w*)\b/i;

export const FLATTERY = [
  /\bimpress(ive|ed)\b/i, /\blove (what|how|your)\b/i, /\bcongrat(s|ulations)\b/i, /\bamazing\b/i,
  /\b(huge|big) fan\b/i, /\bgreat (work|job|product|team)\b/i, /\badmire\b/i, /\bincredible\b/i,
  /\bkudos\b/i, /\bfantastic\b/i, /\bawesome\b/i, /\bblown away\b/i, /\bstellar\b/i, /\bremarkable\b/i,
];

const RHETORICAL = [
  /\bdid you know\b/i, /\bever (wonder|wondered|thought)\b/i, /\bwhat if\b/i, /\bhave you ever\b/i,
  /\bwouldn'?t it be\b/i, /\bimagine (if|a world)\b/i, /\bwho doesn'?t\b/i, /\bisn'?t it\b/i,
];

export const ASK = /\b(open to|worth a|would you be up for|happy to (send|share|walk)|could we|can we|\d+[- ]?min(ute)?s?\b|quick call|short call|a call\b|a chat\b|reply with|let me know if|grab time|book a time)/i;

const PRESSURE = [
  /\basap\b/i, /\burgent(ly)?\b/i, /\blimited time\b/i, /\bdon'?t miss\b/i, /\bact now\b/i,
  /\blast chance\b/i, /\bonly (today|this week)\b/i, /\bright away\b/i, /\bimmediately\b/i,
];

export function splitBody(body: string): { greeting: string | null; content: string } {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let greeting: string | null = null;
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length && GREETING.test(lines[0].trim())) greeting = lines.shift()!.trim();
  // Drop sign-off and everything after it.
  const idx = lines.findIndex((l) => SIGNOFF.test(l.trim()));
  const content = (idx >= 0 ? lines.slice(0, idx) : lines).join("\n").trim();
  return { greeting, content };
}

export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

export function lintEmail(subject: string, body: string, opts: { firstName?: string } = {}): LintResult {
  const issues: LintIssue[] = [];
  const add = (rule: string, message: string) => issues.push({ rule, message });
  const wordCount = countWords(body);
  const { greeting, content } = splitBody(body);
  const sents = sentences(content);

  if (!subject.trim()) add("subject", "Subject is empty");
  if (wordCount >= MAX_WORDS) add("length", `Body is ${wordCount} words; must be under ${MAX_WORDS}`);
  if (opts.firstName && !(greeting && greeting.toLowerCase().includes(opts.firstName.toLowerCase())))
    add("greeting", `Greet the contact by name ("Hi ${opts.firstName},")`);

  if (!sents.length) add("gap-first", "Body has no sentences");
  else if (!GAP_TERMS.test(sents[0]))
    add("gap-first", "First sentence must state the compliance gap (e.g. no SOC 2 / ISO 27001 on the site)");

  const all = `${subject} ${body}`;
  for (const re of FLATTERY) {
    const m = re.exec(all);
    if (m) add("no-flattery", `Flattery: "${m[0]}"`);
  }
  for (const re of RHETORICAL) {
    const m = re.exec(all);
    if (m) add("no-rhetorical", `Rhetorical question pattern: "${m[0]}"`);
  }

  const askIdx = sents.map((s, i) => (ASK.test(s) ? i : -1)).filter((i) => i >= 0);
  if (askIdx.length === 0) add("one-ask", "No clear ask (e.g. \"Open to a 15-minute call next week?\")");
  if (askIdx.length > 1) add("one-ask", `${askIdx.length} asks found; keep exactly one`);

  const questions = sents.map((s, i) => (s.endsWith("?") ? i : -1)).filter((i) => i >= 0);
  if (/\?/.test(subject)) add("no-rhetorical", "Subject line must not be a question");
  for (const q of questions) {
    if (!askIdx.includes(q)) add("no-rhetorical", `Question that isn't the ask: "${sents[q]}"`);
  }
  if (questions.length > 1) add("no-rhetorical", "Only the single ask may be phrased as a question");

  for (const re of PRESSURE) {
    const m = re.exec(all);
    if (m) add("low-pressure", `Pressure language: "${m[0]}"`);
  }

  return { ok: issues.length === 0, wordCount, issues };
}
