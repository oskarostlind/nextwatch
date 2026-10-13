// lib/pushRecs/compose.ts
//
// Bygger recs-pushen för en användare: VAD som skickas (dagens tips, fredagens
// tre förslag eller en påminnelse om något som legat i listan) och med vilken
// vinkel. Används av cron/daily-recs och av admin-förhandsvisningen — samma
// kod, så att det som testas är det som skickas.
//
// Komposern skickar ingenting och stämplar ingenting; den returnerar en färdig
// PushPayload för sendPushToUser. Den kastar inte heller på hämtningsfel i
// stödfunktionerna (historik, vänner, titelfakta): saknas de faller vinkeln
// bort och vi hamnar på en enklare — pushen ska hellre bli tråkigare än utebli.

import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { computeUnifiedRecs, type UnifiedItem } from "@/lib/unifiedRecs";
import { fetchTitleBrief, type TitleBrief } from "@/lib/tmdbTitleBrief";
import type { PushPayload } from "@/lib/push";
import { bcp47, normalizeLocale, type AppLocale } from "@/lib/i18nConfig";
import { tmdbLanguageFor } from "@/lib/tmdbLanguage";
import {
  ANGLE_VARIANTS,
  NUDGE_VARIANTS,
  REC_ANGLES,
  WEEKDAY_POOLS,
  WEEKLY_VARIANTS,
  chooseAngle,
  chooseVariant,
  eligibleAngles,
  matchingProvider,
  parseAngleTag,
  type AngleData,
  type AngleOffer,
  type RecAngle,
} from "./angles";
import { stockholmParts } from "./timing";

export { REC_ANGLES };

export type RecPushType = "daily_rec" | "weekly_picks" | "watchlist_nudge";

export type ComposedPush = {
  type: RecPushType;
  /**
   * Vinkelns basnamn ("person", "weekly", "nudge") — räknas per vinkel i cronen
   * och är det forceAngle tar emot. Varianten ligger i payload.angle
   * ("person.v2") och i debug.variant.
   */
  angle: string;
  payload: PushPayload;
  debug?: Record<string, unknown>;
};

export type ComposeOpts = {
  now?: Date;
  forceType?: RecPushType;
  forceAngle?: string;
  /** Slumpkälla — bara för tester; produktion använder Math.random. */
  rng?: () => number;
};

const DAY_MS = 86_400_000;
/** Sedan hur länge en watchlist-titel ska ha legat orörd för att få en påminnelse. */
const NUDGE_MIN_AGE_DAYS = 21;
/** Minst så här lång paus mellan två påminnelser. */
const NUDGE_COOLDOWN_DAYS = 10;
/** Chans per körning att en påminnelse kommer i stället för dagens tips. */
const NUDGE_CHANCE = 0.35;
/** Fredagens tre förslag skickas högst så här ofta. */
const WEEKLY_COOLDOWN_DAYS = 6;
/** Så många topptitlar granskas efter en titel som en vän också sparat. */
const FRIEND_SCAN_TOP = 10;
const HISTORY_TAKE = 10;
/** Rubriker/titlar i texten klipps så att notisen inte svämmar över. */
const TITLE_CLIP = 46;
const WEEKLY_TITLE_CLIP = 28;

