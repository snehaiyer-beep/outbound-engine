import { body, handle, type IdCtx } from "@/lib/http";
import { rejectDraft } from "@/lib/drafts";

export const POST = handle(async (req: Request, ctx: IdCtx) => {
  const b = await body<{ reason?: string; category?: string; reviewSeconds?: number }>(req);
  return rejectDraft((await ctx.params).id, String(b.reason ?? ""), b.category, Number(b.reviewSeconds) || undefined);
});
