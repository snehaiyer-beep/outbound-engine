import { beforeEach, describe, expect, it } from "vitest";
import { freshEnv } from "./helpers";
import { matchSlot, mockClassify } from "@/lib/replies/classify";
import { checkReplies, flagSilentThreads } from "@/lib/replies/process";
import { executeAction } from "@/lib/replies/actions";
import { mockCalendar } from "@/lib/services/calendar";
import { simulateReply, stripQuoted } from "@/lib/services/inbox";
import { runPipeline } from "@/lib/pipeline/run";
import { approveAndSend } from "@/lib/drafts";
import { mutate, readStore } from "@/lib/store";
import type { Slot } from "@/lib/types";

const slots: Slot[] = [
  { start: "2026-11-24T04:30:00.000Z", end: "2026-11-24T05:00:00.000Z", label: "Tue 24 Nov, 10:00 (Asia/Kolkata)" },
  { start: "2026-11-25T06:30:00.000Z", end: "2026-11-25T07:00:00.000Z", label: "Wed 25 Nov, 12:00 (Asia/Kolkata)" },
  { start: "2026-11-26T09:30:00.000Z", end: "2026-11-26T10:00:00.000Z", label: "Thu 26 Nov, 15:00 (Asia/Kolkata)" },
];

beforeEach(async () => {
  await freshEnv();
});

describe("reply classification (mock)", () => {
  it.each([
    ["Sounds interesting, happy to chat", [], "interested"],
    ["Not interested, thanks", [], "not_interested"],
    ["Please unsubscribe me", [], "not_interested"],
    ["Option 2 works", slots, "confirms_time"],
    ["Thursday at 3pm is good", slots, "confirms_time"],
    ["None of those work, next week?", slots, "asks_other_time"],
    ["Sure, that works", slots, "unclear"],
    ["Who are your other customers?", [], "unclear"],
  ] as [string, Slot[], string][])("%s → %s", (body, s, expected) => {
    expect(mockClassify(body, s).category).toBe(expected);
  });
  it("flags opt-outs", () => expect(mockClassify("stop emailing me", []).optOut).toBe(true));
  it("matches slots by ordinal, weekday and time", () => {
    expect(matchSlot("the first one", slots)).toBe(0);
    expect(matchSlot("wednesday is fine", slots)).toBe(1);
    expect(matchSlot("15:00 please", slots)).toBe(2);
    expect(matchSlot("any time", slots)).toBeNull();
  });
  it("strips quoted text", () => {
    expect(stripQuoted("Yes please\n\nOn Mon, Sam wrote:\n> hi")).toBe("Yes please");
  });
});

describe("mock calendar", () => {
  it("proposes 3 free weekday slots on different days, skipping booked ones", async () => {
    const from = new Date("2026-11-20T06:00:00Z"); // Friday
    const first = await mockCalendar.findSlots({ from, count: 3, exclude: [] });
    expect(first).toHaveLength(3);
    expect(new Set(first.map((s) => s.start.slice(0, 10))).size).toBe(3);
    for (const s of first) expect(["Sat", "Sun"]).not.toContain(s.label.slice(0, 3));
    await mockCalendar.book(first[0], { name: "x", email: "x@y.com" });
    await expect(mockCalendar.book(first[0], { name: "x", email: "x@y.com" })).rejects.toThrow(/no longer free/);
    const again = await mockCalendar.findSlots({ from, count: 3, exclude: first });
    expect(again.some((s) => first.some((f) => f.start === s.start))).toBe(false);
  });
});

async function sentThread() {
  await runPipeline(["acmeledger.io"]);
  const s = (await readStore());
  const draft = s.drafts.find((d) => s.contacts.find((c) => c.id === d.contactId)!.rankScore === Math.max(...s.contacts.map((c) => c.rankScore)))!;
  await approveAndSend(draft.id, { subject: draft.subject, body: draft.body });
  return (await readStore()).threads[0];
}

async function reply(threadId: string, body: string) {
  const t = (await readStore()).threads.find((x) => x.id === threadId)!;
  await simulateReply({ from: "priya@acmeledger.io", subject: "Re", body, inReplyTo: t.messageIds[t.messageIds.length - 1] });
}

describe("reply workflow", () => {
  it("unclear replies go to a human and queue nothing", async () => {
    const t = await sentThread();
    await reply(t.id, "Hmm, who else uses this?");
    await checkReplies();
    const s = (await readStore());
    expect(s.threads[0].status).toBe("needs_human");
    expect(s.actions).toHaveLength(0);
  });
  it("silent threads go to a human after SILENT_AFTER_DAYS", async () => {
    const t = await sentThread();
    expect(await flagSilentThreads(new Date())).toHaveLength(0);
    await mutate((s) => {
      s.threads[0].lastOutboundAt = new Date(Date.now() - 6 * 86_400_000).toISOString();
    });
    expect((await flagSilentThreads(new Date())).map((x) => x.id)).toEqual([t.id]);
    expect((await readStore()).threads[0].needsHumanReason).toMatch(/No reply in 5 days/);
  });
  it("opt-out reply adds to suppression and blocks further email", async () => {
    const t = await sentThread();
    await reply(t.id, "unsubscribe");
    await checkReplies();
    const s = (await readStore());
    expect(s.suppression.map((x) => x.email)).toContain("priya@acmeledger.io");
    expect(s.threads[0].status).toBe("closed_lost");
    const crm = s.actions.find((a) => a.type === "crm_log")!;
    expect(crm.status).toBe("pending");
  });
  it("outward actions wait for approval when AUTOPILOT is off", async () => {
    const t = await sentThread();
    const before = (await readStore()).mock.outbox.length;
    await reply(t.id, "Interested, send some times");
    await checkReplies();
    const s = (await readStore());
    expect(s.actions[0]).toMatchObject({ type: "send_email", status: "pending" });
    expect(s.mock.outbox.length).toBe(before);
  });
  it("AUTOPILOT=true executes reply actions without a click (but still through the gates)", async () => {
    const t = await sentThread();
    process.env.AUTOPILOT = "true";
    await reply(t.id, "Interested, send some times");
    await checkReplies();
    const s = (await readStore());
    expect(s.actions[0]).toMatchObject({ status: "executed", approvedBy: "autopilot" });
    expect(s.threads[0].status).toBe("slots_proposed");
    expect(s.mock.outbox.at(-1)!.to).toBe("me@example.com");
  });
  it("autopilot cannot execute while AUTOPILOT is off", async () => {
    const t = await sentThread();
    await reply(t.id, "Interested");
    await checkReplies();
    await expect(executeAction((await readStore()).actions[0].id, "autopilot")).rejects.toThrow(/AUTOPILOT is off/);
  });
  it("an approved action cannot run twice", async () => {
    const t = await sentThread();
    await reply(t.id, "Interested");
    await checkReplies();
    const id = (await readStore()).actions[0].id;
    await executeAction(id, "human");
    await expect(executeAction(id, "human")).rejects.toThrow(/already executed/);
  });
});
