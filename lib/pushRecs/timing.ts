// lib/pushRecs/timing.ts
//
// Tid för recs-pushar: Stockholm-klockan och (valfritt) en egen sändtid per
// användare. Hela filen är ren logik + en enda indexerad ratings-läsning, så
// cronen kan gata användare utan att dra igång den dyra rekommendationsmotorn.
//
// Per-användar-tid är AV som standard. Slå på med NW_PUSH_HOURLY=1 — då måste
// cronen anropas varje timme (se .github/workflows/push-cron.yml), annars
// träffar ingen sin timme.

import { prisma } from "@/lib/prisma";

export const PUSH_TZ = "Europe/Stockholm";

/** Hur många senaste betyg/swipes som får rösta om användarens "vanliga timme". */
const HISTORY_TAKE = 120;
/** Färre datapunkter än så är brus — då gäller standardtimmen. */
const MIN_DATA_POINTS = 8;
/**
 * En swipe klockan tre på natten är inte en tid då användaren vill ha en push.
 * Bara timmar i det här fönstret (inklusive) får rösta.
 */
const WINDOW_FROM = 8;
const WINDOW_TO = 22;

function defaultHour(): number {
  const raw = process.env.NW_PUSH_DEFAULT_HOUR;
  if (raw == null || raw.trim() === "") return 19;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 19;
}

/** True när cronen ska gata utskicken på varje användares egen timme. */
export function hourlyModeEnabled(): boolean {
  const v = (process.env.NW_PUSH_HOURLY ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: PUSH_TZ,
  weekday: "short",
  hour: "numeric",
  hourCycle: "h23",
});

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Veckodag (0 = söndag) och timme (0–23) i Stockholm — oavsett servrens tidszon. */
export function stockholmParts(d: Date): { weekday: number; hour: number } {
  let weekday = 0;
  let hour = 0;
  for (const p of partsFmt.formatToParts(d)) {
    if (p.type === "weekday") weekday = WEEKDAYS[p.value] ?? 0;
    if (p.type === "hour") hour = Number(p.value) % 24;
  }
  return { weekday, hour };
}

/**
 * Typvärdet (modalvärdet) av timmarna. Oavgjort vinner timmen närmast
 * standardtimmen, så att resultatet är stabilt mellan körningar.
 */
export function modeHour(dates: Date[], fallback: number = defaultHour()): number {
  const counts = new Map<number, number>();
  let n = 0;
  for (const d of dates) {
    const h = stockholmParts(d).hour;
    if (h < WINDOW_FROM || h > WINDOW_TO) continue;
    counts.set(h, (counts.get(h) ?? 0) + 1);
    n++;
  }
  if (n < MIN_DATA_POINTS) return fallback;
  let best = fallback;
  let bestCount = -1;
  for (const [h, c] of counts) {
    if (c > bestCount || (c === bestCount && Math.abs(h - fallback) < Math.abs(best - fallback))) {
      best = h;
      bestCount = c;
    }
  }
  return best;
}

/** Användarens föredragna push-timme (Stockholm) ur när hen brukar swipa. */
export async function preferredPushHour(userId: string): Promise<number> {
  const fallback = defaultHour();
  try {
    const rows = await prisma.rating.findMany({
      where: { userId },
      orderBy: { decidedAt: "desc" },
      take: HISTORY_TAKE,
      select: { decidedAt: true },
    });
    return modeHour(
      rows.map((r) => r.decidedAt),
      fallback,
    );
  } catch {
    return fallback;
  }
}
