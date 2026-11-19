import * as cheerio from "cheerio";
import { config } from "../config";
import { FIXTURE_SITES } from "../fixtures";
import { llmMode, webResearch } from "../services/llm";
import { normalizeDomain } from "../services/fetcher";

// Layer 0: find companies to check, instead of only pasting websites.
// (a) web search via Gemini + Google Search, (b) read a list page (e.g. a startup directory).

export interface Lead {
  domain: string;
  name: string;
  note: string;
  source: string;
}

// Sites that are never prospects: social, directories, news, big platforms.
const NOT_COMPANIES = new Set(
  (
    "twitter.com x.com linkedin.com facebook.com instagram.com youtube.com tiktok.com github.com gitlab.com medium.com substack.com " +
    "google.com apple.com microsoft.com amazon.com aws.amazon.com wikipedia.org crunchbase.com producthunt.com ycombinator.com " +
    "techcrunch.com forbes.com bloomberg.com reuters.com wsj.com nytimes.com theverge.com wired.com businessinsider.com inc42.com yourstory.com " +
    "angel.co wellfound.com glassdoor.com indeed.com g2.com capterra.com trustpilot.com reddit.com quora.com discord.com discord.gg t.me " +
    "notion.site notion.so typeform.com calendly.com bit.ly goo.gl vercel.app netlify.app webflow.io framer.website wordpress.com " +
    "tracxn.com pitchbook.com cbinsights.com owler.com zoominfo.com apollo.io topstartups.io landbase.com"
  ).split(/\s+/),
);

export function looksLikeCompany(domain: string, exclude: string[] = []): boolean {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain)) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(domain)) return false;
  const root = domain.split(".").slice(-2).join(".");
  if (NOT_COMPANIES.has(domain) || NOT_COMPANIES.has(root) || exclude.includes(root)) return false;
  return !/\.(gov|edu|mil)(\.|$)/.test(domain);
}

/** Pull "domain | name | what they do" lines (or bare domains) out of a model answer. */
export function parseLeadLines(text: string, source: string): Lead[] {
  const out: Lead[] = [];
  for (const line of text.split(/\n+/)) {
    const m = /((?:[a-z0-9-]+\.)+[a-z]{2,})/i.exec(line);
    if (!m) continue;
    const domain = normalizeDomain(m[1]);
    if (!looksLikeCompany(domain)) continue;
    const parts = line.replace(/^[\s*\-\d.)]+/, "").split("|").map((x) => x.trim());
    out.push({
      domain,
      name: parts.length > 1 ? parts[1].replace(/\*+/g, "") : domain,
      note: (parts.length > 2 ? parts.slice(2).join(" ") : line.replace(m[1], "")).replace(/\*+/g, "").trim().slice(0, 160),
      source,
    });
  }
  return dedupe(out);
}

function dedupe(leads: Lead[]): Lead[] {
  const seen = new Set<string>();
  return leads.filter((l) => (seen.has(l.domain) ? false : (seen.add(l.domain), true)));
}

export async function searchLeads(queries: string[]): Promise<{ leads: Lead[]; notes: string[] }> {
  const qs = queries.map((q) => q.trim()).filter(Boolean).slice(0, 5);
  const notes: string[] = [];
  if (llmMode() === "mock") {
    notes.push("Practice mode: web search isn't connected, so these are the practice companies.");
    return {
      leads: Object.keys(FIXTURE_SITES).map((d) => ({ domain: d, name: d, note: "Practice company", source: `search: ${qs[0] ?? ""}` })),
      notes,
    };
  }
  const all: Lead[] = [];
  for (const q of qs) {
    const r = await webResearch(
      `Find up to 15 real companies that match: "${q}". Prefer B2B software (SaaS) startups that sell to other businesses.
List one company per line in exactly this format, with no other text:
domain | Company name | what they sell, in under 12 words
Use each company's own website domain (e.g. acme.com), never a news, directory or social media link.`,
    );
    if (!r) {
      notes.push(`"${q}": web search unavailable right now (AI quota or outage).`);
      continue;
    }
    const found = parseLeadLines(r.answer, `search: ${q}`);
    notes.push(`"${q}": ${found.length} compan${found.length === 1 ? "y" : "ies"} found`);
    all.push(...found);
  }
  return { leads: dedupe(all).slice(0, 60), notes };
}

function safeUrl(input: string): URL {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new Error("That doesn't look like a web address");
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) pages can be read");
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^[\d.]+$/.test(h) || h.includes(":"))
    throw new Error("Only public websites can be read");
  return u;
}

export async function readListPage(input: string): Promise<{ leads: Lead[]; notes: string[] }> {
  if (config.offline()) throw new Error("Reading a list page needs the internet (practice mode is on)");
  const url = safeUrl(input);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "OutboundEngine/0.1 (company research)", accept: "text/html" } });
  if (!res.ok) throw new Error(`That page answered ${res.status}`);
  const html = (await res.text()).slice(0, 2_000_000);
  const $ = cheerio.load(html);
  const self = url.hostname.replace(/^www\./, "").split(".").slice(-2).join(".");
  const leads: Lead[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!/^https?:\/\//i.test(href)) return;
    let domain: string;
    try {
      domain = normalizeDomain(new URL(href).hostname);
    } catch {
      return;
    }
    if (!looksLikeCompany(domain, [self])) return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const card = $(el).closest("li, article, tr, .card, [class*=card], [class*=item]").text().replace(/\s+/g, " ").trim();
    leads.push({ domain, name: text && text.length < 60 ? text : domain, note: card.slice(0, 160), source: `list: ${url.href}` });
  });
  const unique = dedupe(leads).slice(0, 80);
  return { leads: unique, notes: [`Found ${unique.length} company website${unique.length === 1 ? "" : "s"} linked from that page`] };
}
