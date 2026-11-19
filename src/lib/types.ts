export type CertName = "SOC 2" | "ISO 27001" | "HIPAA" | "PCI";
export type CertSource = "visible" | "html-comment" | "image" | "script";

export interface CertHit {
  cert: CertName;
  source: CertSource;
  page: string;
  snippet: string;
}

export interface PageResult {
  path: string;
  url: string;
  ok: boolean;
  status: number;
  text: string; // visible text excerpt
  jobTitles: string[];
}

export interface ScrapeResult {
  pages: PageResult[];
  certs: { visible: CertHit[]; hidden: CertHit[] };
  openRoles: number;
  jobTitles: string[];
  employeeHint: number | null;
  companyName: string;
  description: string;
  fetchedAt: string;
  mode: "live" | "mock";
}

export const RULE_KEYS = [
  "b2b_software",
  "employees_20_plus",
  "open_roles_3_plus",
  "no_visible_certification",
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

export interface RuleResult {
  pass: boolean;
  reason: string;
}

export interface Qualification {
  rules: Record<RuleKey, RuleResult>;
  qualified: boolean;
  /** Rules the agent could not decide even after fetching more. */
  undecided: RuleKey[];
  disqualifyReasons: string[];
  iterations: number;
  extraPagesFetched: string[];
  model: string;
}

export interface Company {
  id: string;
  domain: string;
  name: string;
  status: "scraped" | "qualified" | "needs_review" | "disqualified" | "error";
  /** One line on what the company does (from its homepage). */
  description?: string;
  /** Priority among good fits, 0-100, with the reasons. */
  fit?: { score: number; reasons: string[] };
  /** Set when a person qualified/disqualified it by hand. */
  decidedBy?: "human";
  decisionNote?: string;
  scrape?: ScrapeResult;
  qualification?: Qualification;
  contactsNote?: string;
  error?: string;
  createdAt: string;
}

export interface Contact {
  id: string;
  companyId: string;
  name: string;
  firstName: string;
  email: string;
  position: string;
  seniority: string;
  confidence: number;
  rankScore: number;
  rankReason: string;
  source: "hunter" | "mock";
}

export interface LintIssue {
  rule: string;
  message: string;
}
export interface LintResult {
  ok: boolean;
  wordCount: number;
  issues: LintIssue[];
}

export interface EmailText {
  subject: string;
  body: string;
}

export interface Draft {
  id: string;
  companyId: string;
  contactId: string;
  subject: string;
  body: string;
  original: EmailText;
  painPoints: string[];
  hook: string;
  status: "draft" | "sent" | "rejected";
  lint: LintResult;
  examplesUsed: string[];
  model: string;
  rejectReason?: string;
  rejectCategory?: RejectCategory;
  /** Seconds a person spent reviewing this draft (for the review-time kill criterion). */
  reviewSeconds?: number;
  sentAt?: string;
  threadId?: string;
  createdAt: string;
}

export interface EditRecord {
  id: string;
  draftId: string;
  companyId: string;
  kind: "edit" | "reject";
  context: string;
  before: EmailText;
  after?: EmailText;
  reason?: string;
  at: string;
}

export interface SendLog {
  id: string;
  at: string;
  kind: "cold" | "reply";
  companyId: string;
  contactId: string;
  intendedTo: string;
  actualTo: string;
  subject: string;
  messageId: string;
  threadId: string;
  transport: "resend" | "gmail" | "mock";
  approvedBy: "human" | "autopilot";
}

export interface Slot {
  start: string; // ISO UTC
  end: string;
  label: string;
}

export type ReplyCategory =
  | "interested"
  | "not_interested"
  | "confirms_time"
  | "asks_other_time"
  | "unclear";

export interface Classification {
  category: ReplyCategory;
  optOut: boolean;
  chosenSlotIndex: number | null;
  timeHint: string | null;
  reason: string;
  model: string;
}

export interface InboundMessage {
  id: string;
  threadId: string | null;
  from: string;
  subject: string;
  body: string;
  inReplyTo: string | null;
  receivedAt: string;
  classification?: Classification;
}

export interface ThreadEvent {
  at: string;
  text: string;
}

export interface Thread {
  id: string;
  companyId: string;
  contactId: string;
  draftId: string;
  subject: string;
  status:
    | "awaiting_reply"
    | "slots_proposed"
    | "booked"
    | "closed_lost"
    | "needs_human";
  proposedSlots: Slot[];
  booking?: { slot: Slot; bookingId: string };
  needsHumanReason?: string;
  lastOutboundAt: string;
  messageIds: string[];
  history: ThreadEvent[];
}

export type ActionType = "send_email" | "book_meeting" | "crm_log";

export interface Action {
  id: string;
  threadId: string;
  type: ActionType;
  summary: string;
  payload: Record<string, unknown>;
  status: "pending" | "executed" | "rejected" | "failed";
  approvedBy?: "human" | "autopilot";
  result?: string;
  error?: string;
  createdAt: string;
  executedAt?: string;
}

export interface Suppression {
  email: string;
  reason: string;
  at: string;
}

export interface MockEmail {
  messageId: string;
  to: string;
  subject: string;
  text: string;
  headers: Record<string, string>;
  at: string;
}

export interface CrmEntry {
  id: string;
  at: string;
  email: string;
  company: string;
  outcome: string;
  note: string;
}

export const REJECT_CATEGORIES = ["Wrong contact", "Too generic", "Wrong tone", "Factually wrong", "Not a fit after all", "Other"] as const;
export type RejectCategory = (typeof REJECT_CATEGORIES)[number];

export interface KillEvent {
  at: string;
  action: "engaged" | "released";
  by: "human" | "auto";
  reason: string;
}

export interface Settings {
  killSwitch: { engaged: boolean; at?: string; by?: "human" | "auto"; reason?: string };
  autoTrip: boolean;
  killHistory: KillEvent[];
}

export interface StoreData {
  settings: Settings;
  companies: Company[];
  contacts: Contact[];
  drafts: Draft[];
  edits: EditRecord[];
  sends: SendLog[];
  threads: Thread[];
  inbound: InboundMessage[];
  actions: Action[];
  suppression: Suppression[];
  mock: {
    outbox: MockEmail[];
    inbox: InboundMessage[];
    bookings: { id: string; slot: Slot; email: string }[];
    crm: CrmEntry[];
  };
}
