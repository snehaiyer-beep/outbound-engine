import { config } from "../config";
import { mutate, newId, now } from "../store";
import type { InboundMessage } from "../types";

export interface Inbox {
  name: "gmail-imap" | "mock";
  /** Returns new replies whose In-Reply-To/References match one of `knownMessageIds`. */
  fetchNew(knownMessageIds: Set<string>): Promise<InboundMessage[]>;
}

export function stripQuoted(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (/^On .+wrote:\s*$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l.trim())) break;
    if (l.trim().startsWith(">")) continue;
    out.push(l);
  }
  return out.join("\n").trim();
}

const mockInbox: Inbox = {
  name: "mock",
  async fetchNew() {
    return mutate((s) => {
      const msgs = s.mock.inbox;
      s.mock.inbox = [];
      return msgs;
    });
  },
};

const gmailImap: Inbox = {
  name: "gmail-imap",
  async fetchNew(known) {
    const { ImapFlow } = await import("imapflow");
    const { simpleParser } = await import("mailparser");
    const client = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user: config.gmailUser(), pass: config.gmailPassword() },
      logger: false,
    });
    await client.connect();
    const out: InboundMessage[] = [];
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - 14 * 86_400_000);
      const uids = (await client.search({ seen: false, since }, { uid: true })) || [];
      for (const uid of uids) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const refs = [parsed.inReplyTo, ...(Array.isArray(parsed.references) ? parsed.references : [parsed.references])].filter(
          (x): x is string => Boolean(x),
        );
        const match = refs.find((r) => known.has(r));
        if (!match) continue;
        out.push({
          id: newId("in"),
          threadId: null,
          from: parsed.from?.value[0]?.address ?? "",
          subject: parsed.subject ?? "",
          body: stripQuoted(parsed.text ?? ""),
          inReplyTo: match,
          receivedAt: (parsed.date ?? new Date()).toISOString(),
        });
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
      await client.logout();
    }
    return out;
  },
};

export function getInbox(): Inbox {
  return config.gmailUser() && config.gmailPassword() ? gmailImap : mockInbox;
}

/** Mock-only: drop a reply into the fake inbox as if the contact answered. */
export async function simulateReply(opts: { from: string; subject: string; body: string; inReplyTo: string }): Promise<InboundMessage> {
  const msg: InboundMessage = {
    id: newId("in"),
    threadId: null,
    from: opts.from,
    subject: opts.subject,
    body: opts.body,
    inReplyTo: opts.inReplyTo,
    receivedAt: now(),
  };
  await mutate((s) => {
    s.mock.inbox.push(msg);
  });
  return msg;
}
