import { handle, type IdCtx } from "@/lib/http";
import { companyDetail } from "@/lib/drafts";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: IdCtx) => companyDetail((await ctx.params).id));
