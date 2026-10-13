// lib/aiPick/followup.ts
//
// "Fortsätt chatten" — följdfrågor i "Välj åt mig". Ingen egen tabell: en
// konversation är raderna i ai_pick_requests med samma session_id (status
// 'ok'). När en POST /api/pick har ett sessionId läses de senaste turerna och:
//
//   1. Allt som redan visats i sessionen (val + alternativ) utesluts — unionen
//      med klientens `exclude`.
//   2. Önskemålen slås ihop över hela samtalet, nyast vinner vid konflikt:
//      "20–40 min avsnitt, drama" + "kortare" → ≈25 min/avsnitt, fortfarande drama.
//   3. Enkla följdfraser (sv+en) tolkas relativt förra förslaget ("fokus" =
//      titeln som visas i huvudplatsen, kan vara ett inbytt alternativ):
//        kortare/shorter     → snävare speltid (film ≈87 % av fokus speltid,
//                              golv 85; serie 75 %, golv 20 — avrundat till 5)
//        längre/longer       → speltidstaket tas bort
//        lättare/roligare    → lättsam stämning (ersätter tidigare genre)
//        mörkare/spännande   → spännande stämning (thriller/mysterium/krim,
//                              aldrig komedi/familj/romantik)
//        mer som den/liknande→ referens = fokus (TMDB recommendations + similar)
//   4. Favoriter/titlar användaren nämnt ("Mina favoriter är X, Y och Z",
//      lib/aiPick/references.ts) samlas över HELA samtalet och följer med.
//   5. En nyare stämning/genre gör ett äldre "kortare" till en mjuk ledtråd.
//        har sett den        → fokus räknas som sedd (utesluts; med markSeen
//                              sparas den även, se lib/aiPick/seen.ts)
//        hellre en film/serie→ byter film/serie från och med den turen
//
// Klientens mediaFilter är standard. Ett uttryckligt byte i en följdfråga
// ("hellre en film") gäller den turen och följande turer tills en nyare
// fråga nämner film/serie — det ändrar aldrig swipens globala filter.
//
// Allt här utom loadConversation är rena funktioner (testbara utan DB).

import { prisma } from "@/lib/prisma";
import {
  explicitGenres,
  explicitMinutes,
  LIGHT_AVOID,
  LIGHT_GENRES,
  mediaHintOf,
  mergeRefQueries,
  parseIntent,
  SHORT_MOVIE_MAX,
  SHORT_TV_MAX,
  THRILL_AVOID,
  THRILL_GENRES,
  withoutReferences,
  type GenreIntent,
  type MediaFilter,
  type MediaType,
  type PickIntent,
} from "@/lib/aiPick/candidates";
import { extractReferences, type RefQuery } from "@/lib/aiPick/references";
import { parseHistoryResult } from "@/lib/aiPick/history";
import { PICK_CHIP_IDS, type PickChipId } from "@/lib/aiPick/types";

/* ======================================================================
 * Typer
 * ==================================================================== */

/** En titel som visats i samtalet. title/year/runtime saknas om historiken rensats. */
export type ConvItem = {
  tmdbId: number;
  mediaType: MediaType;
  title: string | null;
  year: number | null;
  runtimeMin: number | null;
  fromSaved: boolean;
};

export type ConvTurn = {
  requestId: string;
  createdAt: Date;
  prompt: string | null;
  chips: PickChipId[];
  pick: ConvItem | null;
  alternatives: ConvItem[];
  reason: string | null;
};

export type FollowUpSignals = {
  shorter: boolean;
  longer: boolean;
  lighter: boolean;
  darker: boolean;
  similar: boolean;
  seen: boolean;
  /** Uttryckligt byte av typ ("hellre en film", "en serie istället"). */
  mediaSwitch: MediaType | null;
};

export type FollowUpReference = { kind: "known"; item: ConvItem } | { kind: "text"; ref: RefQuery };

export type MergedConversation = {
  intent: PickIntent;
  filter: MediaFilter;
  /** Senaste referensen (debug/bakåtkompatibelt): "mer som den" eller en nämnd titel. */
  reference: FollowUpReference | null;
  /**
   * Alla favoriter/titlar som nämnts i samtalet (äldst → nyast, max
   * MAX_REFERENCES) — de gäller hela samtalet, inte bara turen de nämndes i.
   */
  refQueries: RefQuery[];
  /** "Mer som den" — titeln det syftade på (följer med tills en titel nämns). */
  knownRef: ConvItem | null;
  /** Signalerna i det NYASTE meddelandet. */
  signals: FollowUpSignals;
  /** Titeln som visas just nu (det följdfrågan syftar på). */
  focus: ConvItem | null;
  /** "Har sett den" i nyaste meddelandet → fokus. */
  seenItem: ConvItem | null;
};

