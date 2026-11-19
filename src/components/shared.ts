import type { Action, Company, Contact, CrmEntry, Draft, EditRecord, InboundMessage, MockEmail, ReplyCategory, RuleKey, RuleResult, SendLog, Suppression, Thread } from "@/lib/types";

export type Status = {
  services: Record<string, string>;
  sending: { testRecipient: string | null; liveSending: boolean; canSend: boolean; dailyCap: number; sentToday: number };
  autopilot: boolean;
  authDisabled: boolean;
  stopped: boolean;
  stoppedReason: string | null;
  senderName: string;
  suppressed: number;
  learnedEdits: number;
  demoDomains: string[];
};

export type Row = {
  id: string;
  domain: string;
  name: string;
  status: Company["status"];
  error?: string;
  rules: Record<RuleKey, RuleResult> | null;
  disqualifyReasons: string[];
  certs: string[];
  openRoles: number;
  contacts: number;
  draftsPending: number;
  sent: boolean;
  threadStatus: Thread["status"] | null;
  employeeHint: number | null;
  topContact: { name: string; position: string } | null;
  createdAt: string;
  description: string;
  fit: { score: number; reasons: string[] } | null;
  undecided: RuleKey[];
  decidedBy: "human" | null;
  posture: "shown" | "hint" | "none" | "unknown";
  certNames: string[];
};

export const POSTURE: Record<Row["posture"], { label: string; tone: "neutral" | "good" | "bad" | "warn" | "accent" }> = {
  shown: { label: "Certified (shown on site)", tone: "neutral" },
  hint: { label: "Hint in page code only", tone: "warn" },
  none: { label: "No certificate found", tone: "good" },
  unknown: { label: "Not checked", tone: "neutral" },
};

export type Stage = "all" | "good" | "review" | "notfit" | "outreach" | "contacted" | "booked";

export function stageOf(r: Row): Exclude<Stage, "all">[] {
  const out: Exclude<Stage, "all">[] = [];
  if (r.status === "qualified") out.push("good");
  if (r.status === "needs_review") out.push("review");
  if (r.status === "disqualified" || r.status === "error") out.push("notfit");
  if (r.status === "qualified" && r.contacts > 0) out.push("outreach");
  if (r.sent) out.push("contacted");
  if (r.threadStatus === "booked") out.push("booked");
  return out;
}

export type Metric = {
  key: string;
  label: string;
  value: number | null;
  display: string;
  target: string;
  killLine: string;
  samples: number;
  needed: number;
  tripped: boolean;
  explain: string;
};
export type SafetyData = {
  killSwitch: { engaged: boolean; at?: string; by?: "human" | "auto"; reason?: string };
  autoTrip: boolean;
  history: { at: string; action: "engaged" | "released"; by: "human" | "auto"; reason: string }[];
  metrics: Metric[];
};

export type Detail = { company: Company; contacts: Contact[]; drafts: Draft[]; threads: Thread[]; examples: EditRecord[] };

export type ThreadRow = Thread & { company: string; contact: Contact | null; inbound: InboundMessage[] };
export type ThreadsData = {
  threads: ThreadRow[];
  actions: Action[];
  pendingMockReplies: number;
  outbox: MockEmail[];
  crm: CrmEntry[];
  sends: SendLog[];
};
export type { Suppression };

export const RULES: { key: RuleKey; label: string; question: string }[] = [
  { key: "b2b_software", label: "Sells software to businesses", question: "Do they sell software to other companies?" },
  { key: "employees_20_plus", label: "20 or more employees", question: "Are they big enough (20+ people)?" },
  { key: "open_roles_3_plus", label: "Hiring (3+ open roles)", question: "Are they growing (3+ open jobs)?" },
  { key: "no_visible_certification", label: "No SOC 2 / ISO badge yet", question: "Are they missing a security certificate?" },
];

