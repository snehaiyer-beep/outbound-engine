import { config } from "../config";
import { mutate, newId, readStore } from "../store";
import type { Slot } from "../types";

export interface SlotQuery {
  from: Date;
  count: number;
  exclude: Slot[];
  timeHint?: string | null;
}

export interface Calendar {
  name: "cal.com" | "mock";
  findSlots(q: SlotQuery): Promise<Slot[]>;
  book(slot: Slot, attendee: { name: string; email: string }): Promise<{ bookingId: string }>;
}

const DURATION_MIN = 30;

export function slotLabel(startIso: string): string {
  const d = new Date(startIso);
  const tz = config.calendarTz();
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${f.format(d)} (${tz})`;
}

function makeSlot(start: Date): Slot {
  const end = new Date(start.getTime() + DURATION_MIN * 60_000);
  return { start: start.toISOString(), end: end.toISOString(), label: slotLabel(start.toISOString()) };
}

/** Interprets hints like "next week", "afternoon", "thursday" into a start date and hour preference. */
export function applyHint(from: Date, hint: string | null | undefined, offsetMin: number): { start: Date; hours: number[]; weekday: number | null } {
  let hours = [10, 12, 15];
  let start = from;
  let weekday: number | null = null;
  const h = (hint ?? "").toLowerCase();
  if (/afternoon|after lunch|later in the day/.test(h)) hours = [14, 15, 16];
  if (/morning/.test(h)) hours = [9, 10, 11];
  if (/next week/.test(h)) {
    const local = new Date(from.getTime() + offsetMin * 60_000);
    const daysToMon = ((8 - local.getUTCDay()) % 7) || 7;
    start = new Date(from.getTime() + (daysToMon - 1) * 86_400_000);
  }
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const idx = days.findIndex((d) => h.includes(d));
  if (idx >= 0) weekday = idx;
  return { start, hours, weekday };
}

const overlaps = (a: Slot, b: Slot) => a.start < b.end && b.start < a.end;

export const mockCalendar: Calendar = {
  name: "mock",
  async findSlots({ from, count, exclude, timeHint }) {
    const offset = config.calendarOffsetMinutes();
    const { start, hours, weekday } = applyHint(from, timeHint, offset);
    const busy = (await readStore()).mock.bookings.map((b) => b.slot);
    const out: Slot[] = [];
    for (let day = 1; day <= 30 && out.length < count; day++) {
      const local = new Date(start.getTime() + offset * 60_000 + day * 86_400_000);
      const dow = local.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      if (weekday !== null && dow !== weekday) continue;
      for (let i = 0; i < hours.length; i++) {
        const hour = hours[(day + i) % hours.length];
        const utc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, 0) - offset * 60_000;
        const slot = makeSlot(new Date(utc));
        if ([...busy, ...exclude].some((b) => overlaps(b, slot))) continue;
        out.push(slot);
        break; // one slot per day, spread across days
      }
    }
    return out;
  },
  async book(slot, attendee) {
    return mutate((s) => {
      if (s.mock.bookings.some((b) => overlaps(b.slot, slot))) throw new Error("Slot is no longer free");
      const id = newId("bk");
      s.mock.bookings.push({ id, slot, email: attendee.email });
      return { bookingId: id };
    });
  },
};

// Cal.com v2 adapter (only used when CALCOM_API_KEY and CALCOM_EVENT_TYPE_ID are set).
const calcom: Calendar = {
  name: "cal.com",
  async findSlots({ from, count, exclude, timeHint }) {
    const { start } = applyHint(from, timeHint, config.calendarOffsetMinutes());
    const url = new URL("https://api.cal.com/v2/slots");
    url.searchParams.set("eventTypeId", config.calcomEventTypeId());
    url.searchParams.set("start", start.toISOString());
    url.searchParams.set("end", new Date(start.getTime() + 14 * 86_400_000).toISOString());
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.calcomKey()}`, "cal-api-version": "2024-09-04" },
    });
    if (!res.ok) throw new Error(`Cal.com slots ${res.status}`);
    const data = (await res.json()) as { data: Record<string, { start: string }[]> };
    const out: Slot[] = [];
    for (const day of Object.keys(data.data).sort()) {
      const first = data.data[day].map((x) => makeSlot(new Date(x.start))).find((sl) => !exclude.some((e) => overlaps(e, sl)));
      if (first) out.push(first);
      if (out.length >= count) break;
    }
    return out;
  },
  async book(slot, attendee) {
    const res = await fetch("https://api.cal.com/v2/bookings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.calcomKey()}`,
        "cal-api-version": "2024-08-13",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        start: slot.start,
        eventTypeId: Number(config.calcomEventTypeId()),
        attendee: { name: attendee.name, email: attendee.email, timeZone: config.calendarTz() },
      }),
    });
    if (!res.ok) throw new Error(`Cal.com booking ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { data: { uid?: string; id?: number } };
    return { bookingId: String(data.data.uid ?? data.data.id) };
  },
};

export function getCalendar(): Calendar {
  return config.calcomKey() && config.calcomEventTypeId() ? calcom : mockCalendar;
}
