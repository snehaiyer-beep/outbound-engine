import { body, handle } from "@/lib/http";
import { HttpError } from "@/lib/drafts";
import { mutate, readStore } from "@/lib/store";
import { killMetrics, setKill } from "@/lib/safety/kill";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const s = await readStore();
  return { killSwitch: s.settings.killSwitch, autoTrip: s.settings.autoTrip, history: [...s.settings.killHistory].reverse(), metrics: killMetrics(s) };
});

// Stop everything / release. Only a person can release it.
export const POST = handle(async (req: Request) => {
  const b = await body<{ action?: string; reason?: string; autoTrip?: boolean }>(req);
  return mutate((s) => {
    if (b.action === "engage") setKill(s, true, String(b.reason ?? "").trim() || "Stopped by a person");
    else if (b.action === "release") setKill(s, false, String(b.reason ?? "").trim() || "Released by a person");
    else if (typeof b.autoTrip === "boolean") s.settings.autoTrip = b.autoTrip;
    else throw new HttpError(400, 'action must be "engage" or "release"');
    return { killSwitch: s.settings.killSwitch, autoTrip: s.settings.autoTrip, history: [...s.settings.killHistory].reverse(), metrics: killMetrics(s) };
  });
});
