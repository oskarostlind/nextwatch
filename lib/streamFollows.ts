// lib/streamFollows.ts
//
// "Bevaka" (kind="stream" i release_follows, se app/api/follow): pushar när en
// bevakad titel dyker upp på någon av användarens tjänster. Körs som förpass i
// app/api/cron/daily-recs, efter släpp-svepet. Kastar aldrig.
//
// Varje körning slår upp en roterande batch (checkedAt, äldst först — samma
// rättvisemönster som refreshPendingReleaseDates) mot TMDB:s watch/providers
// i användarens region. Utan valda tjänster räcker det att titeln finns på en
// tjänst appen erbjuder (lib/providers.ts) — samma regel som swipe-leken.

import prisma from "@/lib/prisma";
import { sendLocalizedPushToUser } from "@/lib/push";
import { fetchTitleBrief } from "@/lib/tmdbTitleBrief";
import { parseProvidersJson } from "@/lib/groupSettings";
import { PROVIDERS } from "@/lib/providers";
import { matchService } from "@/lib/serviceMatch";

/** TMDB-uppslag per körning (cachen i fetchTitleBrief delar på samma titel). */
const STREAM_SWEEP_BATCH = 150;
const CONCURRENCY = 8;
/** Som släpp-notiserna: aldrig ett pling per titel för den som bevakar många. */
const MAX_PER_USER = 3;

const OFFERED = PROVIDERS.map((p) => p.label);

/** Pling bara dagtid (Stockholm) — i timläget körs cronen dygnet runt. */
const QUIET_BEFORE = 9;
const QUIET_FROM = 22;

function stockholmHour(now = new Date()): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return Number(h);
}

export async function sweepStreamFollows(): Promise<{ checked: number; sent: number; failed: number }> {
  let checked = 0;
  let sent = 0;
  let failed = 0;
  const hour = stockholmHour();
  if (hour < QUIET_BEFORE || hour >= QUIET_FROM) return { checked, sent, failed };
  try {
    const rows = await prisma.releaseFollow.findMany({
      where: { kind: "stream", notifiedAt: null },
      select: { id: true, userId: true, tmdbId: true, mediaType: true, title: true },
      orderBy: { checkedAt: { sort: "asc", nulls: "first" } },
      take: STREAM_SWEEP_BATCH,
    });
    if (rows.length === 0) return { checked, sent, failed };

    const userIds = Array.from(new Set(rows.map((r) => r.userId)));
    const profiles = await prisma.profile.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, providers: true, region: true },
    });
    const profileBy = new Map(profiles.map((p) => [p.userId, p]));
    const saved = await prisma.watchlist.findMany({
      where: {
        userId: { in: userIds },
        tmdbId: { in: Array.from(new Set(rows.map((r) => r.tmdbId))) },
      },
      select: { userId: true, tmdbId: true },
    });
    const savedSet = new Set(saved.map((s) => `${s.userId}:${s.tmdbId}`));
    const perUser = new Map<string, number>();

    let next = 0;
    const worker = async () => {
      for (let i = next++; i < rows.length; i = next++) {
        const f = rows[i];
        const mediaType = f.mediaType === "tv" ? "tv" : "movie";
        try {
          checked++;
          const brief = await fetchTitleBrief(f.tmdbId, mediaType, "sv-SE");
          const profile = profileBy.get(f.userId);
          const region = (profile?.region || "SE").toUpperCase();
          const mine = parseProvidersJson(profile?.providers);
          const service = brief
            ? matchService(brief.providers[region] ?? [], mine.length ? mine : OFFERED)
            : null;
          const n = perUser.get(f.userId) ?? 0;
          if (!service || n >= MAX_PER_USER) {
            // checkedAt stämplas även utan träff så kön roterar. Över taket
            // lämnas raden ostämplad → först i kön nästa körning.
            if (!service) {
              await prisma.releaseFollow.update({ where: { id: f.id }, data: { checkedAt: new Date() } });
            }
            continue;
          }
          perUser.set(f.userId, n + 1);
          await sendLocalizedPushToUser(f.userId, {
            key: "streamAvailable",
            values: { title: f.title, service },
            // Samma typ som släpp-notisen: tryck öppnar titeln överst i swipen
            // (PushRegistration) och den följer ingen generell notisinställning
            // — användaren har uttryckligen bett om den.
            data: { type: "release", tmdbId: String(f.tmdbId), tmdbType: mediaType },
            image: brief?.imageUrl ?? null,
            category: savedSet.has(`${f.userId}:${f.tmdbId}`) ? "NW_SAVED" : "NW_TITLE",
            threadId: "release",
            tmdbId: f.tmdbId,
            mediaType,
          });
          await prisma.releaseFollow.update({
            where: { id: f.id },
            data: { notifiedAt: new Date(), checkedAt: new Date() },
          });
          sent++;
        } catch (e) {
          failed++;
          console.warn("[streamFollows] bevakning", f.id, e instanceof Error ? e.message : e);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  } catch (e) {
    failed++;
    console.warn("[streamFollows] svepet misslyckades:", e instanceof Error ? e.message : e);
  }
  return { checked, sent, failed };
}