/* ======================================================================
 * Följdfraser
 * ==================================================================== */

const PRE = "(?:^|[^\\p{L}\\p{N}])";
const POST = "(?=$|[^\\p{L}\\p{N}])";
const fx = (alts: string) => new RegExp(`${PRE}(?:${alts})${POST}`, "iu");

const SHORTER_RE = fx(
  "kortare|snabbare|mindre långa?|inte (?:så|lika) långa?|shorter|quicker|less long|not (?:so|as) long",
);
const LONGER_RE = fx("längre|längre grejer|longer|something longer");
const LIGHTER_RE = fx(
  "lättare|lättsammare|roligare|gladare|mysigare|mindre (?:tung|tungt|tunga|mörk|mörkt|allvarlig|allvarligt)|lighter|funnier|happier|more fun|less (?:heavy|dark|serious)|easier",
);
const DARKER_RE = fx(
  "mörkare|tyngre|läskigare|spännandare|intensivare|mer (?:spännande|action|intensiv|intensivt)|darker|heavier|scarier|more (?:exciting|thrilling|intense|suspenseful|action)",
);
const SIMILAR_RE = fx(
  "mer som (?:den|det|dem|denna|den här|den där)|mer (?:sånt|sådant|av det|av samma)|(?:något|nåt|en film|en serie|film|serie|serier|filmer) (?:liknande|som (?:den|det|den där|den här))|liknande|i samma stil|samma stil|similar|more like (?:that|this|it)(?: one)?|like (?:that|this) one|something like (?:that|this|it)|more of (?:that|this|the same)|same vibe",
);
const SEEN_RE = fx(
  "(?:har )?(?:redan )?sett (?:den|det|dem|den där|den här|denna|serien|filmen)|seen (?:it|that|this)(?: one)?|already (?:seen|watched)(?: (?:it|that|this))?|(?:i've|ive|i have) (?:already )?(?:seen|watched) (?:it|that|this)|watched (?:it|that|this)(?: already)?",
);
const SWITCH_RE = fx("hellre|istället|i stället|snarare|byt|byta|rather|instead|switch|swap");

export function parseFollowUp(text: string | null | undefined): FollowUpSignals {
  const t = (text ?? "").toLowerCase().trim();
  const none: FollowUpSignals = {
    shorter: false,
    longer: false,
    lighter: false,
    darker: false,
    similar: false,
    seen: false,
    mediaSwitch: null,
  };
  if (!t) return none;
  const hint = mediaHintOf(t);
  const words = t.split(/\s+/).filter(Boolean).length;
  return {
    shorter: SHORTER_RE.test(t),
    longer: LONGER_RE.test(t),
    lighter: LIGHTER_RE.test(t),
    darker: DARKER_RE.test(t),
    similar: SIMILAR_RE.test(t),
    seen: SEEN_RE.test(t),
    // "en film", "film istället", "hellre en serie" — men inte "jag vill se en
    // serie med kort avsnitt om …" (en vanlig fråga, inte ett byte).
    mediaSwitch: hint && (SWITCH_RE.test(t) || words <= 4) ? hint : null,
  };
}

/* ======================================================================
 * Sammanslagning
 * ==================================================================== */

/** Minsta tak "kortare" kan ge — under det blir det orimligt snävt (och poolen skräp). */
export const SHORTER_FLOOR = { movie: 85, tv: 20 } as const;
/**
 * "Kortare" = märkbart kortare, inte hälften: film ≈87 % (109 → 95), serie
 * 75 % (40 → 30). v1 tog 65 % med golv 75 — 109 min blev 75 och poolen
 * kollapsade till "Den nakna pistolen 2½".
 */
export const SHORTER_FACTOR = { movie: 0.875, tv: 0.75 } as const;

/**
 * "Kortare": faktorn ovan av det snävaste av nuvarande tak och fokus-titelns
 * speltid, avrundat till 5 min och alltid minst 5 min kortare än utgångsläget
 * (om golvet tillåter). Utan något att gå på: kort-chippets gränser.
 */
