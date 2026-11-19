import { body, handle, type IdCtx } from "@/lib/http";
import { rejectAction } from "@/lib/replies/actions";

export const POST = handle(async (req: Request, ctx: IdCtx) => {
  const b = await body<{ reason?: string }>(req);
  return rejectAction((await ctx.params).id, String(b.reason ?? ""));
});
