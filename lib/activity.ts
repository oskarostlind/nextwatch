// lib/activity.ts — stämplar "användaren var inne idag" (user_activity_days).
//
// Anropas av /api/track/active. Som mest en skrivning per användare och dygn
// och instans (in-memory-minne, samma princip som lib/lastActive) — databasen
// tar resten med ON CONFLICT DO NOTHING. Se lib/activitySql.ts för hur raderna
// används.
import { prisma } from "@/lib/prisma";

const written = new Map<string, string>();

/** Svensk kalenderdag som "YYYY-MM-DD". */
export function stockholmDay(d = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export async function recordActivityDay(uid: string): Promise<void> {
  const day = stockholmDay();
  if (written.get(uid) === day) return;
  // EXISTS-villkoret: nw_uid kan peka på en användare som inte finns (raderat
  // konto, besökare som aldrig gått via session/init) — då skrivs ingenting
  // i stället för att FK:n smäller.
  await prisma.$executeRaw`
    INSERT INTO user_activity_days (user_id, day)
    SELECT ${uid}, ${day}::date
    WHERE EXISTS (SELECT 1 FROM users WHERE id = ${uid})
    ON CONFLICT DO NOTHING
  `;
  written.set(uid, day);
  if (written.size > 20_000) written.clear();
}