export const THREAD_STATUS: Record<Thread["status"], { label: string; tone: "neutral" | "good" | "bad" | "warn" | "accent" }> = {
  awaiting_reply: { label: "Waiting for reply", tone: "accent" },
  slots_proposed: { label: "Picking a time", tone: "warn" },
  booked: { label: "Meeting booked", tone: "good" },
  closed_lost: { label: "Not interested", tone: "neutral" },
  needs_human: { label: "Needs you", tone: "bad" },
};

export const REPLY_MEANING: Record<ReplyCategory, string> = {
  interested: "Interested",
  not_interested: "Not interested",
  confirms_time: "Picked a time",
  asks_other_time: "Wants a different time",
  unclear: "Unclear, needs you",
};

export const LINT_CHECKS: { rule: string; label: string }[] = [
  { rule: "length", label: "Under 90 words" },
  { rule: "greeting", label: "Starts with their first name" },
  { rule: "gap-first", label: "First line names their compliance gap" },
  { rule: "no-flattery", label: "No flattery" },
  { rule: "no-rhetorical", label: "No rhetorical questions" },
  { rule: "one-ask", label: "Exactly one easy ask" },
  { rule: "low-pressure", label: "No pushy words" },
  { rule: "subject", label: "Has a subject line" },
];

export function parseDomains(text: string): string[] {
  return [
    ...new Set(
      text
        .replace(/[[\]"'{}]/g, " ")
        .split(/[\s,;]+/)
        .map((d) =>
          d
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .replace(/^www\./, "")
            .split("/")[0],
        )
        .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)),
    ),
  ];
}

/** One plain-English line explaining a company's result. */
export function verdictLine(r: Row): string {
  if (r.status === "error") return r.error ?? "We couldn't check this website.";
  if (r.status === "needs_review")
    return `Couldn't find out: ${r.undecided.map((k) => RULES.find((x) => x.key === k)!.label.toLowerCase()).join(", ")}. You decide.`;
  if (!r.rules) return "Not checked yet.";
  if (r.status === "qualified") {
    const bits = [
      r.employeeHint ? `~${r.employeeHint} people` : "20+ people",
      r.openRoles ? `${r.openRoles} open roles` : "hiring",
      "no security certificate on their site",
    ];
    return bits.join(" · ");
  }
  const failed = RULES.filter((x) => !r.rules![x.key].pass);
  const first = failed[0];
  return first ? `${notLabel(first.key)}: ${r.rules[first.key].reason}` : "Doesn't match.";
}

export function notLabel(k: RuleKey): string {
  return {
    b2b_software: "Not a B2B software company",
    employees_20_plus: "Too small (or size unknown)",
    open_roles_3_plus: "Not hiring enough",
    no_visible_certification: "Already certified",
  }[k];
}

export function serviceLabel(key: string, mode: string): { name: string; state: string; live: boolean } {
  const names: Record<string, string> = {
    llm: "AI that checks fit and writes emails",
    contacts: "Finding the right person (Hunter)",
    email: "Sending emails",
    inbox: "Reading replies",
    calendar: "Calendar for meetings",
    crm: "CRM log",
    storage: "Where data is saved",
    scraper: "Reading company websites",
  };
  const live = !/^mock|local file|fixtures-only/.test(mode);
  const pretty: Record<string, string> = {
    gemini: "Gemini (live)",
    anthropic: "Claude (live)",
    resend: "Resend (live)",
    gmail: "Gmail (live)",
    "gmail-imap": "Gmail (live)",
    supabase: "Supabase (live)",
    "local file": "This computer",
    hubspot: "HubSpot (live)",
    "cal.com": "Cal.com (live)",
    mock: "Practice mode (simulated)",
    "fixtures-only": "Practice websites only",
  };
  const state = pretty[mode] ?? (mode.startsWith("hunter") ? "Hunter.io (live)" : mode.startsWith("live") ? "Live" : mode);
  return { name: names[key] ?? key, state, live };
}
