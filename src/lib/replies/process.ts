import { config } from "../config";
import { mutate, now, readStore } from "../store";
import { getInbox, stripQuoted } from "../services/inbox";
import { getCalendar } from "../services/calendar";
import { normalizeEmail } from "../safety/gates";
import { classifyReply } from "./classify";
import { createAction, type BookPayload, type CrmPayload, type SendEmailPayload } from "./actions";
import type { InboundMessage, Slot, Thread } from "../types";

function proposalBody(firstName: string, slots: Slot[], intro: string): string {
  return [
    `Hi ${firstName},`,
    "",
    intro,
    "",
    ...slots.map((s, i) => `${i + 1}. ${s.label}`),
    "",
    "Reply with the number that suits you and I'll send an invite.",
    "",
    "Best,",
    config.senderName(),
  ].join("\n");
}

async function flagHuman(threadId: string, reason: string) {
  await mutate((s) => {
    const t = s.threads.find((x) => x.id === threadId)!;
    t.status = "needs_human";
    t.needsHumanReason = reason;
    t.history.push({ at: now(), text: `Needs human: ${reason}` });
  });
}

export async function handleInbound(msg: InboundMessage): Promise<InboundMessage> {
  const s = (await readStore());
  const thread = s.threads.find((t) => msg.inReplyTo && t.messageIds.includes(msg.inReplyTo));
  if (!thread) {
    await mutate((st) => {
      st.inbound.push({ ...msg, threadId: null });
    });
    return msg;
  }
  const contact = s.contacts.find((c) => c.id === thread.contactId)!;
  const company = s.companies.find((c) => c.id === thread.companyId)!;
  const body = stripQuoted(msg.body);
  const classification = await classifyReply(body, thread.status === "slots_proposed" ? thread.proposedSlots : []);
  const stored: InboundMessage = { ...msg, body, threadId: thread.id, classification };
  await mutate((st) => {
    st.inbound.push(stored);
    const t = st.threads.find((x) => x.id === thread.id)!;
    t.history.push({ at: now(), text: `Reply classified as ${classification.category}: ${classification.reason}` });
  });

  switch (classification.category) {
    case "interested":
    case "asks_other_time": {
      const slots = await getCalendar().findSlots({
        from: new Date(),
        count: 3,
        exclude: thread.proposedSlots,
        timeHint: classification.timeHint,
      });
      if (slots.length < 3) {
        await flagHuman(thread.id, "Calendar has fewer than 3 free slots");
        break;
      }
      const intro =
        classification.category === "interested"
          ? "Thanks for getting back to me. Here are three times for a 30-minute call:"
          : "No problem. Here are three other times:";
      await createAction(thread.id, "send_email", `Propose 3 slots to ${contact.name} (${company.name})`, {
        subject: thread.subject,
        body: proposalBody(contact.firstName, slots, intro),
        proposeSlots: slots,
      } satisfies SendEmailPayload);
      break;
    }
    case "confirms_time": {
      const slot = thread.proposedSlots[classification.chosenSlotIndex!];
      await createAction(thread.id, "book_meeting", `Book ${slot.label} with ${contact.name} and send confirmation`, {
        slot,
      } satisfies BookPayload);
      break;
    }
    case "not_interested": {
      await mutate((st) => {
        if (classification.optOut && !st.suppression.some((x) => x.email === normalizeEmail(contact.email)))
          st.suppression.push({ email: normalizeEmail(contact.email), reason: "Opted out by reply", at: now() });
        const t = st.threads.find((x) => x.id === thread.id)!;
        t.status = "closed_lost";
      });
      await createAction(thread.id, "crm_log", `Log "not interested" for ${contact.name} (${company.name}) to CRM`, {
        outcome: classification.optOut ? "opted_out" : "not_interested",
        note: body.slice(0, 300),
      } satisfies CrmPayload);
      break;
    }
    default:
      await flagHuman(thread.id, `Unclear reply: ${classification.reason}`);
  }
  return stored;
}

/** Flags threads with no reply after SILENT_AFTER_DAYS for a human. */
export async function flagSilentThreads(at = new Date()): Promise<Thread[]> {
  const cutoff = at.getTime() - config.silentAfterDays() * 86_400_000;
  return mutate((s) => {
    const flagged: Thread[] = [];
    for (const t of s.threads) {
      if (t.status !== "awaiting_reply" && t.status !== "slots_proposed") continue;
      const lastIn = s.inbound.filter((m) => m.threadId === t.id).map((m) => m.receivedAt).sort().pop() ?? "";
      if (lastIn > t.lastOutboundAt) continue;
      if (new Date(t.lastOutboundAt).getTime() > cutoff) continue;
      t.status = "needs_human";
      t.needsHumanReason = `No reply in ${config.silentAfterDays()} days`;
      t.history.push({ at: now(), text: t.needsHumanReason });
      flagged.push(t);
    }
    return flagged;
  });
}

export async function checkReplies(): Promise<{ processed: InboundMessage[]; silent: Thread[] }> {
  const known = new Set((await readStore()).threads.flatMap((t) => t.messageIds));
  const msgs = await getInbox().fetchNew(known);
  const processed: InboundMessage[] = [];
  for (const m of msgs) processed.push(await handleInbound(m));
  return { processed, silent: await flagSilentThreads() };
}
