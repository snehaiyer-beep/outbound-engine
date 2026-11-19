import { body, handle, type IdCtx } from "@/lib/http";
import { HttpError, saveDraft } from "@/lib/drafts";

export const PUT = handle(async (req: Request, ctx: IdCtx) => {
  const b = await body<{ subject?: string; body?: string }>(req);
  if (typeof b.subject !== "string" || typeof b.body !== "string") throw new HttpError(400, "subject and body are required");
  return saveDraft((await ctx.params).id, { subject: b.subject, body: b.body });
});
