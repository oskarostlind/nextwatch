// app/api/cron/daily-recs/route.ts
//
// Schemalagt (Vercel Cron) jobb som skickar en push per användare med ett
// personligt film/serie-tips, genom att återanvända samma rekommendationsmotor
// som app/api/recs/unified/route.ts (se lib/unifiedRecs.ts).
//
// Trots namnet är utskicket inte längre dagligt per användare. Cron-schemat
// ligger i Vercel-dashboarden (INTE i repot) och körs fortfarande varje dag —
// takten bestäms här inne i stället, av två skäl:
//   1. En push om dagen är för mycket. lastRecPushSentAt hindrar en ny
//      recs-push inom NW_REC_PUSH_MIN_HOURS (default 60 h → 2–3 per vecka).
//   2. Den som slutat använda appen ska inte ha ett filmtips utan en
//      "vi saknar dig"-push (Duolingo-stil), som eskalerar med hur länge
//      användaren varit borta.
// Att ändra takten kräver alltså ingen ändring av cron-schemat, bara env.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { computeUnifiedRecs } from "@/lib/unifiedRecs";
import { sendLocalizedPushToUser, sendPushToUser } from "@/lib/push";
import { refreshPendingReleaseDates } from "@/lib/upcomingTitles";
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

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Tal ur env, med fallback när variabeln saknas eller är skräp. 0 tillåts. */
function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Minsta tid mellan två recs-pushar till samma användare. 60 h innebär att
 * cronen (som körs dagligen) i praktiken landar på 2–3 pushar per vecka:
 * dygnet efter en push är det för tidigt, dygnet därpå går den igenom.
 * 0 = ingen spärr, dvs. gammalt beteende med en push om dagen.
 */
const REC_PUSH_MIN_HOURS = numEnv("NW_REC_PUSH_MIN_HOURS", 60);

/**
 * Trappan för "vi saknar dig"-pushen: antal dygn utan aktivitet som krävs för
 * respektive tonläge (mild → orolig). Index i listan = index i
 * REENGAGE_VARIANTS. Måste vara stigande.
 */
const REENGAGE_TIER_DAYS = [
  numEnv("NW_REENGAGE_TIER1_DAYS", 7),
  numEnv("NW_REENGAGE_TIER2_DAYS", 14),
  numEnv("NW_REENGAGE_TIER3_DAYS", 30),
];

/**
 * Minsta tid mellan två "vi saknar dig"-pushar. Utan den hade en användare som
 * varit borta i en månad fått samma tjat varje dygn — vilket är precis det som
 * får folk att stänga av notiser helt. 0 = stäng av re-engagement helt.
 */
const REENGAGE_MIN_DAYS = numEnv("NW_REENGAGE_MIN_DAYS", 5);

/**
 * Textvarianter per nivå, som nycklar under push.reEngagement.variants i
 * messages/*.json. Nycklarna ligger som id:n här (inte som byggda strängar) så
 * att scripts/check-i18n-keys.mjs kan verifiera prefixet, och så att en variant
 * kan tas bort utan att koden slutar gå ihop.
 */
const REENGAGE_VARIANTS: readonly (readonly string[])[] = [
  ["t1v1", "t1v2", "t1v3", "t1v4"],
  ["t2v1", "t2v2", "t2v3", "t2v4"],
  ["t3v1", "t3v2", "t3v3", "t3v4"],
];

/** Högsta trappsteget användaren kvalar in på, eller -1 = fortfarande aktiv. */
function reEngagementTier(lastSeen: Date | null, now: number): number {
  if (REENGAGE_MIN_DAYS <= 0 || !lastSeen) return -1;
  const days = (now - lastSeen.getTime()) / DAY_MS;
  let tier = -1;
  for (let i = 0; i < REENGAGE_TIER_DAYS.length && i < REENGAGE_VARIANTS.length; i++) {
    if (days >= REENGAGE_TIER_DAYS[i]) tier = i;
  }
  return tier;
}

/** Slumpar en variant, men aldrig samma som förra gången — tjatet ska variera. */
function pickVariant(tier: number, previous: string | null): string {
  const pool = REENGAGE_VARIANTS[tier];
  const fresh = pool.filter((v) => v !== previous);
  const list = fresh.length > 0 ? fresh : pool;
  return list[Math.floor(Math.random() * list.length)];
}

