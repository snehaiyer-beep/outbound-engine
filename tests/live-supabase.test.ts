// Opt-in: runs only with LIVE_SUPABASE=1 plus SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set.
// Checks the Supabase-backed store keeps read-modify-write atomic under concurrency.
import { describe, expect, it } from "vitest";
import { mutate, readStore, resetStore, storeBackend } from "@/lib/store";
import { sendEmail } from "@/lib/safety/outbox";

const live = process.env.LIVE_SUPABASE === "1";

describe.skipIf(!live)("Supabase store (live)", () => {
  it("uses the supabase backend", () => expect(storeBackend()).toBe("supabase"));

  it("20 concurrent mutations all land", async () => {
    await resetStore();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        mutate((s) => {
          s.suppression.push({ email: `c${i}@example.com`, reason: "concurrency test", at: new Date().toISOString() });
        }),
      ),
    );
    expect((await readStore()).suppression).toHaveLength(20);
  }, 120_000);

  it("concurrent sends cannot exceed the daily cap", async () => {
    await resetStore();
    Object.assign(process.env, { OFFLINE: "true", TEST_RECIPIENT: "me@example.com", DAILY_SEND_CAP: "3" });
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        sendEmail({
          kind: "cold",
          companyId: `co${i}`,
          contactId: `ct${i}`,
          intendedTo: `p${i}@example.com`,
          approval: { by: "human" },
          subject: "s",
          body: "b",
          threadId: `th${i}`,
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect((await readStore()).sends).toHaveLength(3);
    await resetStore();
  }, 120_000);
});
