// Edge-safe (no Node imports): used by middleware.ts and by tests.

export const TOKEN_COOKIE = "oe_token";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function timingSafeEqualStr(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function hostname(hostHeader: string): string {
  return (hostHeader.startsWith("[") ? hostHeader.slice(0, hostHeader.indexOf("]") + 1) : hostHeader.split(":")[0]).toLowerCase();
}

/** Localhost always; plus exact hostnames listed in ALLOWED_HOSTS (e.g. the Vercel domain). */
export function isAllowedHost(hostHeader: string | null, allowed = ""): boolean {
  if (!hostHeader) return false;
  const host = hostname(hostHeader);
  if (LOCAL_HOSTS.has(host)) return true;
  return allowed
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .includes(host);
}

export function isLocalHost(hostHeader: string | null): boolean {
  return isAllowedHost(hostHeader, "");
}

export function extractToken(headers: Headers, cookieValue: string | undefined): string | null {
  const auth = headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const x = headers.get("x-api-token");
  if (x) return x.trim();
  return cookieValue ?? null;
}

export type AuthDecision =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 503; error: string };

export function authorize(opts: {
  host: string | null;
  pathname: string;
  presented: string | null;
  expected: string;
  allowedHosts?: string;
  /** AUTH_DISABLED=true: no sign-in. Host check still applies; sending stays locked to TEST_RECIPIENT. */
  authDisabled?: boolean;
}): AuthDecision {
  if (!isAllowedHost(opts.host, opts.allowedHosts)) return { ok: false, status: 403, error: "Host not allowed" };
  if (opts.authDisabled) return { ok: true };
  if (!opts.expected || opts.expected.length < 12)
    return { ok: false, status: 503, error: "API_TOKEN is not configured (min 12 chars); refusing all requests" };
  if (opts.pathname === "/login" || opts.pathname === "/api/auth/login") return { ok: true };
  if (!opts.presented || !timingSafeEqualStr(opts.presented, opts.expected))
    return { ok: false, status: 401, error: "Missing or invalid API token" };
  return { ok: true };
}
