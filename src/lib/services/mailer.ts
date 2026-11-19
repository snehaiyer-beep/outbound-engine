import { config } from "../config";
import { mutate, now } from "../store";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string;
  references?: string[];
}

export interface Mailer {
  name: "resend" | "gmail" | "mock";
  send(mail: OutgoingMail): Promise<void>;
}

function listUnsubscribe(): string {
  const addr = config.replyTo() || config.gmailUser() || config.testRecipient() || "sender@example.com";
  return `<mailto:${addr}?subject=unsubscribe>`;
}

const mockMailer: Mailer = {
  name: "mock",
  async send(mail) {
    await mutate((s) => {
      s.mock.outbox.push({
        messageId: mail.messageId,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        headers: {
          "List-Unsubscribe": listUnsubscribe(),
          ...(mail.inReplyTo ? { "In-Reply-To": mail.inReplyTo } : {}),
        },
        at: now(),
      });
    });
  },
};

const resendMailer: Mailer = {
  name: "resend",
  async send(mail) {
    const headers: Record<string, string> = { "List-Unsubscribe": listUnsubscribe() };
    if (mail.inReplyTo) headers["In-Reply-To"] = mail.inReplyTo;
    if (mail.references?.length) headers.References = mail.references.join(" ");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.resendKey()}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: config.resendFrom(),
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        ...(config.replyTo() ? { reply_to: config.replyTo() } : {}),
        headers,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  },
};

const gmailMailer: Mailer = {
  name: "gmail",
  async send(mail) {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: config.gmailUser(), pass: config.gmailPassword() },
    });
    await transport.sendMail({
      from: `${config.senderName()} <${config.gmailUser()}>`,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      messageId: mail.messageId,
      inReplyTo: mail.inReplyTo,
      references: mail.references,
      headers: { "List-Unsubscribe": listUnsubscribe() },
    });
  },
};

export function getMailer(): Mailer {
  if (config.resendKey()) return resendMailer;
  if (config.gmailUser() && config.gmailPassword()) return gmailMailer;
  return mockMailer;
}
