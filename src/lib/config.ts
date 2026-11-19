// All config is read at call time so tests (and a restarted server) see current env.

function flag(name: string): boolean {
  return (process.env[name] ?? "").trim().toLowerCase() === "true";
}
function str(name: string): string {
  return (process.env[name] ?? "").trim();
}
function num(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  apiToken: () => str("API_TOKEN"),
  authDisabled: () => flag("AUTH_DISABLED"),
  testRecipient: () => str("TEST_RECIPIENT"),
  liveSending: () => flag("LIVE_SENDING"),
  dailySendCap: () => num("DAILY_SEND_CAP", 20),
  autopilot: () => flag("AUTOPILOT"),
  silentAfterDays: () => num("SILENT_AFTER_DAYS", 5),
  offline: () => flag("OFFLINE"),
  senderName: () => str("SENDER_NAME") || "Alex",
  senderCompany: () => str("SENDER_COMPANY") || "Sprinto",
  dataDir: () => str("DATA_DIR") || "data",
  anthropicKey: () => (flag("OFFLINE") ? "" : str("ANTHROPIC_API_KEY")),
  anthropicModel: () => str("ANTHROPIC_MODEL") || "claude-sonnet-5-5",
  geminiKey: () => (flag("OFFLINE") ? "" : str("GEMINI_API_KEY")),
  geminiModels: () =>
    (str("GEMINI_MODELS") || "gemini-3.7-flash,gemini-3.5-flash,gemini-3-flash-preview,gemini-3.1-flash-lite,gemini-3.5-flash-lite")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean),
  resendKey: () => (flag("OFFLINE") ? "" : str("RESEND_API_KEY")),
  resendFrom: () => str("RESEND_FROM") || "Outbound Engine <onboarding@resend.dev>",
  replyTo: () => str("REPLY_TO"),
  allowedHosts: () => str("ALLOWED_HOSTS"),
  hunterKey: () => (flag("OFFLINE") ? "" : str("HUNTER_API_KEY")),
  gmailUser: () => (flag("OFFLINE") ? "" : str("GMAIL_USER")),
  gmailPassword: () => (flag("OFFLINE") ? "" : str("GMAIL_APP_PASSWORD")),
  calcomKey: () => (flag("OFFLINE") ? "" : str("CALCOM_API_KEY")),
  calcomEventTypeId: () => str("CALCOM_EVENT_TYPE_ID"),
  hubspotToken: () => (flag("OFFLINE") ? "" : str("HUBSPOT_TOKEN")),
  calendarTz: () => str("CALENDAR_TZ") || "Asia/Kolkata",
  calendarOffsetMinutes: () => {
    const n = Number(process.env.CALENDAR_UTC_OFFSET_MINUTES);
    return Number.isFinite(n) ? n : 330;
  },
};

export function serviceModes() {
  const gmail = Boolean(config.gmailUser() && config.gmailPassword());
  return {
    llm: config.geminiKey() ? "gemini" : config.anthropicKey() ? "anthropic" : "mock",
    contacts: config.hunterKey() ? "hunter (fixtures for demo domains)" : "mock",
    email: config.resendKey() ? "resend" : gmail ? "gmail" : "mock",
    inbox: gmail ? "gmail-imap" : "mock",
    calendar: config.calcomKey() && config.calcomEventTypeId() ? "cal.com" : "mock",
    crm: config.hubspotToken() ? "hubspot" : "mock",
    storage: process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "local file",
    scraper: config.offline() ? "fixtures-only" : "live (fixtures for demo domains)",
  } as const;
}
