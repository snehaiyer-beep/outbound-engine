import { config } from "../config";
import { FIXTURE_SITES } from "../fixtures";

export interface FetchedPage {
  url: string;
  status: number;
  html: string;
  mode: "live" | "mock";
}

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
}

const MAX_BYTES = 1_500_000;

export async function fetchPage(domain: string, path: string): Promise<FetchedPage> {
  const url = `https://${domain}${path}`;
  const fixture = FIXTURE_SITES[domain];
  if (fixture || config.offline()) {
    const html = fixture?.[path];
    return { url, status: html ? 200 : 404, html: html ?? "", mode: "mock" };
  }
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "OutboundEngine/0.1 (company research)", accept: "text/html" },
    });
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html")) return { url, status: res.status, html: "", mode: "live" };
    const html = (await res.text()).slice(0, MAX_BYTES);
    return { url, status: res.status, html: res.ok ? html : "", mode: "live" };
  } catch {
    return { url, status: 0, html: "", mode: "live" };
  }
}

/** JSON GET for public job-board APIs. Never runs offline or for demo domains. */
export async function fetchJson(url: string): Promise<unknown | null> {
  if (config.offline()) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
