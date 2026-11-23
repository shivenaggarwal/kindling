import { randomUUID } from "node:crypto";
import type { Mailbox } from "../db/schema";
import { humanTime, isoWithOffset, localParts, zonedToUtc } from "../time";
import { calendarFor } from "./client";

/** Open slots over the next week, inside working hours in `tz`. */
export async function freeSlots(mailbox: Mailbox, tz: string, minutes: number, max = 10) {
  const cal = calendarFor(mailbox);
  const now = new Date();
  const until = new Date(now.getTime() + 8 * 24 * 3600 * 1000);
  const { data } = await cal.freebusy.query({
    requestBody: { timeMin: now.toISOString(), timeMax: until.toISOString(), timeZone: tz, items: [{ id: "primary" }] },
  });
  const busy = (data.calendars?.primary?.busy ?? []).map((b) => ({
    start: new Date(b.start!).getTime(),
    end: new Date(b.end!).getTime(),
  }));

  const earliest = now.getTime() + 18 * 3600 * 1000;
  const slots: Date[] = [];
  const perDay = new Map<string, number>();
  for (let dayOffset = 0; dayOffset < 8 && slots.length < max; dayOffset++) {
    const day = localParts(new Date(now.getTime() + dayOffset * 24 * 3600 * 1000), tz);
    if (day.weekday === 0 || day.weekday === 6) continue;
    for (let h = 10; h <= 16; h++) {
      for (const m of [0, 30]) {
        const start = zonedToUtc(day.year, day.month, day.day, h, m, tz);
        const s = start.getTime();
        const e = s + minutes * 60000;
        const key = `${day.year}-${day.month}-${day.day}`;
        if (s < earliest || (perDay.get(key) ?? 0) >= 3) continue;
        if (busy.some((b) => s < b.end && e > b.start)) continue;
        // Spread suggestions out: at least 90 minutes apart on the same day.
        if (slots.some((x) => Math.abs(x.getTime() - s) < 90 * 60000)) continue;
        slots.push(start);
        perDay.set(key, (perDay.get(key) ?? 0) + 1);
      }
    }
  }
  return slots.slice(0, max).map((d) => ({ iso: isoWithOffset(d, tz), label: humanTime(d, tz) }));
}

export async function createMeeting(
  mailbox: Mailbox,
  opts: { summary: string; description: string; start: Date; minutes: number; attendeeEmail: string; tz: string },
) {
  const cal = calendarFor(mailbox);
  const end = new Date(opts.start.getTime() + opts.minutes * 60000);
  const { data } = await cal.events.insert({
    calendarId: "primary",
    conferenceDataVersion: 1,
    sendUpdates: "all",
    requestBody: {
      summary: opts.summary,
      description: opts.description,
      start: { dateTime: opts.start.toISOString(), timeZone: opts.tz },
      end: { dateTime: end.toISOString(), timeZone: opts.tz },
      attendees: [{ email: opts.attendeeEmail }],
      conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
    },
  });
  return { eventId: data.id ?? null, meetLink: data.hangoutLink ?? null, end };
}
