// lib/lastActive.ts
//
// Throttlad "senast aktiv"-stämpel. Anropas från ofta-pollade endpoints
// (t.ex. friends/list) men skriver till DB som mest ~1/min per användare, så
// det inte blir en skrivning per poll. In-memory-throttlen är per instans
// (som lib/rateLimit) — i värsta fall några extra skrivningar, aldrig färre.
import { prisma } from "@/lib/prisma";

const lastWrite = new Map<string, number>();
const THROTTLE_MS = 60_000;

export function touchLastActive(uid: string | null | undefined): void {
  if (!uid) return;
  const now = Date.now();
  if (now - (lastWrite.get(uid) ?? 0) < THROTTLE_MS) return;
  lastWrite.set(uid, now);
  // Fire-and-forget: en missad stämpel spelar ingen roll.
  prisma.user.update({ where: { id: uid }, data: { lastActiveAt: new Date() } }).catch(() => {});
  // Enkelt skydd mot obundet minne.
  if (lastWrite.size > 10_000) lastWrite.clear();
}
