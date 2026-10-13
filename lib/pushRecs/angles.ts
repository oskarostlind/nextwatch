// lib/pushRecs/angles.ts
//
// Textvinklarna för det dagliga filmtipset och regeln för vilken som passar.
// Allt här är RENT (ingen DB, inget nätverk) så att urvalet går att provköra
// med fejkdata — compose.ts hämtar datan och översätter texten.
//
// Varför vinklar? En enda mall ("Dagens tips / {titel} – en film vi tror du
// gillar") blir bannlyst efter en vecka. Varje vinkel kräver att vi faktiskt VET
// något om titeln eller användaren (en vän har sparat den, regissören hen
// brukar gilla, tjänsten hen redan har) — annars är den inte valbar.

import type { MatchEvidence, UnifiedItem } from "@/lib/unifiedRecs";
import type { TitleBrief } from "@/lib/tmdbTitleBrief";

/** Prioritetsordning: tidigast = mest personlig. generic är sista utvägen. */
const ANGLE_LIST = [
  "friend",
  "topMatch",
  "person",
  "provider",
  "rating",
  "theme",
  "runtime",
  "weekday",
  "challenge",
  "generic",
] as const;

export type RecAngle = (typeof ANGLE_LIST)[number];

/** Publikt som readonly string[] (kontraktet): admin validerar fritext mot den. */
export const REC_ANGLES: readonly string[] = ANGLE_LIST;

const V4 = ["v1", "v2", "v3", "v4"] as const;

/**
 * Variant-id:n ligger som literaler här (inte som byggda strängar) av samma
 * skäl som REENGAGE_VARIANTS i cron/daily-recs: scripts/check-i18n-keys.mjs kan
 * då verifiera prefixet, och en variant kan strykas utan att koden spricker.
 * Nycklar: push.recAngles.<vinkel>.<variant>.{title,body}
 */
export const ANGLE_VARIANTS: Record<RecAngle, readonly string[]> = {
  friend: V4,
  topMatch: V4,
  person: V4,
  provider: V4,
  rating: V4,
  theme: V4,
  runtime: V4,
  weekday: ["v1", "v2", "v3", "v4", "v5", "v6"],
  challenge: V4,
  generic: V4,
};

/** weekday-texterna delas upp per dag: v1–v2 söndag+serie, v3–v4 fredag, v5–v6 mån–tors. */
export const WEEKDAY_POOLS = {
  sunTv: ["v1", "v2"],
  fri: ["v3", "v4"],
  week: ["v5", "v6"],
} as const;
export type WeekdayKind = keyof typeof WEEKDAY_POOLS;

export const WEEKLY_VARIANTS = ["v1", "v2", "v3"] as const;
export const NUDGE_VARIANTS = ["v1", "v2", "v3", "v4"] as const;

/* ---------------- Tjänster ---------------- */

/**
 * Samma tjänst heter olika i profilen ("Prime Video", "Disney+") och hos TMDB
 * ("Amazon Prime Video", "Disney Plus", "HBO Max"). Båda sidor reduceras till en
 * nyckel; PROVIDER_MAP i unifiedRecs gör motsvarande för TMDB-id:n.
 */
export function providerKey(name: string): string | null {
  const n = name.toLowerCase().replace(/\+/g, " plus ").replace(/[^a-z0-9åäö]+/g, " ").trim();
  if (!n) return null;
  if (n.includes("netflix")) return "netflix";
  if (n.includes("disney")) return "disney";
  if (n.includes("prime") || n.includes("amazon")) return "prime";
  if (n.includes("hbo") || n === "max") return "max";
  if (n.includes("apple tv")) return "apple";
  if (n.includes("viaplay")) return "viaplay";
  if (n.includes("skyshowtime")) return "skyshowtime";
  if (n.startsWith("svt")) return "svt";
  if (n.includes("tv4")) return "tv4";
  return n.replace(/ /g, "");
}

/** Första av användarens tjänster som titeln ligger på (flatrate) i regionen. */
export function matchingProvider(
  userProviders: readonly string[],
  titleProviders: readonly string[] | undefined,
): string | null {
  if (!titleProviders || titleProviders.length === 0) return null;
  const onTitle = new Set(titleProviders.map(providerKey).filter((k): k is string => !!k));
  for (const mine of userProviders) {
    const k = providerKey(mine);
    if (k && onTitle.has(k)) return mine;
  }
  return null;
}

/* ---------------- Vinkelval ---------------- */

export type AngleInput = {
  item: UnifiedItem;
  brief: TitleBrief | null;
  /** Användarens region (ISO), t.ex. "SE". */
  region: string;
  /** Profile.providers som de står i profilen. */
  userProviders: readonly string[];
  /** Vän som sparat titeln, redan uppslagen och med namn. */
  friendName: string | null;
  /** Stockholm-veckodag, 0 = söndag. */
  weekday: number;
  /** Mottagarens UI-språk. TMDB:s nyckelord finns bara på engelska. */
  uiLanguage: "sv" | "en";
};

/** Rådata per vinkel — compose.ts formaterar den till ICU-parametrar. */
export type AngleData = {
  friend?: string;
  evidence?: string[];
  person?: { name: string; kind: "director" | "cast" };
  service?: string;
  rating?: number;
  theme?: string;
  minutes?: number;
  weekdayKind?: WeekdayKind;
};

export type AngleOffer = { angle: RecAngle; data: AngleData };

const RATING_MIN_VOTES = 200;
const RATING_MIN = 7.5;
const RATING_MIN_NO_COUNT = 7.8;
const MOVIE_SHORT_MIN = 100;
const EPISODE_SHORT_MIN = 30;

