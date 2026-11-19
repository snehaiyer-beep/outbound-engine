import { handle } from "@/lib/http";
import { checkReplies } from "@/lib/replies/process";

export const POST = handle(async () => checkReplies());
