// lib/pushRecs/timing.ts
//
// Tid för recs-pushar: Stockholm-klockan och (valfritt) en egen sändtid per
// användare. Hela filen är ren logik + en enda indexerad ratings-läsning, så
// cronen kan gata användare utan att dra igång den dyra rekommendationsmotorn.
//
// Ett eget val i notisfrågan (profiles.push_hour, nya flödet 2026-10-15)
// vinner över typvärdet.
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

/** Timmarna användaren kan välja i notisfrågan (PushAskSheet, nya flödet). */
export const PUSH_HOUR_CHOICES = [18, 19, 20, 21] as const;

export function isValidPushHour(h: unknown): h is number {
  return typeof h === "number" && Number.isInteger(h) && (PUSH_HOUR_CHOICES as readonly number[]).includes(h);
}

/**
 * Sätts när profiles.push_hour visat sig saknas (SQL:en
 * prisma/sql/2026-10-15_push_hour.sql inte körd än). Då frågar vi inte igen på
 * en stund — annars blev det ett misslyckat anrop per användare och timme.
 * Efter MISSING_RECHECK_MS provar vi igen, så att SQL:en slår igenom utan deploy.
 */
const MISSING_RECHECK_MS = 10 * 60 * 1000;
let pushHourMissingAt = 0;
const columnKnownMissing = () => Date.now() - pushHourMissingAt < MISSING_RECHECK_MS;

function isMissingColumn(err: unknown): boolean {
  const e = err as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
  const msg = typeof e?.message === "string" ? e.message : "";
  // 42703 = undefined_column (Postgres); P2010/P2022 = Prismas omslag.
  return e?.code === "P2022" || e?.meta?.code === "42703" || /42703|push_hour.*does not exist|column .* does not exist/i.test(msg);
}

/**
 * Timmen användaren själv valt i notisfrågan (profiles.push_hour, Stockholm),
 * eller null. Rå SQL med flit: koden ska fungera innan kolumnen finns, och
 * klienten genereras inte om här (samma skäl som lib/genreStats.ts).
 */
export async function chosenPushHour(userId: string): Promise<number | null> {
  if (columnKnownMissing()) return null;
  try {
    const rows = await prisma.$queryRaw<Array<{ push_hour: number | null }>>`
      SELECT push_hour FROM profiles WHERE user_id = ${userId} LIMIT 1`;
    const h = rows[0]?.push_hour;
    return typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23 ? h : null;
  } catch (err) {
    if (isMissingColumn(err)) pushHourMissingAt = Date.now();
    return null;
  }
}

/**
 * Sparar vald timme. Returnerar "saved", "no_profile" (ingen profilrad än) eller
 * "column_missing" (SQL:en inte körd). Kastar aldrig.
 */
export async function savePushHour(
  userId: string,
  hour: number,
): Promise<"saved" | "no_profile" | "column_missing" | "error"> {
  try {
    const n = await prisma.$executeRaw`
      UPDATE profiles SET push_hour = ${hour}::smallint WHERE user_id = ${userId}`;
    pushHourMissingAt = 0;
    return n > 0 ? "saved" : "no_profile";
  } catch (err) {
    if (isMissingColumn(err)) {
      pushHourMissingAt = Date.now();
      return "column_missing";
    }
    return "error";
  }
}

/**
 * Användarens push-timme (Stockholm). Ett eget val i notisfrågan
 * (profiles.push_hour) vinner; annars typvärdet av när hen brukar swipa.
 */
export async function preferredPushHour(userId: string): Promise<number> {
  const chosen = await chosenPushHour(userId);
  if (chosen != null) return chosen;
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
