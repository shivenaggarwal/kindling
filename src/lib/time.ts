/** Small timezone helpers built on Intl, so we don't need a date-tz library. */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function localParts(date: Date, tz: string) {
  const parts = fmt(tz).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

/** Minutes east of UTC for `tz` at `date`. */
export function tzOffsetMinutes(date: Date, tz: string) {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Wall-clock time in `tz` → UTC Date. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string) {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const off = tzOffsetMinutes(guess, tz);
  const first = new Date(guess.getTime() - off * 60000);
  // Re-check once across DST boundaries.
  const off2 = tzOffsetMinutes(first, tz);
  return off2 === off ? first : new Date(guess.getTime() - off2 * 60000);
}

export function isoWithOffset(date: Date, tz: string) {
  const p = localParts(date, tz);
  const off = tzOffsetMinutes(date, tz);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function humanTime(date: Date, tz: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
