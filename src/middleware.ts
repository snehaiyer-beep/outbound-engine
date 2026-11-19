import { NextResponse, type NextRequest } from "next/server";
import { authorize, extractToken, TOKEN_COOKIE } from "@/lib/safety/auth";

export function middleware(req: NextRequest) {
  const decision = authorize({
    host: req.headers.get("host"),
    pathname: req.nextUrl.pathname,
    presented: extractToken(req.headers, req.cookies.get(TOKEN_COOKIE)?.value),
    expected: process.env.API_TOKEN ?? "",
    allowedHosts: process.env.ALLOWED_HOSTS ?? "",
    authDisabled: process.env.AUTH_DISABLED === "true",
  });
  if (decision.ok) {
    if (process.env.AUTH_DISABLED === "true" && req.nextUrl.pathname === "/login") return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }
  if (decision.status === 401 && !req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.json({ error: decision.error }, { status: decision.status });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
