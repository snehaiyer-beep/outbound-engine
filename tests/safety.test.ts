import { beforeEach, describe, expect, it } from "vitest";
import { freshEnv } from "./helpers";
import { authorize, isLocalHost } from "@/lib/safety/auth";
import { checkSendGates, resolveRecipient, UNSUBSCRIBE_LINE, withUnsubscribe } from "@/lib/safety/gates";
import { sendEmail, SendBlockedError } from "@/lib/safety/outbox";
import { mutate, readStore } from "@/lib/store";
import { serviceModes } from "@/lib/config";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";

const base = {
  kind: "cold" as const,
  companyId: "co_1",
  contactId: "ct_1",
  intendedTo: "real.person@prospect.com",
  approval: { by: "human" as const },
  subject: "SOC 2 at Prospect",
  body: "Hi Real,\n\nBody.",
  threadId: "th_1",
};

beforeEach(async () => {
  await freshEnv();
});

describe("API token + localhost", () => {
  const ok = { host: "127.0.0.1:3000", pathname: "/api/companies", presented: "test-token-123456", expected: "test-token-123456" };
  it("accepts the right token on localhost", () => expect(authorize(ok).ok).toBe(true));
  it("rejects a missing or wrong token", () => {
    expect(authorize({ ...ok, presented: null })).toMatchObject({ ok: false, status: 401 });
    expect(authorize({ ...ok, presented: "test-token-12345X" })).toMatchObject({ ok: false, status: 401 });
  });
  it("rejects non-local Host headers (DNS rebinding / LAN access)", () => {
    expect(authorize({ ...ok, host: "evil.com" })).toMatchObject({ ok: false, status: 403 });
    expect(authorize({ ...ok, host: "192.168.1.5:3000" })).toMatchObject({ ok: false, status: 403 });
    expect(isLocalHost("localhost:3000")).toBe(true);
    expect(isLocalHost("[::1]:3000")).toBe(true);
  });
  it("allows only exact extra hosts from ALLOWED_HOSTS (for the deployed domain)", () => {
    expect(authorize({ ...ok, host: "outbound.vercel.app", allowedHosts: "outbound.vercel.app" }).ok).toBe(true);
    expect(authorize({ ...ok, host: "evil-outbound.vercel.app", allowedHosts: "outbound.vercel.app" })).toMatchObject({ ok: false, status: 403 });
    expect(authorize({ ...ok, host: "outbound.vercel.app", allowedHosts: "outbound.vercel.app", presented: null })).toMatchObject({ ok: false, status: 401 });
  });
  it("AUTH_DISABLED skips the token but still refuses foreign hosts", () => {
    expect(authorize({ ...ok, presented: null, authDisabled: true }).ok).toBe(true);
    expect(authorize({ ...ok, presented: null, authDisabled: true, host: "evil.com" })).toMatchObject({ ok: false, status: 403 });
  });
  it("with sign-in off, real prospects can never be emailed, even with LIVE_SENDING", () => {
    process.env.AUTH_DISABLED = "true";
    process.env.LIVE_SENDING = "true";
    process.env.TEST_RECIPIENT = "";
    try {
      expect(() => resolveRecipient("x@y.com")).toThrow(/AUTH_DISABLED/);
      process.env.TEST_RECIPIENT = "me@example.com";
      expect(resolveRecipient("x@y.com").to).toBe("me@example.com");
    } finally {
      delete process.env.AUTH_DISABLED;
    }
  });
  it("fails closed when API_TOKEN is unset", () => {
    expect(authorize({ ...ok, expected: "" })).toMatchObject({ ok: false, status: 503 });
  });
  it("middleware blocks API calls without a token and allows with one", () => {
    const noToken = middleware(new NextRequest("http://localhost:3000/api/companies", { headers: { host: "localhost:3000" } }));
    expect(noToken.status).toBe(401);
    const withToken = middleware(
      new NextRequest("http://localhost:3000/api/companies", { headers: { host: "localhost:3000", authorization: "Bearer test-token-123456" } }),
    );
    expect(withToken.status).toBe(200);
    const page = middleware(new NextRequest("http://localhost:3000/", { headers: { host: "localhost:3000" } }));
    expect(page.status).toBe(307);
  });
  it("npm scripts bind the server to 127.0.0.1", async () => {
    const pkg = (await import("../package.json")).default as { scripts: Record<string, string> };
    expect(pkg.scripts.dev).toContain("-H 127.0.0.1");
    expect(pkg.scripts.start).toContain("-H 127.0.0.1");
  });
});

