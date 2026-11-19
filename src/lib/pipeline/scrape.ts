import * as cheerio from "cheerio";
import { fetchJson, fetchPage } from "../services/fetcher";
import { FIXTURE_SITES } from "../fixtures";
import { dedupe, findCerts, hiddenCertHits, visibleText } from "./certs";
import type { CertHit, PageResult, ScrapeResult } from "../types";

const PENDING = /pending|coming[\s_-]?soon|in[\s_-]?progress|todo|placeholder|upcoming/i;

export const BASE_PAGES = ["/", "/about", "/careers", "/security", "/trust"];
export const EXTRA_PAGES = ["/company", "/team", "/jobs", "/customers", "/pricing"];

const JOB_SELECTORS = [
  ".job", ".job-title", ".opening", ".position", ".posting-title", "[data-job]",
  'a[href*="/jobs/"]', 'a[href*="greenhouse.io"]', 'a[href*="lever.co"]', 'a[href*="ashbyhq.com"]',
  'a[href*="workable.com"]',
].join(", ");

export function extractJobTitles(html: string): string[] {
  const $ = cheerio.load(html);
  const titles = new Set<string>();
  $(JOB_SELECTORS).each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t && t.length < 120 && !/^(see|view) all/i.test(t)) titles.add(t);
  });
  return [...titles];
}