function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function parseProviders(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

const keyOf = (id: number, type: string) => `${type}:${id}`;

/* ---------------- Historik ---------------- */

type HistoryRow = {
  type: string;
  angle: string | null;
  sentAt: Date;
  tmdbId: number | null;
  mediaType: string | null;
};

type History = {
  recent: HistoryRow[];
  lastWeeklyAt: Date | null;
  nudges: { sentAt: Date; tmdbId: number | null; mediaType: string | null }[];
};

/** Tabellen kan saknas tills SQL:en körts — då är historiken tom, inte ett fel. */
async function loadHistory(userId: string): Promise<History> {
  const [recent, weekly, nudges] = await Promise.all([
    prisma.pushLog
      .findMany({
        where: { userId },
        orderBy: { sentAt: "desc" },
        take: HISTORY_TAKE,
        select: { type: true, angle: true, sentAt: true, tmdbId: true, mediaType: true },
      })
      .catch(() => [] as HistoryRow[]),
    prisma.pushLog
      .findFirst({
        where: { userId, type: "weekly_picks" },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      })
      .catch(() => null),
    prisma.pushLog
      .findMany({
        where: { userId, type: "watchlist_nudge" },
        orderBy: { sentAt: "desc" },
        take: 5,
        select: { sentAt: true, tmdbId: true, mediaType: true },
      })
      .catch(() => []),
  ]);
  return { recent, lastWeeklyAt: weekly?.sentAt ?? null, nudges };
}

/** Fredag i Stockholm och inget veckobrev de senaste sex dygnen. */
function weeklyDue(now: Date, lastWeeklyAt: Date | null): boolean {
  if (stockholmParts(now).weekday !== 5) return false;
  return !lastWeeklyAt || now.getTime() - lastWeeklyAt.getTime() >= WEEKLY_COOLDOWN_DAYS * DAY_MS;
}

/**
 * Billig förhandskoll för cronen: skulle den här användaren få fredagens tre
 * förslag nu? Används för att släppa förbi tempospärren på fredagar (annars
 * träffar 60 h-spärren fredagen på måfå).
 */
export async function weeklyPicksDue(userId: string, now: Date = new Date()): Promise<boolean> {
  if (stockholmParts(now).weekday !== 5) return false;
  const last = await prisma.pushLog
    .findFirst({ where: { userId, type: "weekly_picks" }, orderBy: { sentAt: "desc" }, select: { sentAt: true } })
    .catch(() => null);
  return weeklyDue(now, last?.sentAt ?? null);
}

/* ---------------- Vänner ---------------- */

/**
 * Vilka av titlarna har en vän sparat? Friendship lagras som EN rad per par
 * (userId < friendId, se friends/request), så båda riktningarna måste läsas.
 * Returnerar titelnyckel → vännens namn (den som sparade senast, och bara vänner
 * som har ett namn att visa).
 */
async function friendSaves(userId: string, items: UnifiedItem[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (items.length === 0) return out;
  try {
    const links = await prisma.friendship.findMany({
      where: { OR: [{ userId }, { friendId: userId }] },
      select: { userId: true, friendId: true },
      take: 300,
    });
    const friendIds = [...new Set(links.map((l) => (l.userId === userId ? l.friendId : l.userId)))];
    if (friendIds.length === 0) return out;

    const saved = await prisma.watchlist.findMany({
      where: {
        userId: { in: friendIds },
        OR: items.map((i) => ({ tmdbId: i.id, mediaType: i.tmdbType })),
      },
      orderBy: { addedAt: "desc" },
      select: { userId: true, tmdbId: true, mediaType: true },
      take: 200,
    });
    if (saved.length === 0) return out;

    const people = await prisma.user.findMany({
      where: { id: { in: [...new Set(saved.map((s) => s.userId))] } },
      select: { id: true, username: true, profile: { select: { displayName: true } } },
    });
    const nameOf = new Map<string, string>();
    for (const p of people) {
      const name = (p.profile?.displayName ?? p.username ?? "").trim();
      if (name) nameOf.set(p.id, name);
    }
    for (const s of saved) {
      const name = nameOf.get(s.userId);
      const k = keyOf(s.tmdbId, s.mediaType);
      if (name && !out.has(k)) out.set(k, name);
    }
  } catch (e) {
    console.warn("[pushRecs] vänsökning misslyckades:", e instanceof Error ? e.message : e);
  }
  return out;
}

/* ---------------- Text ---------------- */

type Translate = Awaited<ReturnType<typeof getTranslations>>;

type Ctx = {
  userId: string;
  now: Date;
  rng: () => number;
  uiLanguage: AppLocale;
  tmdbLang: string;
  region: string;
  userProviders: string[];
  t: Translate;
  history: History;
  lastPushed: { id: number | null; type: string | null };
};

function baseValues(ctx: Ctx, item: { title: string; year?: string | null; tmdbType: "movie" | "tv" }) {
  const title = clip(item.title, TITLE_CLIP);
  return {
    title,
    titleWithYear: item.year ? `${title} (${item.year})` : title,
    media: ctx.t(item.tmdbType === "movie" ? "common.movie" : "common.series"),
  };
}

/** Rådata → ICU-parametrar (inkl. lokaliserade småtexter som "regi X"). */
function angleValues(ctx: Ctx, data: AngleData, item: UnifiedItem): Record<string, string | number> {
  const v: Record<string, string | number> = {};
  const loc = bcp47(ctx.uiLanguage);
  if (data.friend) v.friend = data.friend;
  if (data.evidence) v.evidence = new Intl.ListFormat(loc, { style: "long", type: "conjunction" }).format(data.evidence);
  if (data.person) {
    v.person = data.person.name;
    v.by = ctx.t(data.person.kind === "director" ? "common.byDirector" : "common.withCast", {
      person: data.person.name,
    });
  }
  if (data.service) v.service = data.service;
  if (data.rating != null) {
    v.rating = new Intl.NumberFormat(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(data.rating);
  }
  if (data.theme) v.theme = data.theme.toLowerCase();
  if (data.minutes) {
    v.length = ctx.t(item.tmdbType === "movie" ? "common.runtimeMovie" : "common.runtimeTv", {
      minutes: data.minutes,
    });
  }
  return v;
}

/* ---------------- Daily rec ---------------- */

/** Vinklar (basnamn) i användarens senaste dagliga pushar, nyast först. */
function recentDailyAngles(history: History, n: number): string[] {
  return history.recent
    .filter((r) => r.type === "daily_rec")
    .slice(0, n)
    .map((r) => parseAngleTag(r.angle)?.angle)
    .filter((a): a is string => !!a);
}

/** Senast använda variant för en vinkel (bland de loggade pushar vi har). */
function lastVariantOf(history: History, angle: string): string | null {
  for (const r of history.recent) {
    if (r.type !== "daily_rec") continue;
    const p = parseAngleTag(r.angle);
    if (p?.angle === angle) return p.variant;
  }
  return null;
}

/** Vinklar som behöver titelfakta (brief) för att avgöra om de passar. */
/** Hur många av topplistans titlar som får tävla om den starkaste vinkeln. */
const BEST_OF_TOP = 5;

const NEEDS_BRIEF: ReadonlySet<string> = new Set(["provider", "rating", "runtime"]);

async function composeDaily(
  ctx: Ctx,
  items: UnifiedItem[],
  forceAngleRaw: string | undefined,
  debug: Record<string, unknown>,
): Promise<ComposedPush | null> {
  // Admin kan skicka med variant ("person.v2") — basen väljer vinkel, varianten
  // fastnålas om den finns.
  const forced = parseAngleTag(forceAngleRaw);
  const forceAngle = forced?.angle;
  const top = items.slice(0, FRIEND_SCAN_TOP);
  const friends = await friendSaves(ctx.userId, top);
  const friendPick = top.find((i) => friends.has(keyOf(i.id, i.tmdbType)));
  const first = friendPick ?? items[0];
  const weekday = stockholmParts(ctx.now).weekday;

  const offersFor = async (item: UnifiedItem) => {
    const brief = await fetchTitleBrief(item.id, item.tmdbType, ctx.tmdbLang);
    const offers = eligibleAngles({
      item,
      brief,
      region: ctx.region,
      userProviders: ctx.userProviders,
      friendName: friends.get(keyOf(item.id, item.tmdbType)) ?? null,
      weekday,
      uiLanguage: ctx.uiLanguage,
    });
    return { item, brief, offers };
  };

  let picked = await offersFor(first);

  // Vardagsläget: förstahandsvalet saknar ofta det som gör en notis personlig
  // (en regissör du gillar, en toppmatch). Titlarna 2–5 är nästan lika bra
  // rekommendationer, så vi tar den av de fem som ger den starkaste vinkeln som
  // inte nyss använts. Lika starka → bästa placeringen vinner. En vän som
  // sparat titeln (friendPick) slår alltid detta.
  if (!forceAngle && !friendPick) {
    const recent = new Set(recentDailyAngles(ctx.history, 2));
    const strength = (offers: AngleOffer[]) => {
      const ranks = offers
        .filter((o) => !recent.has(o.angle))
        .map((o) => REC_ANGLES.indexOf(o.angle))
        .filter((r) => r >= 0);
      return ranks.length > 0 ? Math.min(...ranks) : Number.MAX_SAFE_INTEGER;
    };
    const rest = await Promise.all(
      items.filter((i) => i !== first).slice(0, BEST_OF_TOP - 1).map(offersFor),
    );
    let best = picked;
    let bestStrength = strength(picked.offers);
    for (const cand of rest) {
      const st = strength(cand.offers);
      if (st < bestStrength) {
        best = cand;
        bestStrength = st;
      }
    }
    if (best !== picked) {
      picked = best;
      debug.pickReason = "strongest-angle-of-top5";
    }
  }

  // Testläge (forceAngle): leta bland topplistan efter en titel som faktiskt
  // passar den begärda vinkeln i stället för att alltid hamna på generic.
  // Titelfakta hämtas bara för de få kandidater som behövs.
  if (forceAngle && !picked.offers.some((o) => o.angle === forceAngle)) {
    const limit = NEEDS_BRIEF.has(forceAngle) ? 6 : FRIEND_SCAN_TOP;
    for (const cand of top.filter((i) => i !== first).slice(0, limit)) {
      const alt = await offersFor(cand);
      if (alt.offers.some((o) => o.angle === forceAngle)) {
        picked = alt;
        debug.pickReason = "forceAngle-search";
        break;
      }
    }
  }

  const { item, brief, offers } = picked;
  const choice = chooseAngle(offers, {
    recentAngles: recentDailyAngles(ctx.history, 2),
    forceAngle: forced?.angle,
    rng: ctx.rng,
  });
  const angle = choice.offer.angle as RecAngle;

  const pool =
    angle === "weekday" && choice.offer.data.weekdayKind
      ? WEEKDAY_POOLS[choice.offer.data.weekdayKind]
      : ANGLE_VARIANTS[angle];
  const variant =
    forced?.variant && pool.includes(forced.variant)
      ? forced.variant
      : chooseVariant(pool, lastVariantOf(ctx.history, angle), ctx.rng);

  debug.eligible = offers.map((o: AngleOffer) => o.angle);
  debug.recentAngles = recentDailyAngles(ctx.history, 2);
  debug.skippedRecent = choice.skippedRecent;
  debug.chosenAngle = angle;
  debug.variant = variant;
  debug.item = { id: item.id, type: item.tmdbType, title: item.title };
  debug.pickReason ??= friendPick && item === friendPick ? "friend-saved" : "first";
  debug.briefLoaded = !!brief;
  if (forceAngle) {
    debug.forceAngle = forceAngle;
    if (choice.forceMissed) debug.forceMissed = `${forceAngle} passar inte någon av toppkandidaterna – föll tillbaka på generic`;
  }

  const { t } = ctx;
  const values = { ...baseValues(ctx, item), ...angleValues(ctx, choice.offer.data, item) };
  const tag = `${angle}.${variant}`;

  return {
    type: "daily_rec",
    angle,
    payload: {
      title: t(`${angle}.${variant}.title`, values),
      body: t(`${angle}.${variant}.body`, values),
      data: { type: "daily_rec", tmdbId: String(item.id), tmdbType: item.tmdbType },
      image: brief?.imageUrl ?? null,
      category: "NW_TITLE",
      threadId: "recs",
      interruptionLevel: "active",
      relevanceScore: 0.6,
      angle: tag,
      tmdbId: item.id,
      mediaType: item.tmdbType,
    },
    debug,
  };
}

/* ---------------- Weekly picks ---------------- */

async function composeWeekly(
  ctx: Ctx,
  items: UnifiedItem[],
  debug: Record<string, unknown>,
): Promise<ComposedPush | null> {
  const seen = new Set<string>();
  const three: UnifiedItem[] = [];
  for (const i of items) {
    const k = keyOf(i.id, i.tmdbType);
    if (seen.has(k)) continue;
    seen.add(k);
    three.push(i);
    if (three.length === 3) break;
  }
  if (three.length < 3) {
    debug.weeklyFallback = `bara ${three.length} unika titlar`;
    return null;
  }

  const brief = await fetchTitleBrief(three[0].id, three[0].tmdbType, ctx.tmdbLang);
  const lastVariant = parseAngleTag(
    ctx.history.recent.find((r) => r.type === "weekly_picks")?.angle,
  )?.variant ?? null;
  const variant = chooseVariant(WEEKLY_VARIANTS, lastVariant, ctx.rng);
  const [a, b, c] = three.map((i) => clip(i.title, WEEKLY_TITLE_CLIP));

  debug.chosenAngle = "weekly";
  debug.variant = variant;
  debug.items = three.map((i) => ({ id: i.id, type: i.tmdbType, title: i.title }));

  const values = { a, b, c };
  return {
    type: "weekly_picks",
    angle: "weekly",
    payload: {
      title: ctx.t(`weekly.${variant}.title`, values),
      body: ctx.t(`weekly.${variant}.body`, values),
      // Ingen category: knapparna skulle bara gälla en av de tre titlarna.
      data: { type: "weekly_picks", tmdbId: String(three[0].id), tmdbType: three[0].tmdbType },
      image: brief?.imageUrl ?? null,
      threadId: "recs",
      interruptionLevel: "active",
      relevanceScore: 0.7,
      angle: `weekly.${variant}`,
      tmdbId: three[0].id,
      mediaType: three[0].tmdbType,
    },
    debug,
  };
}

/* ---------------- Watchlist nudge ---------------- */

/** Beslut i ratings som betyder att titeln inte längre är "osedd i listan". */
const DONE_DECISIONS = new Set(["seen", "RATED", "dislike"]);

async function composeNudge(ctx: Ctx, debug: Record<string, unknown>): Promise<ComposedPush | null> {
  const cutoff = new Date(ctx.now.getTime() - NUDGE_MIN_AGE_DAYS * DAY_MS);
  const rows = await prisma.watchlist.findMany({
    where: { userId: ctx.userId, addedAt: { lte: cutoff } },
    orderBy: { addedAt: "asc" },
    take: 40,
    select: { tmdbId: true, mediaType: true, addedAt: true },
  });
  if (rows.length === 0) {
    debug.nudge = "inga watchlist-titlar äldre än 21 dagar";
    return null;
  }

  const rated = await prisma.rating.findMany({
    where: { userId: ctx.userId, OR: rows.map((r) => ({ tmdbId: r.tmdbId, mediaType: r.mediaType })) },
    select: { tmdbId: true, mediaType: true, decision: true, rating: true },
  });
  const done = new Set(
    rated.filter((r) => r.rating != null || DONE_DECISIONS.has(r.decision)).map((r) => keyOf(r.tmdbId, r.mediaType)),
  );
  const recentlyNudged = new Set(
    ctx.history.nudges.filter((n) => n.tmdbId != null).map((n) => keyOf(n.tmdbId as number, n.mediaType ?? "")),
  );
  const open = rows.filter((r) => {
    const k = keyOf(r.tmdbId, r.mediaType);
    return !done.has(k) && !recentlyNudged.has(k);
  });
  debug.nudgeCandidates = open.length;
  if (open.length === 0) return null;

  // Titeln finns inte i watchlist-raden, så namn + tjänster kommer från TMDB.
  // De 8 äldsta räcker för att hitta en som ligger på användarens tjänster.
  const head = open.slice(0, 8);
  const briefs = await Promise.all(
    head.map((r) => fetchTitleBrief(r.tmdbId, r.mediaType === "tv" ? "tv" : "movie", ctx.tmdbLang)),
  );
  const options = head
    .map((row, i) => ({ row, brief: briefs[i] as TitleBrief | null }))
    .filter((o): o is { row: (typeof head)[number]; brief: TitleBrief } => !!o.brief);
  if (options.length === 0) return null;

  const onMine = options.find((o) => matchingProvider(ctx.userProviders, o.brief.providers[ctx.region]));
  const chosen = onMine ?? options[0];
  const weeks = Math.max(NUDGE_MIN_AGE_DAYS / 7, Math.floor((ctx.now.getTime() - chosen.row.addedAt.getTime()) / (7 * DAY_MS)));
  const mediaType = chosen.row.mediaType === "tv" ? "tv" : "movie";

  const lastVariant = parseAngleTag(ctx.history.recent.find((r) => r.type === "watchlist_nudge")?.angle)?.variant ?? null;
  const variant = chooseVariant(NUDGE_VARIANTS, lastVariant, ctx.rng);

  debug.chosenAngle = "nudge";
  debug.variant = variant;
  debug.item = { id: chosen.row.tmdbId, type: mediaType, title: chosen.brief.title };
  debug.onUserService = !!onMine;
  debug.weeks = weeks;

  const values = { title: clip(chosen.brief.title, TITLE_CLIP), weeks };
  return {
    type: "watchlist_nudge",
    angle: "nudge",
    payload: {
      title: ctx.t(`nudge.${variant}.title`, values),
      body: ctx.t(`nudge.${variant}.body`, values),
      data: { type: "watchlist_nudge", tmdbId: String(chosen.row.tmdbId), tmdbType: mediaType },
      image: chosen.brief.imageUrl,
      category: "NW_SAVED",
      threadId: "recs",
      interruptionLevel: "active",
      relevanceScore: 0.5,
      angle: `nudge.${variant}`,
      tmdbId: chosen.row.tmdbId,
      mediaType,
    },
    debug,
  };
}

/* ---------------- Ingång ---------------- */

/**
 * Komponerar nästa recs-push för användaren, eller null om det inte finns något
 * att föreslå (profil saknas, motorn gav tomt).
 *
 * Typval (om inte forceType): fredag i Stockholm utan veckobrev på 6 dygn →
 * weekly_picks; annars, med 35 % chans och 10 dygns paus, en watchlist_nudge om
 * det finns en passande titel; annars daily_rec.
 */
export async function composeRecPush(userId: string, opts: ComposeOpts = {}): Promise<ComposedPush | null> {
  const now = opts.now ?? new Date();
  const rng = opts.rng ?? Math.random;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      lastDailyRecTmdbId: true,
      lastDailyRecMediaType: true,
      profile: { select: { region: true, uiLanguage: true, providers: true } },
    },
  });
  if (!user?.profile) return null;

  const uiLanguage = normalizeLocale(user.profile.uiLanguage);
  const tmdbLang = tmdbLanguageFor(uiLanguage);
  const history = await loadHistory(userId);
  const t = await getTranslations({ locale: uiLanguage, namespace: "push.recAngles" });

  const ctx: Ctx = {
    userId,
    now,
    rng,
    uiLanguage,
    tmdbLang,
    region: user.profile.region || "SE",
    userProviders: parseProviders(user.profile.providers),
    t,
    history,
    lastPushed: { id: user.lastDailyRecTmdbId, type: user.lastDailyRecMediaType },
  };

  // ---- Typval ----
  const sth = stockholmParts(now);
  const lastNudgeAt = history.nudges[0]?.sentAt ?? null;
  const nudgeCooldownOver = !lastNudgeAt || now.getTime() - lastNudgeAt.getTime() >= NUDGE_COOLDOWN_DAYS * DAY_MS;

  const debug: Record<string, unknown> = {
    stockholm: sth,
    lastWeeklyAt: history.lastWeeklyAt?.toISOString() ?? null,
    lastNudgeAt: lastNudgeAt?.toISOString() ?? null,
  };

  let wantWeekly = false;
  let wantNudge = false;
  if (opts.forceType) {
    wantWeekly = opts.forceType === "weekly_picks";
    wantNudge = opts.forceType === "watchlist_nudge";
    debug.typeReason = `forceType=${opts.forceType}`;
  } else if (weeklyDue(now, history.lastWeeklyAt)) {
    wantWeekly = true;
    debug.typeReason = "fredag utan veckobrev på 6 dygn";
  } else if (nudgeCooldownOver && rng() < NUDGE_CHANCE) {
    wantNudge = true;
    debug.typeReason = "slumpad påminnelse (35 %)";
  } else {
    debug.typeReason = "vanligt dagligt tips";
  }

  if (wantNudge) {
    const nudge = await composeNudge(ctx, debug);
    if (nudge) return nudge;
    debug.nudgeFallback = "ingen passande watchlist-titel – dagligt tips i stället";
  }

  // ---- Rekommendationer (dyrt: ~100 TMDB-anrop) ----
  const recs = await computeUnifiedRecs({
    uid: userId,
    region: ctx.region,
    locale: tmdbLang,
    groupCode: null,
    page: 1,
    withEvidence: true,
  });
  if (!recs.ok || recs.items.length === 0) return null;

  // Hoppa över senast pushade tipset; finns inget annat skickas det hellre än inget.
  const fresh = recs.items.filter((i) => !(i.id === ctx.lastPushed.id && i.tmdbType === ctx.lastPushed.type));
  const items = fresh.length > 0 ? fresh : recs.items;

  if (wantWeekly) {
    const weekly = await composeWeekly(ctx, items, debug);
    if (weekly) return weekly;
    debug.weeklyFallback ??= "veckobrevet kunde inte byggas – dagligt tips i stället";
  }

  return composeDaily(ctx, items, opts.forceAngle, debug);
}
