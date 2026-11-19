import { body, handle } from "@/lib/http";
import { HttpError } from "@/lib/drafts";
import { runPipeline } from "@/lib/pipeline/run";

export const maxDuration = 300;

export const POST = handle(async (req: Request) => {
  const b = await body<unknown>(req);
  const list = Array.isArray(b) ? b : (b as { domains?: unknown })?.domains;
  if (!Array.isArray(list) || list.length === 0 || !list.every((d) => typeof d === "string"))
    throw new HttpError(400, 'Send a JSON list of domains: ["example.com"] or {"domains": [...]}');
  // On Vercel a function may run 5 minutes; about 1 minute per domain, so cap each request.
  if (process.env.VERCEL && list.length > 3)
    throw new HttpError(400, "Send at most 3 domains per request on the hosted app (the dashboard sends them one at a time)");
  const companies = await runPipeline(list as string[]);
  return { companies: companies.map((c) => ({ id: c.id, domain: c.domain, status: c.status, error: c.error })) };
});