describe("recipient routing", () => {
  it("redirects everything to TEST_RECIPIENT while it is set, even with LIVE_SENDING", () => {
    process.env.LIVE_SENDING = "true";
    expect(resolveRecipient("x@y.com")).toEqual({ to: "me@example.com", redirected: true });
  });
  it("blocks sending when neither TEST_RECIPIENT nor LIVE_SENDING is set", () => {
    process.env.TEST_RECIPIENT = "";
    expect(() => resolveRecipient("x@y.com")).toThrow(/blocked/);
  });
  it("sends to the real address only with TEST_RECIPIENT empty AND LIVE_SENDING=true", () => {
    process.env.TEST_RECIPIENT = "";
    process.env.LIVE_SENDING = "true";
    expect(resolveRecipient("x@y.com")).toEqual({ to: "x@y.com", redirected: false });
  });
  it("actually delivers the mock email to TEST_RECIPIENT", async () => {
    const log = await sendEmail(base);
    expect(log.actualTo).toBe("me@example.com");
    expect((await readStore()).mock.outbox[0].to).toBe("me@example.com");
  });
});

describe("send gates", () => {
  it("requires an approval, and cold email needs a human", async () => {
    expect(checkSendGates((await readStore()), { ...base, approval: null })).toContain("No approval: every send needs an explicit approval");
    expect(checkSendGates((await readStore()), { ...base, approval: { by: "autopilot" } }).join()).toMatch(/human Approve & Send/);
  });
  it("autopilot approval is refused when AUTOPILOT is off", async () => {
    expect(checkSendGates((await readStore()), { ...base, kind: "reply", approval: { by: "autopilot" } }).join()).toMatch(/AUTOPILOT/);
  });
  it("never emails a suppressed address", async () => {
    await mutate((s) => s.suppression.push({ email: "real.person@prospect.com", reason: "opt out", at: new Date().toISOString() }));
    await expect(sendEmail({ ...base, intendedTo: "Real.Person@prospect.com " })).rejects.toBeInstanceOf(SendBlockedError);
    expect((await readStore()).mock.outbox).toHaveLength(0);
  });
  it("enforces the daily cap", async () => {
    process.env.DAILY_SEND_CAP = "2";
    await sendEmail({ ...base, companyId: "a", contactId: "a1" });
    await sendEmail({ ...base, companyId: "b", contactId: "b1" });
    await expect(sendEmail({ ...base, companyId: "c", contactId: "c1" })).rejects.toThrow(/Daily send cap/);
    expect((await readStore()).sends).toHaveLength(2);
  });
  it("allows at most one contact per company", async () => {
    await sendEmail(base);
    await expect(sendEmail({ ...base, contactId: "ct_2", intendedTo: "other@prospect.com" })).rejects.toThrow(/one per company/);
  });
  it("does not cold-email the same contact twice", async () => {
    await sendEmail(base);
    await expect(sendEmail(base)).rejects.toThrow(/already received/);
  });
  it("appends the unsubscribe line to every email", async () => {
    await sendEmail(base);
    expect((await readStore()).mock.outbox[0].text.endsWith(UNSUBSCRIBE_LINE)).toBe(true);
    expect((await readStore()).mock.outbox[0].headers["List-Unsubscribe"]).toMatch(/mailto:/);
    expect(withUnsubscribe(withUnsubscribe("x"))).toBe(withUnsubscribe("x"));
  });
});

describe("offline mocks", () => {
  it("every external service uses its mock when keys are missing", () => {
    process.env.OFFLINE = "false";
    const m = serviceModes();
    expect([m.llm, m.contacts, m.email, m.inbox, m.calendar, m.crm]).toEqual(["mock", "mock", "mock", "mock", "mock", "mock"]);
  });
  it("OFFLINE=true forces mocks even with keys present", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.HUNTER_API_KEY = "h";
    expect(serviceModes().llm).toBe("mock");
    expect(serviceModes().contacts).toBe("mock");
  });
});
