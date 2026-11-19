import { config } from "../config";
import { FIXTURE_CONTACTS, FIXTURE_SITES, type FixtureContact } from "../fixtures";
import { newId } from "../store";
import type { Contact } from "../types";

// Who buys compliance automation, best first.
const ROLE_RANKS: [RegExp, number, string][] = [
  [/\b(ciso|chief information security|head of security|(?:vp|vice president),? (?:of )?(?:information )?security|security (lead|director)|director of security)\b/i, 100, "Owns security & certification"],
  [/\b(compliance|grc|governance|risk)\b/i, 90, "Owns compliance programme"],
  [/\b(cto|chief technology|(?:vp|vice president),? (?:of )?engineering|head of engineering)\b/i, 80, "Engineering leader; audits pull from their team"],
  [/\b(coo|chief operating|(?:vp|vice president),? (?:of )?operations|head of operations)\b/i, 65, "Runs operations and vendor/policy processes"],
  [/\b(ceo|founder|co-founder|president)\b/i, 60, "Founder/CEO; feels lost enterprise deals"],
  [/\b(head of it|it manager|devops|infrastructure|platform lead)\b/i, 55, "Owns infrastructure controls"],
  [/\b(engineering manager|director of engineering)\b/i, 50, "Engineering manager"],
  [/\b(cro|revenue|sales)\b/i, 30, "Sees security reviews block deals"],
];

export function rankRole(position: string, seniority = ""): { score: number; reason: string } {
  let score = 10;
  let reason = "Other role";
  for (const [re, s, r] of ROLE_RANKS) {
    if (re.test(position)) {
      score = s;
      reason = r;
      break;
    }
  }
  if (/executive/i.test(seniority)) score += 5;
  else if (/senior/i.test(seniority)) score += 2;
  return { score, reason };
}

interface HunterEmail {
  value: string;
  type?: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  seniority: string | null;
  confidence: number;
}

async function hunterSearch(domain: string): Promise<HunterEmail[]> {
  const url = new URL("https://api.hunter.io/v2/domain-search");
  url.searchParams.set("domain", domain);
  url.searchParams.set("type", "personal");
  url.searchParams.set("limit", "10");
  const res = await fetch(url, {
    headers: { "X-API-KEY": config.hunterKey() },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Hunter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { data?: { emails?: HunterEmail[] } };
  return data.data?.emails ?? [];
}

export async function findContacts(
  companyId: string,
  domain: string,
  max = 5,
): Promise<{ contacts: Contact[]; note: string }> {
  // Demo (fictional) domains always use fixtures, so they never spend Hunter credits.
  const live = Boolean(config.hunterKey()) && !FIXTURE_SITES[domain];
  let raw: (HunterEmail | FixtureContact)[];
  if (live) raw = await hunterSearch(domain);
  else raw = FIXTURE_CONTACTS[domain] ?? [];

  const contacts = raw
    .filter((e) => e.value && e.first_name && (!("type" in e) || e.type !== "generic"))
    .map((e) => {
      const position = e.position ?? "";
      const { score, reason } = rankRole(position, e.seniority ?? "");
      const first = e.first_name ?? "";
      return {
        id: newId("ct"),
        companyId,
        name: `${first} ${e.last_name ?? ""}`.trim(),
        firstName: first,
        email: e.value.toLowerCase(),
        position,
        seniority: e.seniority ?? "",
        confidence: e.confidence,
        rankScore: score,
        rankReason: reason,
        source: live ? "hunter" : "mock",
      } satisfies Contact;
    })
    .sort((a, b) => b.rankScore - a.rankScore || b.confidence - a.confidence)
    .slice(0, max);

  const note = contacts.length
    ? `${contacts.length} contact(s) from ${live ? "Hunter.io" : "offline mock"}`
    : live
      ? "Hunter.io returned no personal emails for this domain"
      : "No mock contacts for this domain (set HUNTER_API_KEY for live lookups)";
  return { contacts, note };
}
