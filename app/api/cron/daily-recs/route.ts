// app/api/cron/daily-recs/route.ts
//
// Schemalagt (Vercel Cron) jobb: skickar en gång om dagen en push per
// användare med ett personligt film/serie-tips, genom att återanvända
// samma rekommendationsmotor som app/api/recs/unified/route.ts
// (se lib/unifiedRecs.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { computeUnifiedRecs } from "@/lib/unifiedRecs";
import { sendPushToUser } from "@/lib/push";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false;
  // Stöd både projektets egna x-cron-secret-header (se cron/cleanup) och
  // Vercel Cron:s inbyggda "Authorization: Bearer <CRON_SECRET>".
  const headerSecret = req.headers.get("x-cron-secret") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  return headerSecret === secret || authHeader === `Bearer ${secret}`;
}

const CONCURRENCY = 5;

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker() {
    for (let i = next++; i < items.length; i = next++) {
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  // Bara användare som faktiskt kan ta emot push (registrerad enhet) och har
  // en profil (krävs av rekommendationsmotorn).
  const users = await prisma.user.findMany({
    where: { pushTokens: { some: {} }, profile: { isNot: null } },
    select: { id: true, profile: { select: { region: true, locale: true } } },
  });

  let notified = 0;
  let skipped = 0;
  let failed = 0;

  await mapWithConcurrency(users, CONCURRENCY, async (user) => {
    try {
      const region = user.profile?.region || "SE";
      const locale = user.profile?.locale || "sv-SE";
      const result = await computeUnifiedRecs({ uid: user.id, region, locale, groupCode: null, page: 1 });

      if (!result.ok || result.items.length === 0) {
        skipped++;
        return;
      }

      const pick = result.items[0];
      const mediaWord = pick.tmdbType === "movie" ? "film" : "serie";
      const titleWithYear = pick.year ? `${pick.title} (${pick.year})` : pick.title;

      await sendPushToUser(user.id, {
        title: "Dagens tips 🎬",
        body: `${titleWithYear} – en ${mediaWord} vi tror du gillar!`,
        data: { type: "daily_rec", tmdbId: String(pick.id), tmdbType: pick.tmdbType },
      });
      notified++;
    } catch (e) {
      failed++;
      console.warn("[cron/daily-recs] misslyckades för user", user.id, e instanceof Error ? e.message : e);
    }
  });

  return NextResponse.json({ ok: true, total: users.length, notified, skipped, failed });
}
