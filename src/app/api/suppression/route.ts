import { body, handle } from "@/lib/http";
import { HttpError } from "@/lib/drafts";
import { mutate, now, readStore } from "@/lib/store";
import { normalizeEmail } from "@/lib/safety/gates";

export const dynamic = "force-dynamic";

export const GET = handle(async () => (await readStore()).suppression);

// Add-only on purpose: an opt-out is permanent.
export const POST = handle(async (req: Request) => {
  const b = await body<{ email?: string; reason?: string }>(req);
  const email = normalizeEmail(String(b.email ?? ""));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Valid email required");
  return mutate((s) => {
    if (!s.suppression.some((x) => x.email === email))
      s.suppression.push({ email, reason: String(b.reason ?? "Added manually"), at: now() });
    return s.suppression;
  });
});
