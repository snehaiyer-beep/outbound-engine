import * as cheerio from "cheerio";
import type { CertHit, CertName } from "../types";

const PATTERNS: [CertName, RegExp][] = [
  ["SOC 2", /soc[\s_-]*(?:2|ii)(?![0-9])/i],
  ["ISO 27001", /iso[\s/_-]*(?:iec[\s_-]*)?27001/i],
  ["HIPAA", /(?<![a-z])hipaa(?![a-z])/i],
  ["PCI", /(?<![a-z])pci(?:[\s_-]*dss)?(?![a-z])/i],
];

function snippet(text: string, index: number): string {
  return text
    .slice(Math.max(0, index - 50), index + 60)
    .replace(/\s+/g, " ")
    .trim();
}

export function findCerts(text: string, source: CertHit["source"], page: string): CertHit[] {
  const hits: CertHit[] = [];
  for (const [cert, re] of PATTERNS) {
    const m = re.exec(text);
    if (m) hits.push({ cert, source, page, snippet: snippet(text, m.index) });
  }
  return hits;
}

/** Visible text = rendered text nodes only (no scripts, styles, comments, attributes). */
export function visibleText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, template, svg, head").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

/** Raw-HTML signals: HTML comments, image names/alt text, script src and inline script. */
export function hiddenCertHits(html: string, page: string): CertHit[] {
  const hits: CertHit[] = [];
  for (const m of html.matchAll(/<!--([\s\S]*?)-->/g)) hits.push(...findCerts(m[1], "html-comment", page));

  const $ = cheerio.load(html);
  $("img, source").each((_, el) => {
    const a = $(el);
    const blob = [a.attr("src"), a.attr("srcset"), a.attr("data-src"), a.attr("alt"), a.attr("title")]
      .filter(Boolean)
      .join(" ");
    hits.push(...findCerts(blob, "image", page));
  });
  $("script").each((_, el) => {
    const s = $(el);
    hits.push(...findCerts(`${s.attr("src") ?? ""} ${s.html() ?? ""}`, "script", page));
  });
  return dedupe(hits);
}

export function dedupe(hits: CertHit[]): CertHit[] {
  const seen = new Set<string>();
  return hits.filter((h) => {
    const k = `${h.cert}|${h.source}|${h.page}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
