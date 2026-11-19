import crypto from "node:crypto";
import { mutate, newId, now } from "../store";
import { getMailer } from "../services/mailer";
import { checkSendGates, resolveRecipient, withUnsubscribe, type GateInput } from "./gates";
import type { SendLog } from "../types";

export class SendBlockedError extends Error {
  constructor(public reasons: string[]) {
    super(`Send blocked: ${reasons.join("; ")}`);
  }
}

export interface SendRequest extends GateInput {
  subject: string;
  body: string;
  threadId: string;
  inReplyTo?: string;
  references?: string[];
}

/**
 * THE ONLY function in the codebase that hands an email to a transport.
 * Gates are checked and the send is reserved in one synchronous store mutation,
 * so concurrent requests cannot exceed the cap or double-send.
 */
export async function sendEmail(req: SendRequest): Promise<SendLog> {
  const mailer = getMailer();
  const messageId = `<${crypto.randomUUID()}@outbound-engine.local>`;
  const text = withUnsubscribe(req.body);

  const log = await mutate((s) => {
    const reasons = checkSendGates(s, req);
    if (reasons.length) throw new SendBlockedError(reasons);
    const { to } = resolveRecipient(req.intendedTo);
    const entry: SendLog = {
      id: newId("send"),
      at: now(),
      kind: req.kind,
      companyId: req.companyId,
      contactId: req.contactId,
      intendedTo: req.intendedTo,
      actualTo: to,
      subject: req.subject,
      messageId,
      threadId: req.threadId,
      transport: mailer.name,
      approvedBy: req.approval!.by,
    };
    s.sends.push(entry);
    return entry;
  });

  try {
    await mailer.send({
      to: log.actualTo,
      subject: req.subject,
      text,
      messageId,
      inReplyTo: req.inReplyTo,
      references: req.references,
    });
  } catch (e) {
    await mutate((s) => {
      s.sends = s.sends.filter((x) => x.id !== log.id);
    });
    throw e;
  }
  return log;
}