export function tightenRuntime(current: number | null, focusRuntime: number | null, type: MediaType): number {
  const base = Math.min(current ?? Infinity, focusRuntime && focusRuntime > 0 ? focusRuntime : Infinity);
  if (!Number.isFinite(base)) return type === "movie" ? SHORT_MOVIE_MAX : SHORT_TV_MAX;
  let cap = Math.round((base * SHORTER_FACTOR[type]) / 5) * 5;
  if (cap >= base) cap = Math.floor((base - 5) / 5) * 5;
  return Math.max(SHORTER_FLOOR[type], cap);
}

/** Taket för uppluckring efter "kortare": 5 min under utgångsläget (det som visades). */
export function shorterCeil(current: number | null, focusRuntime: number | null): number | null {
  const base = Math.min(current ?? Infinity, focusRuntime && focusRuntime > 0 ? focusRuntime : Infinity);
  return Number.isFinite(base) ? base - 5 : null;
}

function minOrNull(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

/** Alla tmdb-id:n som visats i samtalet (val + alternativ). */
export function shownIdsOf(turns: ConvTurn[]): number[] {
  const ids = new Set<number>();
  for (const t of turns) {
    if (t.pick) ids.add(t.pick.tmdbId);
    for (const a of t.alternatives) ids.add(a.tmdbId);
  }
  return [...ids];
}

/**
 * Titeln följdfrågan syftar på: klientens `focus` om den faktiskt visats i
 * samtalet (helst i turen `followUpOf`), annars den turens val, annars
 * senaste turens val.
 */
export function resolveFocus(
  turns: ConvTurn[],
  followUpOf: string | null,
  focus: { tmdbId: number; mediaType: MediaType } | null,
): ConvItem | null {
  if (turns.length === 0) return null;
  const target = (followUpOf && turns.find((t) => t.requestId === followUpOf)) || turns[turns.length - 1];
  if (focus) {
    const same = (i: ConvItem) => i.tmdbId === focus.tmdbId && i.mediaType === focus.mediaType;
    const inTarget = [target.pick, ...target.alternatives].find((i): i is ConvItem => !!i && same(i));
    if (inTarget) return inTarget;
    for (let k = turns.length - 1; k >= 0; k--) {
      const hit = [turns[k].pick, ...turns[k].alternatives].find((i): i is ConvItem => !!i && same(i));
      if (hit) return hit;
    }
  }
  return target.pick;
}

export type MergeInput = {
  /** Tidigare 'ok'-turer, äldst → nyast. */
  turns: ConvTurn[];
  /** Det nya meddelandet. */
  prompt: string | null;
  chips: PickChipId[];
  clientFilter: MediaFilter;
  /** resolveFocus(...) — vad "den" syftar på i det nya meddelandet. */
  focus: ConvItem | null;
};

/**
 * Effektiva önskemål för samtalet. Varje meddelande läses i ordning, nyast
 * vinner per dimension:
 *   - genre: senaste meddelandet som namngav en genre;
 *   - stämning (lätt/spännande): senaste som uttryckte en — kommer den EFTER
 *     genren ersätter den genren och dess motsatser undviks ("komedi" →
 *     "mörkt och spännande" = thriller/mysterium/krim, ingen komedi), annars
 *     är den bara en flagga ("mysig skräck" är fortfarande skräck);
 *   - speltid: explicita minuter ersätter, "kortare" snävar in, "längre" tar
 *     bort taket, kort-chip/"kort" snävar in men lossar aldrig ett snävare tak.
 *     Ett "kortare"/kort-ord som följs av en NYARE stämning/genre blir en mjuk
 *     ledtråd (runtimeSoft) — det nya önskemålet går före längden;
 *   - film/serie: senaste meddelandet som nämnde typen (se modulkommentaren);
 *   - favoriter/titlar: ALLA som nämnts i samtalet (references.ts) följer med;
 *   - "mer som den": fokus vid det meddelandet, tills en nyare titel nämns;
 *   - överraska: bara det nya meddelandet.
 * Titlarna tas bort ur texten innan stämning/genre tolkas ("gillar Dark" ≠ mörkt).
 */
export function mergeConversationIntent(input: MergeInput): MergedConversation {
  const msgs = [
    ...input.turns.map((t, k) => ({
      prompt: t.prompt,
      chips: t.chips,
      prev: k > 0 ? input.turns[k - 1].pick : null,
    })),
    { prompt: input.prompt, chips: input.chips, prev: input.focus },
  ];

  let genres: GenreIntent | null = null;
  let genreAt = -1;
  let mood: "light" | "thrilling" | null = null;
  let moodAt = -1;
  let maxMovie: number | null = null;
  let maxTv: number | null = null;
  /** "Kortare": uppluckringen får aldrig nå tillbaka till det som visades. */
  let ceilMovie: number | null = null;
  let ceilTv: number | null = null;
  /** Meddelandet som senast satte speltiden, och om det var explicita minuter. */
  let runtimeAt = -1;
  let runtimeExplicit = false;
  let media: { type: MediaType; explicit: boolean } | null = null;
  let reference: FollowUpReference | null = null;
  let knownRef: ConvItem | null = null;
  const refLists: RefQuery[][] = [];
  const followTerms = new Set<string>();
  let newestBase: PickIntent = parseIntent(null, []);
  let newestSig: FollowUpSignals = parseFollowUp(null);

  for (let k = 0; k < msgs.length; k++) {
    const m = msgs[k];
    const refs = extractReferences(m.prompt);
    const stripped = withoutReferences(m.prompt, refs);
    const text = stripped.toLowerCase();
    const sig = parseFollowUp(text);
    const base = parseIntent(stripped, m.chips);
    newestBase = base;
    newestSig = sig;

    const g = explicitGenres(text);
    if (g.labels.length > 0) {
      genres = g;
      genreAt = k;
    }

    let mm: "light" | "thrilling" | null = null;
    if (base.light && !base.thrilling) mm = "light";
    else if (base.thrilling && !base.light) mm = "thrilling";
    if (sig.lighter && !sig.darker) mm = "light";
    else if (sig.darker && !sig.lighter) mm = "thrilling";
    if (mm) {
      mood = mm;
      moodAt = k;
    }

    const prev = m.prev;
    if (explicitMinutes(text) != null) {
      maxMovie = base.maxRuntimeMovie;
      maxTv = base.maxRuntimeTv;
      ceilMovie = null;
      ceilTv = null;
      runtimeAt = k;
      runtimeExplicit = true;
    } else if (sig.shorter) {
      // "kortare" träffar även parseIntents kort-ord — följdtolkningen vinner.
      const fm = prev?.mediaType === "movie" ? prev.runtimeMin : null;
      const ft = prev?.mediaType === "tv" ? prev.runtimeMin : null;
      ceilMovie = shorterCeil(maxMovie, fm);
      ceilTv = shorterCeil(maxTv, ft);
      maxMovie = tightenRuntime(maxMovie, fm, "movie");
      maxTv = tightenRuntime(maxTv, ft, "tv");
      runtimeAt = k;
      runtimeExplicit = false;
      if (k === msgs.length - 1) followTerms.add("fu:shorter");
    } else if (sig.longer) {
      maxMovie = null;
      maxTv = null;
      ceilMovie = null;
      ceilTv = null;
      runtimeAt = -1;
      runtimeExplicit = false;
      if (k === msgs.length - 1) followTerms.add("fu:longer");
    } else if (base.maxRuntimeMovie != null || base.maxRuntimeTv != null) {
      maxMovie = minOrNull(maxMovie, base.maxRuntimeMovie);
      maxTv = minOrNull(maxTv, base.maxRuntimeTv);
      runtimeAt = k;
      runtimeExplicit = false;
    }

    // Skriven typ vinner alltid över swipe-filtret (se effectiveMediaFilter) —
    // även i första meddelandet, inte bara vid "hellre en film".
    if (base.mediaHint) media = { type: base.mediaHint, explicit: true };

    if (refs.length > 0) {
      refLists.push(refs);
      reference = { kind: "text", ref: refs[refs.length - 1] };
      knownRef = null; // en nämnd titel ersätter "mer som den"
    } else if (sig.similar && prev) {
      reference = { kind: "known", item: prev };
      knownRef = prev;
    }
  }

  const g = genres;
  const md = mood;
  const moodWins = md !== null && (g === null || moodAt > genreAt);

  let movieGenres: number[] = [];
  let tvGenres: number[] = [];
  let avoidMovieGenres: number[] = [];
  let avoidTvGenres: number[] = [];
  let wantsFamily = false;
  const terms: string[] = [];
  if (g && !moodWins) {
    movieGenres = [...g.movie];
    tvGenres = [...g.tv];
    wantsFamily = g.wantsFamily;
    terms.push(...g.labels);
  } else if (md === "light") {
    movieGenres = [...LIGHT_GENRES.movie];
    tvGenres = [...LIGHT_GENRES.tv];
    avoidMovieGenres = [...LIGHT_AVOID.movie];
    avoidTvGenres = [...LIGHT_AVOID.tv];
  } else if (md === "thrilling") {
    movieGenres = [...THRILL_GENRES.movie];
    tvGenres = [...THRILL_GENRES.tv];
    avoidMovieGenres = [...THRILL_AVOID.movie];
    avoidTvGenres = [...THRILL_AVOID.tv];
  }
  if (md) terms.push(md);
  const mx = maxMovie;
  const mt = maxTv;
  // Ett äldre "kortare" (inte explicita minuter) väger lätt när ett nyare
  // meddelande bytte stämning eller genre.
  const runtimeSoft = (mx != null || mt != null) && !runtimeExplicit && Math.max(moodAt, genreAt) > runtimeAt;
  if (mx != null || mt != null) terms.push(`maxM${mx ?? "-"}/T${mt ?? "-"}${runtimeSoft ? "~" : ""}`);
  if (newestBase.surprise) terms.push("surprise");
  const sig = newestSig;
  if (sig.lighter) followTerms.add("fu:lighter");
  if (sig.darker) followTerms.add("fu:darker");
  if (sig.seen) followTerms.add("fu:seen");
  if (knownRef) followTerms.add("fu:similar");
  if (sig.mediaSwitch) followTerms.add(`fu:${sig.mediaSwitch}`);
  terms.push(...followTerms);
  const refQueries = mergeRefQueries(refLists);
  if (refQueries.length > 0) terms.push(`refs:${refQueries.length}`);

  const med = media;
  const filter: MediaFilter = med?.explicit ? med.type : input.clientFilter === "both" && med ? med.type : input.clientFilter;

  const intent: PickIntent = {
    movieGenres,
    tvGenres,
    avoidMovieGenres,
    avoidTvGenres,
    maxRuntimeMovie: mx,
    maxRuntimeTv: mt,
    light: md === "light",
    thrilling: md === "thrilling",
    surprise: newestBase.surprise,
    mediaHint: med?.type ?? null,
    wantsFamily,
    runtimeSoft,
    relaxedRuntimeMovie: null,
    relaxedRuntimeTv: null,
    runtimeCeilMovie: mx != null ? ceilMovie : null,
    runtimeCeilTv: mt != null ? ceilTv : null,
    terms,
  };

  return {
    intent,
    filter,
    reference,
    refQueries,
    knownRef,
    signals: sig,
    focus: input.focus,
    seenItem: sig.seen ? input.focus : null,
  };
}

/* ======================================================================
 * Läsning
 * ==================================================================== */

/** Turer modellen får se (äldst → nyast). */
export const CONVERSATION_TURNS = 6;
/** Rader som läses för uteslutningen ("visat i samtalet") — bara id:n behövs. */
const EXCLUDE_ROWS = 30;

type Row = {
  id: string;
  createdAt: Date;
  prompt: string | null;
  chips: unknown;
  pickTmdbId: number | null;
  pickMediaType: string | null;
  pickFromSaved: boolean | null;
  alternatives: unknown;
  reason: string | null;
  result: unknown;
};

function isMediaType(v: unknown): v is MediaType {
  return v === "movie" || v === "tv";
}

function parseChips(v: unknown): PickChipId[] {
  if (!Array.isArray(v)) return [];
  return v.filter((c): c is PickChipId => typeof c === "string" && (PICK_CHIP_IDS as readonly string[]).includes(c));
}

/** En rad → tur. Ögonblicksbilden (result) om den finns, annars bara id:n. */
export function rowToTurn(r: Row): ConvTurn {
  const res = parseHistoryResult(r.result);
  const fromItem = (i: { tmdbId: number; mediaType: MediaType; title: string; year: number | null; runtimeMin: number | null; fromSaved: boolean }): ConvItem => ({
    tmdbId: i.tmdbId,
    mediaType: i.mediaType,
    title: i.title,
    year: i.year ?? null,
    runtimeMin: i.runtimeMin ?? null,
    fromSaved: Boolean(i.fromSaved),
  });
  let pick: ConvItem | null = null;
  let alternatives: ConvItem[] = [];
  if (res) {
    pick = fromItem(res.pick);
    alternatives = res.alternatives.map(fromItem);
  } else {
    // "Rensa historik" nollar result — id:n finns kvar i loggkolumnerna.
    if (r.pickTmdbId && isMediaType(r.pickMediaType)) {
      pick = { tmdbId: r.pickTmdbId, mediaType: r.pickMediaType, title: null, year: null, runtimeMin: null, fromSaved: Boolean(r.pickFromSaved) };
    }
    if (Array.isArray(r.alternatives)) {
      for (const a of r.alternatives as unknown[]) {
        if (!a || typeof a !== "object") continue;
        const o = a as Record<string, unknown>;
        if (typeof o.tmdbId === "number" && isMediaType(o.mediaType)) {
          alternatives.push({ tmdbId: o.tmdbId, mediaType: o.mediaType, title: null, year: null, runtimeMin: null, fromSaved: Boolean(o.fromSaved) });
        }
      }
      alternatives = alternatives.slice(0, 2);
    }
  }
  return {
    requestId: r.id,
    createdAt: r.createdAt,
    prompt: r.prompt,
    chips: parseChips(r.chips),
    pick,
    alternatives,
    reason: r.reason,
  };
}

/**
 * Sessionens tidigare 'ok'-turer för användaren. `turns` = de senaste
 * CONVERSATION_TURNS (äldst → nyast) för prompten; `shownIds` = allt som
 * visats i de senaste EXCLUDE_ROWS turerna. selftest-rader räknas med så att
 * en följdfråga kan testas via /api/pick/selftest?session=….
 */
export async function loadConversation(
  uid: string,
  sessionId: string,
): Promise<{ turns: ConvTurn[]; shownIds: number[] }> {
  const rows = await prisma.aiPickRequest.findMany({
    where: { userId: uid, sessionId, status: "ok", source: { in: ["premium", "credit", "selftest"] } },
    orderBy: { createdAt: "desc" },
    take: EXCLUDE_ROWS,
    select: {
      id: true,
      createdAt: true,
      prompt: true,
      chips: true,
      pickTmdbId: true,
      pickMediaType: true,
      pickFromSaved: true,
      alternatives: true,
      reason: true,
      result: true,
    },
  });
  const all = rows.map(rowToTurn);
  return {
    turns: all.slice(0, CONVERSATION_TURNS).reverse(),
    shownIds: shownIdsOf(all),
  };
}

/* ======================================================================
 * Sammanfattning till prompten
 * ==================================================================== */

/** Kort engelsk sammanfattning av de sammanslagna önskemålen ("Wishes so far"). */
export function describeWishes(intent: PickIntent, filter: MediaFilter): string | null {
  const parts: string[] = [];
  if (filter === "movie") parts.push("movies only");
  else if (filter === "tv") parts.push("series only");
  const genres = intent.terms.filter(
    (t) =>
      !t.includes(":") &&
      !t.startsWith("max") &&
      !t.startsWith("relax") &&
      t !== "light" &&
      t !== "thrilling" &&
      t !== "surprise" &&
      t !== "short",
  );
  if (genres.length) parts.push(`genre: ${genres.join(" or ")}`);
  if (intent.light) parts.push("mood: light / feel-good (no horror/thriller)");
  if (intent.thrilling) parts.push("mood: dark / thrilling (no comedy, family or romance)");
  const rt = (max: number, relaxed: number | null, unit: string) =>
    `${unit} ${intent.runtimeSoft ? "ideally " : ""}≤ ${max} min${relaxed != null && relaxed > max ? ` (relaxed to ${relaxed})` : ""}`;
  if (intent.maxRuntimeMovie != null && filter !== "tv") parts.push(rt(intent.maxRuntimeMovie, intent.relaxedRuntimeMovie, "films"));
  if (intent.maxRuntimeTv != null && filter !== "movie") parts.push(rt(intent.maxRuntimeTv, intent.relaxedRuntimeTv, "episodes"));
  if (intent.surprise) parts.push("surprise me");
  return parts.length ? parts.join("; ") : null;
}
