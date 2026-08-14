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
import { getTranslations } from "next-intl/server";
import { normalizeLocale } from "@/lib/i18nConfig";
import { tmdbLanguageFor } from "@/lib/tmdbLanguage";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false;
  // Stöd både projektets egna x-cron-secret-header (se cron/cleanup) och
  // Vercel Cron:s inbyggda "Authorization: Bearer <CRON_SECRET>".
  const headerSecret = req.headers.get("x-cron-secret") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  return headerSecret === secret || authHeader === `Bearer ${secret}`;
}

// Höjs inte utan mätning: varje användare kostar ~100 TMDB-anrop, så det är
// TMDB:s takgräns som sätter taket här — inte Postgres och inte Vercel.
const CONCURRENCY = 5;

/**
 * Sluta plocka nya användare en bit före maxDuration. Vercel dödar funktionen
 * hårt vid gränsen, och en körning som kapas mitt i ett push-utskick är värre än
 * en användare som får sitt tips vid nästa körning.
 */
const TIME_BUDGET_MS = 240_000;

/** Returnerar antal påbörjade items; resten hann inte inom budgeten. */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  deadline: number,
  fn: (item: T) => Promise<void>,
): Promise<number> {
  let next = 0;
  let started = 0;
  async function worker() {
    for (let i = next++; i < items.length; i = next++) {
      if (Date.now() >= deadline) return;
      started++;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return started;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const deadline = Date.now() + TIME_BUDGET_MS;

  // Bara användare som faktiskt kan ta emot push (registrerad enhet) och har
  // en profil (krävs av rekommendationsmotorn).
  //
  // Ordningen är inte kosmetisk: den som väntat längst går först. Utan orderBy
  // returnerar Postgres raderna i samma ordning varje körning, så när
  // tidsbudgeten tar slut hade det alltid varit samma användare i svansen som
  // aldrig fick sin push. Nu roterar kön i stället.
  const users = await prisma.user.findMany({
    where: { pushTokens: { some: {} }, profile: { isNot: null } },
    select: {
      id: true,
      lastDailyRecTmdbId: true,
      lastDailyRecMediaType: true,
      profile: { select: { region: true, uiLanguage: true } },
    },
    orderBy: { lastDailyRecAt: { sort: "asc", nulls: "first" } },
  });

  let notified = 0;
  let skipped = 0;
  let failed = 0;

  const started = await mapWithConcurrency(users, CONCURRENCY, deadline, async (user) => {
    // Stämpla oavsett utfall. Stämplar vi bara vid lyckad push fastnar en
    // användare som konsekvent saknar förslag först i kön och blockerar alla
    // andra vid varje körning.
    await prisma.user
      .update({ where: { id: user.id }, data: { lastDailyRecAt: new Date() } })
      .catch(() => {
        /* best-effort: en missad stämpel ska inte stoppa utskicket */
      });

    try {
      const region = user.profile?.region || "SE";
      // Både TMDB-titeln och notistexten på MOTTAGARENS språk — cronen har
      // ingen cookie att läsa, så språket kommer från profilen.
      const uiLanguage = normalizeLocale(user.profile?.uiLanguage);
      const locale = tmdbLanguageFor(uiLanguage);
      const result = await computeUnifiedRecs({ uid: user.id, region, locale, groupCode: null, page: 1 });

      if (!result.ok || result.items.length === 0) {
        skipped++;
        return;
      }

      // Utan interaktion är recs-listan stabil → items[0] blev samma titel dag
      // efter dag. Hoppa över det senast pushade tipset; finns inget annat
      // (listan med exakt 1 titel) skickas den ändå hellre än ingenting.
      const pick =
        result.items.find(
          (i) => !(i.id === user.lastDailyRecTmdbId && i.tmdbType === user.lastDailyRecMediaType),
        ) ?? result.items[0];
      const t = await getTranslations({ locale: uiLanguage, namespace: "push.dailyRec" });
      const mediaWord = pick.tmdbType === "movie" ? t("movie") : t("series");
      const titleWithYear = pick.year ? `${pick.title} (${pick.year})` : pick.title;

      await sendPushToUser(user.id, {
        title: t("title"),
        body: t("body", { title: titleWithYear, media: mediaWord }),
        data: { type: "daily_rec", tmdbId: String(pick.id), tmdbType: pick.tmdbType },
      });
      await prisma.user
        .update({
          where: { id: user.id },
          data: { lastDailyRecTmdbId: pick.id, lastDailyRecMediaType: pick.tmdbType },
        })
        .catch(() => {
          /* best-effort — en missad stämpel ger i värsta fall en repris imorgon */
        });
      notified++;
    } catch (e) {
      failed++;
      console.warn("[cron/daily-recs] misslyckades för user", user.id, e instanceof Error ? e.message : e);
    }
  });

  // remaining > 0 betyder att tidsbudgeten tog slut. De hoppas inte över — de
  // ligger först i kön nästa körning tack vare lastDailyRecAt-sorteringen.
  const remaining = users.length - started;

  return NextResponse.json({
    ok: true,
    total: users.length,
    notified,
    skipped,
    failed,
    remaining,
    timedOut: remaining > 0,
  });
}
