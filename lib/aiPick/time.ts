// lib/aiPick/time.ts
//
// Tidszonshjälp för "Välj åt mig": kvoten räknas per kalendermånad/-dygn i
// Europe/Stockholm (inte UTC — annars skulle premiumkvoten nollställas kl.
// 01/02 svensk tid den 1:a), och prompten får veckodag + timme lokalt.
// Rena funktioner utan beroenden, testbara med en fast `now`.

export const PICK_TZ = "Europe/Stockholm";

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function zonedParts(date: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: Math.max(0, WEEKDAYS.indexOf(out.weekday)),
  };
}

/** Zonens offset mot UTC i ms vid tidpunkten `date` (Stockholm: +1h/+2h). */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Lokal väggklocka (y/m/d 00:00) i zonen → UTC-instant. */
function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  // Två varv räcker: sommartidsbytet i Stockholm sker 02/03, aldrig vid midnatt.
  let ts = guess.getTime() - zoneOffsetMs(guess, timeZone);
  ts = guess.getTime() - zoneOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

/** Början på innevarande kalendermånad i Stockholm, som UTC-instant. */
export function stockholmMonthStart(now: Date = new Date()): Date {
  const p = zonedParts(now, PICK_TZ);
  return zonedMidnight(p.year, p.month, 1, PICK_TZ);
}

/** Början på innevarande kalenderdygn i Stockholm, som UTC-instant. */
export function stockholmDayStart(now: Date = new Date()): Date {
  const p = zonedParts(now, PICK_TZ);
  return zonedMidnight(p.year, p.month, p.day, PICK_TZ);
}

export type LocalClock = {
  /** "Monday" … "Sunday" (engelska — går till prompten). */
  weekday: string;
  /** 0–23 lokal timme. */
  hour: number;
  minute: number;
  /** Sön–tors kväll från 21 till 04 — "imorgon är en vardag". */
  lateWeeknight: boolean;
  /** Fre/lör kväll (inkl. natten efter). */
  weekendEvening: boolean;
};

const LONG_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function stockholmClock(now: Date = new Date()): LocalClock {
  const p = zonedParts(now, PICK_TZ);
  const hour = p.hour;
  // Natten efter (00–04) hör till kvällen innan.
  const eveningDay = hour < 4 ? (p.weekday + 6) % 7 : p.weekday;
  const isEvening = hour >= 21 || hour < 4;
  // Kvällar före en vardag: sön (0) – tors (4).
  const beforeWorkday = eveningDay >= 0 && eveningDay <= 4;
  return {
    weekday: LONG_WEEKDAYS[p.weekday],
    hour,
    minute: p.minute,
    lateWeeknight: isEvening && beforeWorkday,
    weekendEvening: (eveningDay === 5 || eveningDay === 6) && (hour >= 17 || hour < 4),
  };
}
