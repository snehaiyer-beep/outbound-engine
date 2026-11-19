import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetStore } from "@/lib/store";

const BASE_ENV = {
  OFFLINE: "true",
  API_TOKEN: "test-token-123456",
  TEST_RECIPIENT: "me@example.com",
  LIVE_SENDING: "false",
  DAILY_SEND_CAP: "20",
  AUTOPILOT: "false",
  SENDER_NAME: "Sam Tester",
  SENDER_COMPANY: "Sprinto",
  SILENT_AFTER_DAYS: "5",
  CALENDAR_TZ: "Asia/Kolkata",
  CALENDAR_UTC_OFFSET_MINUTES: "330",
};

/** Fresh temp data dir + fully offline env for every test. */
export async function freshEnv(overrides: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oe-test-"));
  Object.assign(process.env, BASE_ENV, { DATA_DIR: dir }, overrides);
  for (const k of ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "RESEND_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ALLOWED_HOSTS", "AUTH_DISABLED", "HUNTER_API_KEY", "GMAIL_USER", "GMAIL_APP_PASSWORD", "CALCOM_API_KEY", "HUBSPOT_TOKEN"])
    delete process.env[k];
  await resetStore();
  return dir;
}
