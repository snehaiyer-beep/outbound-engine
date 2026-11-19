import { NextResponse } from "next/server";
import { timingSafeEqualStr, TOKEN_COOKIE } from "@/lib/safety/auth";

export async function POST(req: Request) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  const expected = process.env.API_TOKEN ?? "";
  if (!token || !expected || !timingSafeEqualStr(token, expected))
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(TOKEN_COOKIE, token, { httpOnly: true, sameSite: "strict", path: "/", maxAge: 60 * 60 * 12 });
  return res;
}