/* ---------------- Släpp-notiser (ReleaseFollow) ---------------- */

/** Tak per körning — svepet ska inte kunna äta hela tidsbudgeten. */
const RELEASE_SWEEP_MAX = 200;
/**
 * Högst så här många släpp-notiser per användare och körning. Följer man tio
 * titlar med samma premiärdatum ska man få ett pling, inte tio. Resten ligger
 * kvar med notifiedAt = null och går ut vid nästa körning.
 */
const RELEASE_MAX_PER_USER = 3;

/**
 * Skickar en push för varje bevakad titel som hunnit släppas, och stämplar
 * notifiedAt.
 *
 * Körs som ett FÖRPASS, före per-användar-loopen: det är billigt (en indexerad
 * fråga, se @@index([notifiedAt, releaseDate])) och ska inte konkurrera med
 * recs-loopens tidsbudget. Hela passet ligger i try/catch — ett fel här får
 * aldrig stoppa dagens filmtips.
 *
 * Notistypen "release" är MED FLIT omappad i TYPE_TO_PREF_COLUMN (lib/push.ts):
 * användaren har uttryckligen bett om just den här notisen genom att gilla ett
 * "Kommer snart"-kort, så den följer ingen generell notisinställning.
 */
async function sweepReleaseNotifications(): Promise<{
  sent: number;
  refreshed: number;
  failed: number;
}> {
  let sent = 0;
  let refreshed = 0;
  let failed = 0;
  try {
    // 1) Fyll på datum som saknades eller flyttats. Måste ligga FÖRE utskicket:
    // en titel som stod som TBA när den gillades kan ha fått sitt datum, och då
    // ska plinget gå redan i samma körning.
    refreshed = await refreshPendingReleaseDates().catch(() => 0);

    const due = await prisma.releaseFollow.findMany({
      where: { notifiedAt: null, releaseDate: { not: null, lte: new Date() } },
      select: { id: true, userId: true, tmdbId: true, mediaType: true, title: true },
      orderBy: { releaseDate: "asc" },
      take: RELEASE_SWEEP_MAX,
    });

    const perUser = new Map<string, number>();
    for (const f of due) {
      const n = perUser.get(f.userId) ?? 0;
      if (n >= RELEASE_MAX_PER_USER) continue;
      perUser.set(f.userId, n + 1);
      try {
        await sendLocalizedPushToUser(f.userId, {
          key: "release",
          values: { title: f.title },
          data: { type: "release", tmdbId: String(f.tmdbId), tmdbType: f.mediaType },
        });
        await prisma.releaseFollow.update({
          where: { id: f.id },
          data: { notifiedAt: new Date() },
        });
        sent++;
      } catch (e) {
        failed++;
        console.warn(
          "[cron/daily-recs] släpp-notis misslyckades för follow",
          f.id,
          e instanceof Error ? e.message : e,
        );
      }
    }
  } catch (e) {
    failed++;
    console.warn(
      "[cron/daily-recs] släpp-svepet misslyckades:",
      e instanceof Error ? e.message : e,
    );
  }
  return { sent, refreshed, failed };
}

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

  const startedAt = Date.now();
  const deadline = startedAt + TIME_BUDGET_MS;
  // En och samma "nu" för hela körningen, så att den som råkar hamna sist i kön
  // inte bedöms mot en klocka som hunnit fyra minuter längre fram.
  const now = startedAt;

  // Förpass: "nu har den släppts"-notiser för bevakade titlar (ReleaseFollow,
  // se lib/upcomingTitles.ts). Egen felhantering inuti — får aldrig blockera
  // recs-körningen nedan. Tiden det tar äter av samma budget (deadline räknas
  // från startedAt), så en långsam sweep betyder färre filmtips den här
  // körningen — inte en kapad funktion: kön roterar på lastDailyRecAt.
  const release = await sweepReleaseNotifications();

  // Bara användare som faktiskt kan ta emot push (registrerad enhet) och har
  // en profil (krävs av rekommendationsmotorn). Samma urval gäller båda
  // notistyperna — även "vi saknar dig" kräver ju en enhet att skicka till.
  //
  // Ordningen är inte kosmetisk: den som väntat längst går först. Utan orderBy
  // returnerar Postgres raderna i samma ordning varje körning, så när
  // tidsbudgeten tar slut hade det alltid varit samma användare i svansen som
  // aldrig fick sin push. Nu roterar kön i stället.
  const users = await prisma.user.findMany({
    where: { pushTokens: { some: {} }, profile: { isNot: null } },
    select: {
      id: true,
      createdAt: true,
      lastActiveAt: true,
      lastDailyRecTmdbId: true,
      lastDailyRecMediaType: true,
      lastRecPushSentAt: true,
      lastReEngagementPushAt: true,
      lastReEngagementVariant: true,
      profile: { select: { region: true, uiLanguage: true } },
    },
    orderBy: { lastDailyRecAt: { sort: "asc", nulls: "first" } },
  });

  let notified = 0;
  let skipped = 0;
  let failed = 0;
  /** Fick ingen recs-push för att det var för kort sedan sist. Inte ett fel. */
  let throttled = 0;
  /** Fick en "vi saknar dig"-push i stället för ett filmtips. */
  let reEngaged = 0;

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

      // ---- 1) Har vi tappat användaren? Då är ett filmtips fel notis. ----
      //
      // lastActiveAt saknas för den som inte varit inne sedan kolumnen kom, och
      // för nyregistrerade som ännu inte hunnit swipa. createdAt som fallback
      // gör att en färsk användare inte får "du har varit borta i en månad"
      // dagen efter registreringen.
      const lastSeen = user.lastActiveAt ?? user.createdAt;
      const tier = reEngagementTier(lastSeen, now);
      const reEngageCooldownOver =
        !user.lastReEngagementPushAt ||
        now - user.lastReEngagementPushAt.getTime() >= REENGAGE_MIN_DAYS * DAY_MS;

      // Ingen inställningsflagga här — produktbeslut 2026-08-20: "vi saknar
      // dig"-pushen är standard för alla. Enda opt-outen är att neka push på
      // OS-nivå (då finns inga tokens och sendPushToUser blir en no-op).
      // NW_REENGAGE_MIN_DAYS=0 är kill switch för hela featuren.
      if (tier >= 0 && reEngageCooldownOver) {
        const variant = pickVariant(tier, user.lastReEngagementVariant);
        const tRe = await getTranslations({ locale: uiLanguage, namespace: "push.reEngagement" });
        await sendPushToUser(user.id, {
          title: tRe(`variants.${variant}.title`),
          body: tRe(`variants.${variant}.body`),
          data: { type: "re_engagement" },
        });
        await prisma.user
          .update({
            where: { id: user.id },
            data: { lastReEngagementPushAt: new Date(), lastReEngagementVariant: variant },
          })
          .catch(() => {
            /* best-effort — i värsta fall kommer nästa tjat ett dygn för tidigt */
          });
        reEngaged++;
        // Inget filmtips samma körning: en inaktiv användare ska få ETT
        // meddelande, inte två.
        return;
      }

      // ---- 2) Takten på recs-pushen. ----
      //
      // Måste ligga FÖRE computeUnifiedRecs: det anropet kostar ~100
      // TMDB-anrop, och att räkna fram ett tips vi ändå inte får skicka är ren
      // kvotförbrukning. Throttlad ≠ misslyckad — den räknas separat.
      if (
        REC_PUSH_MIN_HOURS > 0 &&
        user.lastRecPushSentAt &&
        now - user.lastRecPushSentAt.getTime() < REC_PUSH_MIN_HOURS * HOUR_MS
      ) {
        throttled++;
        return;
      }

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
          data: {
            lastDailyRecTmdbId: pick.id,
            lastDailyRecMediaType: pick.tmdbType,
            // Stämplas BARA här, efter en faktiskt skickad push — det är den
            // här kolumnen som håller takten nere på 2–3 pushar i veckan.
            lastRecPushSentAt: new Date(),
          },
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
    reEngaged,
    // skipped = motorn hade inget att föreslå. throttled = fick sin push nyligen
    // och står över med flit. Att blanda ihop dem gör en normal körning (där de
    // flesta är throttlade) omöjlig att skilja från en trasig.
    skipped,
    throttled,
    failed,
    remaining,
    timedOut: remaining > 0,
    // Släpp-svepet räknas separat: det rör bevakade titlar, inte recs-kön.
    releaseNotified: release.sent,
    releaseDatesRefreshed: release.refreshed,
    releaseFailed: release.failed,
  });
}
