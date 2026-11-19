import { body, handle } from "@/lib/http";
import { HttpError } from "@/lib/drafts";
import { readStore } from "@/lib/store";
import { assertRunning } from "@/lib/safety/kill";
import { readListPage, searchLeads } from "@/lib/pipeline/discover";

export const maxDuration = 300;

// Find companies to check: web search (one query per line, max 5) or a list page URL.
export const POST = handle(async (req: Request) => {
  const b = await body<{ mode?: string; queries?: string[]; url?: string }>(req);
  const s = await readStore();
  assertRunning(s);
  let r;
  if (b.mode === "search") {
    if (!Array.isArray(b.queries) || !b.queries.some((q) => String(q).trim())) throw new HttpError(400, "Type at least one search");
    r = await searchLeads(b.queries.map(String));
  } else if (b.mode === "list") {
    if (!b.url?.trim()) throw new HttpError(400, "Paste the address of a page that lists companies");
    try {
      r = await readListPage(b.url);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  } else throw new HttpError(400, 'mode must be "search" or "list"');
  const known = new Map(s.companies.map((c) => [c.domain, c.status]));
  return { ...r, leads: r.leads.map((l) => ({ ...l, known: known.get(l.domain) ?? null })) };
});
