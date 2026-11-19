import { body, handle } from "@/lib/http";
import { HttpError } from "@/lib/drafts";
import { getInbox, simulateReply } from "@/lib/services/inbox";
import { readStore } from "@/lib/store";

// Mock inbox only: pretend the contact replied, so the reply flow can be exercised offline.
export const POST = handle(async (req: Request) => {
  if (getInbox().name !== "mock") throw new HttpError(403, "Simulated replies are only available with the mock inbox");
  const b = await body<{ threadId?: string; body?: string }>(req);
  const s = (await readStore());
  const t = s.threads.find((x) => x.id === b.threadId);
  if (!t || !b.body?.trim()) throw new HttpError(400, "threadId and body are required");
  const contact = s.contacts.find((c) => c.id === t.contactId)!;
  return simulateReply({
    from: contact.email,
    subject: `Re: ${t.subject}`,
    body: b.body,
    inReplyTo: t.messageIds[t.messageIds.length - 1],
  });
});
