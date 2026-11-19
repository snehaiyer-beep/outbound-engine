import { body, handle, type IdCtx } from "@/lib/http";
import { decideCompany, HttpError } from "@/lib/drafts";

export const maxDuration = 300;

export const POST = handle(async (req: Request, ctx: IdCtx) => {
  const b = await body<{ decision?: string; note?: string }>(req);
  if (b.decision !== "qualify" && b.decision !== "disqualify") throw new HttpError(400, 'decision must be "qualify" or "disqualify"');
  const c = await decideCompany((await ctx.params).id, b.decision, String(b.note ?? ""));
  return { id: c.id, status: c.status };
});