export function extractEmployeeHint(text: string): number | null {
  const patterns = [
    /(?:team of|we're|we are|over|more than)\s+(\d{1,3}(?:,\d{3})*|\d+)\+?\s*(?:people|employees|team members|staff)/i,
    /(\d{1,3}(?:,\d{3})*|\d+)\+?\s+(?:employees|people|team members|staff)\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return Number(m[1].replace(/,/g, ""));
  }
  return null;
}

function descriptionFrom(html: string): string {
  if (!html) return "";
  const $ = cheerio.load(html);
  const d = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || $("h1").first().text();
  return (d ?? "").replace(/\s+/g, " ").trim().slice(0, 220);
}

function companyNameFrom(html: string, domain: string): string {
  const $ = cheerio.load(html);
  const og = $('meta[property="og:site_name"]').attr("content");
  if (og) return og.trim();
  const title = $("title").text().split(/\s[|\-–—:]\s/)[0]?.trim();
  if (title) return title;
  const base = domain.split(".")[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export async function scrapePages(domain: string, paths: string[]): Promise<{ pages: PageResult[]; raw: Map<string, string>; mode: "live" | "mock" }> {
  const raw = new Map<string, string>();
  let mode: "live" | "mock" = "live";
  const pages = await Promise.all(
    paths.map(async (p) => {
      const r = await fetchPage(domain, p);
      mode = r.mode;
      if (r.html) raw.set(p, r.html);
      const text = r.html ? visibleText(r.html) : "";
      return {
        path: p,
        url: r.url,
        ok: r.status >= 200 && r.status < 300 && Boolean(r.html),
        status: r.status,
        text: text.slice(0, 4000),
        jobTitles: /career|job/.test(p) && r.html ? extractJobTitles(r.html) : [],
      } satisfies PageResult;
    }),
  );
  return { pages, raw, mode };
}

/** Builds the ScrapeResult from all fetched pages (base + any extra pages). */
export function analyse(domain: string, pages: PageResult[], raw: Map<string, string>, mode: "live" | "mock"): ScrapeResult {
  const visible: CertHit[] = [];
  for (const p of pages) if (p.ok) visible.push(...findCerts(p.text, "visible", p.path));
  let hidden: CertHit[] = [];
  if (visible.length === 0) {
    for (const [p, html] of raw) hidden.push(...hiddenCertHits(html, p));
    // A badge image (e.g. /compliance/soc-2.svg) is a certification a visitor can see,
    // unless its name says it is pending / coming soon.
    const displayed = hidden.filter((h) => h.source === "image" && !PENDING.test(h.snippet));
    visible.push(...displayed);
    hidden = hidden.filter((h) => !displayed.includes(h));
  }

  const jobTitles = [...new Set(pages.flatMap((p) => p.jobTitles))];
  let employeeHint: number | null = null;
  for (const p of pages) {
    const n = p.ok && !p.path.startsWith("web:") ? extractEmployeeHint(p.text) : null; // web answers are judged by the model
    if (n !== null) employeeHint = Math.max(employeeHint ?? 0, n);
  }
  return {
    pages,
    certs: { visible: dedupe(visible), hidden: dedupe(hidden) },
    openRoles: jobTitles.length,
    jobTitles,
    employeeHint,
    companyName: companyNameFrom(raw.get("/") ?? "", domain),
    description: descriptionFrom(raw.get("/") ?? ""),
    fetchedAt: new Date().toISOString(),
    mode,
  };
}

type Ats = "ashby" | "greenhouse" | "lever";
const ATS_LINKS: [Ats, RegExp][] = [
  ["ashby", /(?:jobs|api)\.ashbyhq\.com\/(?:posting-api\/job-board\/)?([\w.-]+)/i],
  ["greenhouse", /(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\/js\?for=)?([\w-]+)/i],
  ["lever", /jobs\.lever\.co\/([\w-]+)/i],
];

async function atsTitles(ats: Ats, org: string): Promise<{ url: string; titles: string[] } | null> {
  const url =
    ats === "ashby"
      ? `https://api.ashbyhq.com/posting-api/job-board/${org}`
      : ats === "greenhouse"
        ? `https://boards-api.greenhouse.io/v1/boards/${org}/jobs`
        : `https://api.lever.co/v0/postings/${org}?mode=json`;
  const data = (await fetchJson(url)) as { jobs?: { title?: string }[] } | { text?: string }[] | null;
  if (!data) return null;
  const list = Array.isArray(data) ? data.map((j) => j.text) : (data.jobs ?? []).map((j) => j.title);
  const titles = [...new Set(list.filter((t): t is string => Boolean(t)))];
  return { url, titles };
}

/**
 * Many companies list jobs on Ashby / Greenhouse / Lever, often rendered by JavaScript.
 * Uses a job-board link found in the site's HTML; otherwise tries the domain name as the board name
 * and labels that clearly as a guess.
 */
export async function findAtsJobs(domain: string, raw: Map<string, string>): Promise<PageResult | null> {
  if (FIXTURE_SITES[domain]) return null;
  const html = [...raw.values()].join("\n");
  for (const [ats, re] of ATS_LINKS) {
    const org = re.exec(html)?.[1];
    if (!org) continue;
    const r = await atsTitles(ats, org);
    if (r) return atsPage(ats, org, r, "linked from the website");
  }
  const slug = domain.split(".")[0];
  for (const ats of ["ashby", "greenhouse", "lever"] as Ats[]) {
    const r = await atsTitles(ats, slug);
    if (r && r.titles.length) return atsPage(ats, slug, r, `guessed from the domain name; verify it is the same company`);
  }
  return null;
}

function atsPage(ats: Ats, org: string, r: { url: string; titles: string[] }, how: string): PageResult {
  return {
    path: `${ats}:${org}`,
    url: r.url,
    ok: true,
    status: 200,
    text: `Job board on ${ats} (${how}): ${r.titles.length} open roles: ${r.titles.slice(0, 15).join("; ")}`,
    jobTitles: r.titles,
  };
}

export async function scrapeCompany(domain: string): Promise<{ result: ScrapeResult; raw: Map<string, string> }> {
  const { pages, raw, mode } = await scrapePages(domain, BASE_PAGES);
  if (pages.flatMap((p) => p.jobTitles).length < 3) {
    const ats = await findAtsJobs(domain, raw);
    if (ats) pages.push(ats);
  }
  return { result: analyse(domain, pages, raw, mode), raw };
}
