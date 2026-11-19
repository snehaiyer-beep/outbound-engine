import { body, handle, type IdCtx } from "@/lib/http";
import { approveAndSend, HttpError } from "@/lib/drafts";

// The "Approve & Send" button. The UI sends confirm:true; nothing else sends a cold email.
export const POST = handle(async (req: Request, ctx: IdCtx) => {
  const b = await body<{ subject?: string; body?: string; confirm?: boolean; reviewSeconds?: number }>(req);
  if (b.confirm !== true) throw new HttpError(400, "Approve & Send requires confirm: true");
  if (typeof b.subject !== "string" || typeof b.body !== "string") throw new HttpError(400, "subject and body are required");
  return approveAndSend((await ctx.params).id, { subject: b.subject, body: b.body }, Number(b.reviewSeconds) || undefined);
});
