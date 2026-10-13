// app/api/pick/event/route.ts
//
// POST /api/pick/event { type, meta? } → 204. UI-händelser för /admin
// (öppna, chip, annons, upsell …). Typerna vitlistas (PICK_EVENT_TYPES), meta
// får vara max 1 KB JSON. Svarar alltid 204 — statistik får aldrig störa UI:t,
// och en anonym cookie utan användarrad (FK) loggas helt enkelt inte.

import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRateLimitKey, rateLimitAllow } from "@/lib/rateLimit";
import { PICK_EVENT_META_MAX, pickEventSchema } from "@/lib/aiPick/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noContent = () => new Response(null, { status: 204 });

export async function POST(req: Request) {
  const uid = (await cookies()).get("nw_uid")?.value ?? null;
  if (!uid) return noContent();
  // Statistik får inte gå att spamma: tabellen växer annars obegränsat och
  // /admin-trattens siffror blir skräp.
  if (!rateLimitAllow(getRateLimitKey(req, uid), "pick-event", { limit: 60 })) return noContent();

  try {
    const raw: unknown = await req.json();
    const parsed = pickEventSchema.safeParse(raw);
    if (!parsed.success) return noContent();

    let meta: Prisma.InputJsonValue | undefined;
    if (parsed.data.meta) {
      const s = JSON.stringify(parsed.data.meta);
      if (Buffer.byteLength(s, "utf8") <= PICK_EVENT_META_MAX) meta = JSON.parse(s) as Prisma.InputJsonValue;
    }

    await prisma.aiPickEvent.create({
      data: { userId: uid, type: parsed.data.type, ...(meta !== undefined ? { meta } : {}) },
    });
  } catch {
    // Trasig kropp, okänd användare (FK) eller DB-fel — tyst.
  }
  return noContent();
}
