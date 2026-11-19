import { z } from "zod";
import { llmJson, llmMode } from "../services/llm";
import type { Classification, Slot } from "../types";

const OPT_OUT = /\b(unsubscribe|remove me|stop (emailing|contacting)|opt(ed)? out|take me off|do not (email|contact))\b/i;
const NOT_INTERESTED = /\b(not interested|no thanks|no thank you|not a (priority|fit)|not right now|already (use|have|working with|certified)|we'?ll pass|pass for now|not for us)\b/i;
const OTHER_TIME = /\b(none of (these|those|them)|(doesn'?t|don'?t|won'?t) work|another time|other times?|different time|can'?t make|out of office|next week instead|later (that|next) week|how about|what about)\b/i;
const CONFIRM = /\b(works( for me)?|let'?s do|book it|confirm(ed)?|see you|sounds good|perfect|i'?ll take|go with)\b/i;
const INTERESTED = /\b(interested|tell me more|let'?s (talk|chat)|happy to (talk|chat)|open to|keen|sure|yes|send (me )?(some )?times|would like to|curious)\b/i;

const ORDINALS: [RegExp, number][] = [
  [/\b(first|1st|option ?1|#1|slot ?1)\b/i, 0],
  [/\b(second|2nd|option ?2|#2|slot ?2)\b/i, 1],
  [/\b(third|3rd|option ?3|#3|slot ?3)\b/i, 2],
];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Which proposed slot does the reply point at? null if none or ambiguous. */
export function matchSlot(text: string, slots: Slot[]): number | null {
  if (!slots.length) return null;
  for (const [re, i] of ORDINALS) if (re.test(text) && i < slots.length) return i;
  const t = text.toLowerCase();
  const scores = slots.map((s) => {
    let score = 0;
    const label = s.label.toLowerCase(); // e.g. "tue 24 nov, 10:00 (asia/kolkata)"
    const day = label.slice(0, 3);
    if (DAYS.includes(day) && new RegExp(`\\b${day}`, "i").test(t)) score += 2;
    const dateNum = /\b(\d{1,2}) [a-z]{3}/.exec(label)?.[1];
    if (dateNum && new RegExp(`\\b${dateNum}(st|nd|rd|th)?\\b`).test(t)) score += 1;
    const hour = Number(/(\d{2}):\d{2}/.exec(label)?.[1]);
    const h12 = hour > 12 ? hour - 12 : hour;
    if (new RegExp(`\\b(${hour}(:00)?|${h12}(:00)? ?(am|pm))\\b`).test(t)) score += 2;
    return score;
  });
  const best = Math.max(...scores);
  if (best === 0) return null;
  return scores.filter((x) => x === best).length === 1 ? scores.indexOf(best) : null;
}

export function mockClassify(body: string, proposedSlots: Slot[]): Classification {
  const base = { optOut: false, chosenSlotIndex: null, timeHint: null, model: "mock" } as const;
  if (OPT_OUT.test(body)) return { ...base, category: "not_interested", optOut: true, reason: "Asked to be removed" };
  if (NOT_INTERESTED.test(body)) return { ...base, category: "not_interested", reason: `Declined ("${NOT_INTERESTED.exec(body)![0]}")` };
  if (proposedSlots.length) {
    if (OTHER_TIME.test(body)) {
      const hint = /(next week|morning|afternoon|monday|tuesday|wednesday|thursday|friday)/i.exec(body)?.[0] ?? null;
      return { ...base, category: "asks_other_time", timeHint: hint, reason: "Proposed times don't work" };
    }
    const idx = matchSlot(body, proposedSlots);
    if (idx !== null) return { ...base, category: "confirms_time", chosenSlotIndex: idx, reason: `Picked option ${idx + 1}` };
    if (CONFIRM.test(body)) return { ...base, category: "unclear", reason: "Agreed but didn't say which time" };
  }
  if (INTERESTED.test(body)) return { ...base, category: "interested", reason: `Positive reply ("${INTERESTED.exec(body)![0]}")` };
  return { ...base, category: "unclear", reason: "No clear intent" };
}

const schema = z.object({
  category: z.enum(["interested", "not_interested", "confirms_time", "asks_other_time", "unclear"]),
  optOut: z.boolean(),
  chosenSlotIndex: z.number().int().nullable(),
  timeHint: z.string().nullable(),
  reason: z.string(),
});

const SYSTEM = `Classify a reply to a B2B cold email.
Categories: interested | not_interested | confirms_time (picks one of the proposed slots) | asks_other_time | unclear.
optOut=true if they ask not to be contacted again. chosenSlotIndex is the 0-based index of the picked slot, else null.
timeHint: any timing preference they give (e.g. "next week", "afternoons"), else null. If in doubt, use unclear.
JSON: {"category":..., "optOut": bool, "chosenSlotIndex": int|null, "timeHint": str|null, "reason": str}`;

export async function classifyReply(body: string, proposedSlots: Slot[]): Promise<Classification> {
  // Opt-outs are always caught deterministically, whatever the model says.
  const forcedOptOut = OPT_OUT.test(body);
  if (llmMode() === "mock") return mockClassify(body, proposedSlots);
  const slots = proposedSlots.map((s, i) => `${i}: ${s.label}`).join("\n") || "none";
  let out: Classification;
  try {
    const r = await llmJson(SYSTEM, `Proposed slots:\n${slots}\n\nReply:\n${body}`, schema, 400);
    out = { ...r.data, model: r.model };
  } catch (e) {
    return { ...mockClassify(body, proposedSlots), model: `mock (LLM failed: ${(e as Error).message.slice(0, 120)})` };
  }
  if (forcedOptOut) return { ...out, category: "not_interested", optOut: true };
  if (out.category === "confirms_time" && (out.chosenSlotIndex === null || !proposedSlots[out.chosenSlotIndex]))
    return { ...out, category: "unclear", reason: `Model said confirms_time but slot is invalid. ${out.reason}` };
  return out;
}
