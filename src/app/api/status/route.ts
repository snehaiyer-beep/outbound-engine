import { handle } from "@/lib/http";
import { config, serviceModes } from "@/lib/config";
import { readStore } from "@/lib/store";
import { sentToday } from "@/lib/safety/gates";
import { DEMO_DOMAINS } from "@/lib/fixtures";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const s = (await readStore());
  return {
    services: serviceModes(),
    sending: {
      testRecipient: config.testRecipient() || null,
      liveSending: config.liveSending(),
      canSend: Boolean(config.testRecipient()) || config.liveSending(),
      dailyCap: config.dailySendCap(),
      sentToday: sentToday(s),
    },
    autopilot: config.autopilot(),
    authDisabled: config.authDisabled(),
    stopped: s.settings.killSwitch.engaged,
    stoppedReason: s.settings.killSwitch.reason ?? null,
    senderName: config.senderName(),
    suppressed: s.suppression.length,
    learnedEdits: s.edits.length,
    demoDomains: DEMO_DOMAINS,
  };
});
