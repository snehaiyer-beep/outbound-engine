import { handle, type IdCtx } from "@/lib/http";
import { executeAction } from "@/lib/replies/actions";

export const POST = handle(async (_req: Request, ctx: IdCtx) => executeAction((await ctx.params).id, "human"));
