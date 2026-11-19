import { config } from "../config";
import type { StoreData } from "../types";

export const UNSUBSCRIBE_LINE =
  "If this isn't relevant, reply \"unsubscribe\" and I won't email you again.";

export function normalizeEmail(e: string): string {
  return e.trim().toLowerCase();
}

/** Where an email will actually go. Throws if sending is not permitted at all. */
export function resolveRecipient(intended: string): { to: string; redirected: boolean } {
  const test = config.testRecipient();
  if (test) return { to: test, redirected: normalizeEmail(test) !== normalizeEmail(intended) };
  if (config.authDisabled())
    throw new Error("Sending blocked: with sign-in turned off (AUTH_DISABLED), email can only go to TEST_RECIPIENT.");
  if (config.liveSending()) return { to: intended, redirected: false };
  throw new Error(
    "Sending blocked: TEST_RECIPIENT is empty and LIVE_SENDING is not true. Set one of them.",
  );
}

export function withUnsubscribe(body: string): string {
  const trimmed = body.replace(/\s+$/, "");
  if (trimmed.includes(UNSUBSCRIBE_LINE)) return trimmed;
  return `${trimmed}\n\n--\n${UNSUBSCRIBE_LINE}`;
}

export function isSuppressed(s: StoreData, email: string): boolean {
  const e = normalizeEmail(email);
  return s.suppression.some((x) => x.email === e);
}

export function sentToday(s: StoreData, at = new Date()): number {
  const day = at.toISOString().slice(0, 10);
  return s.sends.filter((x) => x.at.slice(0, 10) === day).length;
}

export interface GateInput {
  kind: "cold" | "reply";
  companyId: string;
  contactId: string;
  intendedTo: string;
  approval: { by: "human" | "autopilot" } | null;
}

/** Returns a list of reasons the send is blocked (empty = allowed). */
export function checkSendGates(s: StoreData, g: GateInput): string[] {
  const reasons: string[] = [];
  if (s.settings?.killSwitch?.engaged) reasons.push("The kill switch is on: nothing is sent until a person releases it");
  if (!g.approval) reasons.push("No approval: every send needs an explicit approval");
  if (g.kind === "cold" && g.approval?.by !== "human")
    reasons.push("Cold emails can only be sent by a human Approve & Send click");
  if (g.kind === "reply" && g.approval?.by === "autopilot" && !config.autopilot())
    reasons.push("Autopilot approval used while AUTOPILOT is not true");
  if (isSuppressed(s, g.intendedTo)) reasons.push(`${g.intendedTo} is on the suppression list`);
  if (sentToday(s) >= config.dailySendCap())
    reasons.push(`Daily send cap reached (${config.dailySendCap()})`);
  const otherContact = s.sends.find(
    (x) => x.companyId === g.companyId && x.contactId !== g.contactId,
  );
  if (otherContact) reasons.push("Another contact at this company has already been emailed (max one per company)");
  if (g.kind === "cold" && s.sends.some((x) => x.kind === "cold" && x.contactId === g.contactId))
    reasons.push("This contact already received a cold email");
  try {
    resolveRecipient(g.intendedTo);
  } catch (e) {
    reasons.push((e as Error).message);
  }
  return reasons;
}