function firstOfKind(ev: MatchEvidence[] | undefined, kinds: MatchEvidence["kind"][]) {
  return ev?.find((e) => kinds.includes(e.kind));
}

/** Alla vinklar som passar den här titeln, i prioritetsordning. challenge/generic alltid med. */
export function eligibleAngles(input: AngleInput): AngleOffer[] {
  const { item, brief, region, userProviders, friendName, weekday, uiLanguage } = input;
  // TMDB-nyckelord ("time travel") saknar översättning — mitt i en svensk notis
  // ser de ut som en bugg. Personnamn är språkoberoende och får vara kvar.
  const languageSafe = (e: MatchEvidence) => uiLanguage === "en" || e.kind !== "keyword";
  const out: AngleOffer[] = [];

  if (friendName) out.push({ angle: "friend", data: { friend: friendName } });

  const topEvidence = item.topMatch?.evidence?.filter(languageSafe).map((e) => e.label).filter(Boolean) ?? [];
  if (topEvidence.length > 0) {
    out.push({ angle: "topMatch", data: { evidence: topEvidence.slice(0, 2) } });
  }

  const person = firstOfKind(item.evidence, ["director", "cast"]);
  if (person) {
    out.push({
      angle: "person",
      data: { person: { name: person.label, kind: person.kind === "director" ? "director" : "cast" } },
    });
  }

  const service = matchingProvider(userProviders, brief?.providers?.[region]);
  if (service) out.push({ angle: "provider", data: { service } });

  // Betyget bara när vi vet att det vilar på många röster. Saknas brief (antalet
  // okänt) duger bara ett riktigt högt betyg — det synliga item.vote_average kan
  // vara OMDb-ifyllt och är då redan filtrerat för opålitlighet.
  if (brief && brief.voteCount != null && brief.voteCount >= RATING_MIN_VOTES && (brief.voteAverage ?? 0) >= RATING_MIN) {
    out.push({ angle: "rating", data: { rating: brief.voteAverage as number } });
  } else if ((brief?.voteCount ?? null) === null && (item.vote_average ?? 0) >= RATING_MIN_NO_COUNT) {
    out.push({ angle: "rating", data: { rating: item.vote_average as number } });
  }

  const theme = uiLanguage === "en" ? firstOfKind(item.evidence, ["keyword"]) : undefined;
  if (theme) out.push({ angle: "theme", data: { theme: theme.label } });

  const minutes = brief?.runtimeMin ?? null;
  if (minutes && (item.tmdbType === "movie" ? minutes <= MOVIE_SHORT_MIN : minutes <= EPISODE_SHORT_MIN)) {
    out.push({ angle: "runtime", data: { minutes } });
  }

  // Söndag passar bara serier ("söndagsserie"); lördag har ingen vardagston.
  let weekdayKind: WeekdayKind | null = null;
  if (weekday === 0 && item.tmdbType === "tv") weekdayKind = "sunTv";
  else if (weekday === 5) weekdayKind = "fri";
  else if (weekday >= 1 && weekday <= 4) weekdayKind = "week";
  if (weekdayKind) out.push({ angle: "weekday", data: { weekdayKind } });

  out.push({ angle: "challenge", data: {} });
  out.push({ angle: "generic", data: {} });
  return out;
}

/** "person.v2" → {angle:"person", variant:"v2"}. */
export function parseAngleTag(tag: string | null | undefined): { angle: string; variant: string | null } | null {
  if (!tag) return null;
  const [angle, variant] = tag.split(".");
  return angle ? { angle, variant: variant ?? null } : null;
}

/** Andel gånger vi tar den näst bästa i stället för den bästa. */
const SECOND_CHOICE_RATE = 0.3;

export type AngleChoice = {
  offer: AngleOffer;
  /** Vinklar som föll bort för att de användes i någon av de senaste pusharna. */
  skippedRecent: string[];
  /** forceAngle begärdes men fanns inte bland de valbara. */
  forceMissed: boolean;
};

/**
 * Väljer vinkel. Vinklar från användarens två senaste dagliga pushar hoppas över
 * (om det inte lämnar något). Bland resten tas den första 70 % av gångerna, den
 * andra 30 % — lite slump så att prioritetsordningen inte blir ett mönster.
 */
export function chooseAngle(
  offers: AngleOffer[],
  opts: { recentAngles: readonly string[]; forceAngle?: string; rng?: () => number },
): AngleChoice {
  const rng = opts.rng ?? Math.random;
  const generic = offers.find((o) => o.angle === "generic") ?? { angle: "generic" as const, data: {} };

  if (opts.forceAngle) {
    const forced = offers.find((o) => o.angle === opts.forceAngle);
    return { offer: forced ?? generic, skippedRecent: [], forceMissed: !forced };
  }

  const recent = new Set(opts.recentAngles);
  const fresh = offers.filter((o) => !recent.has(o.angle));
  const pool = fresh.length > 0 ? fresh : offers;
  const skippedRecent = offers.filter((o) => recent.has(o.angle)).map((o) => o.angle);
  const offer = pool.length > 1 && rng() < SECOND_CHOICE_RATE ? pool[1] : pool[0];
  return { offer, skippedRecent, forceMissed: false };
}

/** Slumpar en variant, men aldrig samma som förra gången vinkeln användes (om det finns val). */
export function chooseVariant(
  pool: readonly string[],
  last: string | null,
  rng: () => number = Math.random,
): string {
  const fresh = pool.filter((v) => v !== last);
  const list = fresh.length > 0 ? fresh : pool;
  return list[Math.floor(rng() * list.length)];
}
