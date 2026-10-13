// lib/aiPick/references.ts
//
// Referenstitlar i "Välj åt mig": titlar användaren säger att den gillar.
//
//   "Mina favoriter är inception, shutter island och prisoners."
//   "favoritfilmer: X, Y" · "jag gillar X och Y" · "i stil med X eller Y"
//   "en serie som Dark" · "tycker om serien House" · "like X and Y"
//   "my favourite movies are X, Y, Z" · "X" (citat)
//
// Bakgrund (prod 2026-10-13): bara en enda titel per fråga plockades upp, och
// listformen "Mina favoriter är X, Y och Z" inte alls — så inga liknande titlar
// kom in i poolen och valet blev End of Watch i stället för något i stil med
// Inception/Shutter Island/Prisoners.
//
// Tre steg:
//   1. extractReferences   — ren textparsning (≤ 3 titlar, textordning).
//      Hellre ingen referens än skräp: genre-/stämningsord ("gillar drama",
//      "jag gillar spännande filmer"), generiska substantiv och bisatser
//      ("gillar när det är mörkt") blir ALDRIG titlar.
//   2. resolveReferences   — TMDB /search/multi (UI-språket, sedan en-US),
//      träffen väljs av den rena funktionen pickBestMatch.
//   3. similarForReferences — /recommendations + /similar per referens,
//      sammanslaget och rankat (rankSimilar, ren).
//
// Modulen är medvetet fristående (importerar inte candidates.ts) så att
// candidates.ts kan importera den utan cirkelberoende. TMDB-anropen följer
// samma tokenkonvention som candidates.ts/recs-pipelinen: TMDB_V4_TOKEN
// (Bearer), annars TMDB_API_KEY — och går genom tmdbFetch (concurrency-tak +
// retry).

import { tmdbFetch } from "@/lib/tmdbClient";

export type RefMediaType = "movie" | "tv";

export type RefQuery = { query: string; mediaHint: RefMediaType | null };

export type ResolvedRef = {
  tmdbId: number;
  mediaType: RefMediaType;
  title: string;
  year: number | null;
  genreIds: number[];
  voteAverage: number | null;
  voteCount: number;
};

export type SimilarItem = {
  tmdbId: number;
  mediaType: RefMediaType;
  title: string;
  voteAverage: number | null;
  voteCount: number;
  genreIds: number[];
  /** Titlarna (ResolvedRef.title) på de favoriter titeln rekommenderas för. */
  similarTo: string[];
};

/** Max antal referenstitlar per fråga. */
export const MAX_REFS = 3;
/** Minsta antal röster för att en söksträff ska duga som referens. */
export const REF_MIN_VOTES = 30;

/* ======================================================================
 * 1. Textparsning
 * ==================================================================== */

/** Genrer i plural/obestämd form som kan stå före "som"/"like". */
const GENRE_ALT = [
  "komedier", "komedi", "thrillers", "thrillrar", "thriller", "deckare", "dramer", "drama", "dramas",
  "dokumentärer", "rysare", "skräck", "action", "comedies", "comedy", "dramas", "mysteries", "documentaries",
  "sitcoms", "romcoms", "anime", "k-dramas", "kdramas", "westerns", "musikaler", "musicals", "biopics",
  "stuff", "grejer", "saker", "things", "something", "anything", "något", "nåt", "någonting", "nånting",
].join("|");

/** Föregår ett ord direkt (Unicode-medvetet — \b fungerar inte för åäö). */
const NB = String.raw`(?<![\p{L}\p{N}'’])`;

type Trigger = { re: string; minItems: number; type?: RefMediaType; seen?: boolean; bareLike?: boolean };

/**
 * Utlösare. Efter utlösaren fångas en LISTA fram till meningsslut/kontrastord.
 * `minItems` 2 = bara som lista ("som X eller Y", "like X and Y") — de nakna
 * orden är för vanliga för att lita på med en enda titel efter.
 */
const TRIGGERS: Trigger[] = [
  // Favoriter (sv)
  { re: String.raw`(?:mina\s+|min\s+|våra\s+)?favorit-?(?:film(?:er(?:na)?)?)\s*(?:är|=|:|inkluderar|blir)`, minItems: 1, type: "movie" },
  { re: String.raw`(?:mina\s+|min\s+|våra\s+)?favorit-?(?:(?:tv-?)?serie(?:r(?:na)?)?)\s*(?:är|=|:|inkluderar|blir)`, minItems: 1, type: "tv" },
  { re: String.raw`(?:mina\s+|min\s+|våra\s+)?favorit(?:er(?:na)?|titlar|titel)?\s*(?:är|=|:|inkluderar)`, minItems: 1 },
  // Favoriter (en)
  { re: String.raw`(?:my\s+|our\s+)?(?:all[- ]time\s+)?favou?rite\s+(?:movies?|films?)\s*(?:are|is|=|:|include)`, minItems: 1, type: "movie" },
  { re: String.raw`(?:my\s+|our\s+)?(?:all[- ]time\s+)?favou?rite\s+(?:tv\s+)?(?:shows?|series)\s*(?:are|is|=|:|include)`, minItems: 1, type: "tv" },
  { re: String.raw`(?:my\s+|our\s+)?(?:all[- ]time\s+)?favou?rites?\s*(?:are|is|=|:|include)`, minItems: 1 },
  // Gillar (sv)
  {
    re: String.raw`(?:tycker\s+om|tyckte\s+om|gillar|gillade|gillat|älskar|älskade|älskat|diggar|diggade|digga)(?:\s+(?:verkligen|också|även|mest|särskilt|speciellt|skarpt|starkt|väldigt|jätte|ju|nog|faktiskt))*(?:\s+(?:mycket|mkt))?`,
    minItems: 1,
  },
  // Stil/likhet (sv) — "film/serie som" anger typen själv.
  { re: String.raw`(?:en\s+|nån\s+|någon\s+)?(?:film|filmer)\s+(?:som(?:\s+(?:liknar|påminner\s+om|är\s+som))?|i\s+stil\s+med|liknande|likt)`, minItems: 1, type: "movie" },
  { re: String.raw`(?:en\s+|nån\s+|någon\s+)?(?:(?:tv-?)?serie|(?:tv-?)?serier)\s+(?:som(?:\s+(?:liknar|påminner\s+om|är\s+som))?|i\s+stil\s+med|liknande|likt)`, minItems: 1, type: "tv" },
  {
    re: String.raw`(?:i\s+(?:samma\s+)?stil\s+med|i\s+samma\s+anda\s+som|liknande|liknar|likt|påminner\s+om|ungefär\s+som|typ\s+som|à\s+la|a\s+la|mer\s+som|(?:något|nåt|någonting|nånting|mer|lite)\s+som)`,
    minItems: 1,
  },
  // "komedier som The Office", "mörka thrillers som Prisoners", "dramas like X".
  { re: String.raw`(?:${GENRE_ALT}|\p{L}*filmer|\p{L}*serier)\s+(?:som|like|such\s+as)`, minItems: 1 },
  { re: String.raw`som`, minItems: 2 },
  // Sett nyss (sv/en) — bara om inget negativt följer.
  {
    re: String.raw`(?:har\s+)?(?:precis|nyss|just)\s+(?:sett|kollat|tittat\s+på)|(?:såg|kollade)\s+(?:precis|nyss|just)(?:\s+på)?|i\s+just\s+(?:watched|saw|finished)|just\s+(?:watched|saw|finished)`,
    minItems: 1,
    seen: true,
  },
  // Gillar (en)
  {
    re: String.raw`(?:i|we)\s+(?:really\s+|also\s+|totally\s+|absolutely\s+)?(?:like|liked|love|loved|enjoy|enjoyed|adore|adored|dig)`,
    minItems: 1,
  },
  { re: String.raw`(?:i'm|i\s+am|im)\s+(?:a\s+(?:big\s+|huge\s+)?)?fans?\s+of`, minItems: 1 },
  // Likhet (en)
  {
    re: String.raw`(?:similar\s+to|something\s+like|anything\s+like|stuff\s+like|more\s+like|in\s+the\s+(?:style|vein|spirit)\s+of|along\s+the\s+lines\s+of|reminds?\s+me\s+of|fans?\s+of)`,
    minItems: 1,
  },
  { re: String.raw`(?:movies?|films?)\s+like`, minItems: 1, type: "movie" },
  { re: String.raw`(?:tv\s+)?(?:shows?|series)\s+like`, minItems: 1, type: "tv" },
  { re: String.raw`like`, minItems: 2, bareLike: true },
  // "filmen X" / "serien X" utan annan utlösare: typordet gör det säkert.
  { re: String.raw`(?:filmen|(?:tv-?)?serien|dokumentären)`, minItems: 1 },
];

/** Punkt som INTE avslutar listan: förkortningar ("Mr. Robot", "Dr. Strangelove"). */
const ABBR = String.raw`(?<!(?:^|[\s,])(?:mr|mrs|ms|dr|st|jr|sr|vs|vol|nr|no|pt))`;
/** Listans slut: meningsslut eller kontrastord/ny bisats. */
const LIST_END = String.raw`(?=\s*(?:[!?;\n]|\((?!\s*(?:18|19|20)\d{2}\s*\))|${ABBR}\.(?:\s|$)|:(?:\s|$))|\s+(?:men|fast|för\s+att|eftersom|då|så\s+att|så\s+(?:kan|vill|ge|tipsa)|but|because|since|though|although|so\s+(?:that|can|please|give))(?![\p{L}])|\s*$)`;

const TRIGGER_RES = TRIGGERS.map((t) => ({
  re: new RegExp(String.raw`${NB}(?:${t.re})(?![\p{L}\p{N}])\s*(?::\s*)?(?:heter\s+|called\s+|named\s+)?(.+?)${LIST_END}`, "giu"),
  minItems: t.minItems,
  type: t.type,
  seen: !!t.seen,
  bareLike: !!t.bareLike,
}));

const LIST_SPLIT = /\s*[,/]\s*(?:(?:och|and|eller|or|samt|plus|men\s+även|men\s+också)\s+)?|\s+(?:och|and|eller|or|samt|plus|&|n')\s+/iu;
const QUOTED_RE = /["“”„«»]([^"“”„«»\n]{2,60})["“”„«»]|(?<![\p{L}\p{N}])'([^'\n]{2,60})'(?![\p{L}\p{N}])/gu;

const TYPE_PREFIX_RE = /^(?:(?:tv-?)?serien|filmen|dokumentären|the\s+(?:tv\s+)?(?:show|series)|the\s+(?:movie|film)|(?:tv\s+)?show|series|movie|film|serien)\s+/iu;

const LEAD_FILLER_RE =
  /^(?:(?:typ|t\.?\s?ex\.?|till\s+exempel|exempelvis|bland\s+annat|främst|framför\s+allt|både|t\.?o\.?m\.?|e\.?g\.?|such\s+as|for\s+example|for\s+instance|especially|mainly|both|even|kanske|maybe|nog|säkert|alltså|ju|faktiskt|verkligen|really|actually)\s+)+/iu;
const TRAIL_FILLER_RE =
  /(?:\s+(?:tack|please|thanks|thx|pls|plz|kanske|maybe|mycket|mkt|jättemycket|väldigt\s+mycket|sjukt\s+mycket|också|även|med|too|also|as\s+well|a\s+lot|so\s+much|very\s+much|typ|osv|o\.?s\.?v\.?|etc\.?|m\.?fl\.?|och\s+liknande|och\s+sånt|and\s+such|and\s+stuff|bl\.?\s?a\.?|t\.?\s?ex\.?|förresten|btw|haha|lol|:\)|:d|<3)|[\s.,!?…]+)+$/iu;

/** Artiklar — tas bort före ordkontrollerna (titeln behåller dem). */
const ARTICLES = new Set(["the", "a", "an", "en", "ett"]);

/** Ord som gör frasen till en bisats, aldrig en titel (var som helst i frasen). */
const CLAUSE_WORDS = new Set([
  // sv
  "jag", "du", "vi", "ni", "han", "hon", "mig", "mej", "dig", "dej", "oss", "er", "sig",
  "är", "var", "vara", "varit", "blir", "bli", "vill", "ville", "kan", "kunde", "ska", "skall", "skulle",
  "har", "hade", "får", "fick", "behöver", "måste", "brukar", "gillar", "gillade", "tycker", "tyckte",
  "inte", "ej", "aldrig", "när", "hur", "vad", "varför", "eftersom", "att", "något", "nåt", "någonting",
  "nånting", "någon", "nån", "några", "nåra", "ngt", "lite", "mycket", "allt", "alla", "sånt", "sådant",
  "sådana", "såna", "kolla", "titta", "se", "ge", "rekommendera", "föreslå", "tipsa", "hitta", "visa",
  "hellre", "helst", "gärna", "bara", "också", "även", "verkligen", "egentligen", "nu", "idag", "ikväll",
  "imorgon", "senare", "sen", "sedan", "liksom", "ju", "väl", "mm", "osv",
  "älskar", "älskade", "älskat", "gillat", "diggar", "diggade", "hatar", "hatade", "såg", "sett", "kollade",
  // en
  "is", "are", "was", "were", "be", "been", "being", "would", "could", "should", "will", "can", "want",
  "wanna", "need", "needs", "have", "has", "had", "don't", "dont", "doesn't", "didn't", "not", "never",
  "when", "how", "what", "why", "because", "something", "anything", "someone", "me", "myself", "you",
  "we", "us", "really", "very", "watch", "watching", "recommend", "suggest", "give", "find", "show me",
  "tonight", "today", "now", "please", "maybe", "lots", "stuff", "things", "kinda", "sorta",
]);

/** Ord som aldrig får INLEDA en titel (efter artiklar). */
const FIRST_STOP = new Set([
  "det", "den", "de", "dom", "dem", "detta", "denna", "dessa", "så", "mer", "fler", "annat", "andra",
  "liknande", "liknar", "likt", "påminner", "som", "med", "utan", "till", "för", "från", "om", "på", "av", "och", "eller", "men",
  "min", "mitt", "mina", "din", "ditt", "dina", "vår", "vårt", "våra", "hans", "hennes", "deras",
  "it", "its", "that", "this", "those", "these", "them", "they", "some", "any", "more", "other", "others",
  "with", "without", "about", "of", "in", "on", "at", "to", "for", "from", "like", "and", "or", "but",
  "my", "your", "our", "his", "her", "their", "such", "kind", "sort", "type", "lot", "all", "most",
]);

/** Rena genrenamn — avvisas även med stor bokstav ("Jag gillar Drama"). */
const GENRE_WORDS = new Set([
  "drama", "dramer", "dramas", "dramat", "komedi", "komedier", "comedy", "comedies", "thriller", "thrillers",
  "thrillrar", "skräck", "horror", "action", "actionfilm", "äventyr", "adventure", "adventures", "fantasy",
  "scifi", "sci-fi", "sci", "fi", "science", "fiction", "romantik", "romance", "romcom", "romcoms", "rom-com",
  "deckare", "deckarna", "mysterier", "mysterium", "mystery", "mysteries", "krim", "kriminal", "brott",
  "crime", "dokumentär", "dokumentärer", "documentary", "documentaries", "docs", "dokumentärserier",
  "animerat", "animerad", "animerade", "animation", "anime", "tecknat", "tecknad", "tecknade", "cartoons",
  "western", "westerns", "krig", "krigs", "war", "historia", "historiskt", "historical", "history",
  "musikal", "musikaler", "musical", "musicals", "musik", "music", "familj", "familjefilm", "family",
  "barn", "barnfilm", "kids", "sport", "sports", "biografi", "biopic", "biopics", "biografier", "superhjälte",
  "superhjältar", "superhero", "superheroes", "zombie", "zombies", "vampyr", "vampire", "vampires",
  "rysare", "rysligt", "splatter", "slasher", "noir", "satir", "satire", "parodi", "parody", "reality",
  "realityserier", "standup", "stand-up", "true-crime", "truecrime", "sitcom", "sitcoms",
  "k-drama", "kdrama", "k-dramas", "kdramas", "nordic", "nordisk", "noir-",
]);

/** Stämning/egenskaper/generiska ord — en fras av BARA sådana är ingen titel. */
const VOCAB_WORDS = new Set([
  ...GENRE_WORDS,
  // stämning sv
  "mörk", "mörkt", "mörka", "spännande", "spänning", "intensiv", "intensivt", "intensiva", "obehaglig",
  "obehagligt", "obehagliga", "psykologisk", "psykologiskt", "psykologiska", "mindfuck", "mindfucks",
  "twist", "twistar", "twisty", "läskig", "läskigt", "läskiga", "rolig", "roligt", "roliga", "kul",
  "lätt", "lättsam", "lättsamt", "lättsamma", "feelgood", "feel-good", "mysig", "mysigt", "mysiga",
  "myspys", "sorglig", "sorgligt", "sorgliga", "gripande", "tänkvärd", "tänkvärt", "tänkvärda", "smart",
  "smarta", "smarts", "vacker", "vackert", "vackra", "kort", "korta", "kortare", "lång", "långt",
  "långa", "längre", "snabb", "snabbt", "bra", "bästa", "dålig", "dåliga", "gamla", "gammal", "gammalt",
  "nya", "ny", "nytt", "nyare", "äldre", "klassiker", "klassiska", "klassisk", "svensk", "svenska",
  "svenskt", "amerikansk", "amerikanska", "brittisk", "brittiska", "koreansk", "koreanska", "japansk",
  "japanska", "dansk", "danska", "norsk", "norska", "fransk", "franska", "spansk", "spanska",
  "nordiska", "europeisk", "europeiska", "engelsk", "engelska", "romantisk", "romantiska", "romantiskt",
  "blodig", "blodiga", "brutal", "brutala", "brutalt", "realistisk", "realistiska", "episk", "episka",
  "storslagen", "storslagna", "kultfilm", "kultfilmer", "indie", "independent", "lågbudget", "b-film",
  "b-filmer", "action-", "story", "storyn", "handling", "handlingen", "karaktärer", "skådespelare",
  "slut", "slutet", "plot", "plottwist", "plottwistar", "sånt", "sådant", "grejer", "grejor", "saker",
  "mys", "skratt", "gråt", "tårar", "spöken", "monster", "rymden", "aliens", "utomjordingar",
  "seriemördare", "mord", "polis", "poliser", "detektiv", "detektiver", "agenter", "spioner",
  // stämning en
  "dark", "darker", "gritty", "intense", "tense", "suspenseful", "suspense", "creepy", "scary", "spooky",
  "disturbing", "psychological", "mind-bending", "mindbending", "twists", "twisted", "funny", "fun",
  "light", "lighthearted", "light-hearted", "cozy", "cosy", "chill", "uplifting", "wholesome", "sad",
  "emotional", "moving", "touching", "smart", "clever", "beautiful", "short", "shorter", "long", "longer",
  "quick", "good", "great", "best", "bad", "old", "new", "newer", "older", "classic", "classics", "swedish",
  "american", "british", "korean", "japanese", "danish", "norwegian", "french", "spanish", "european",
  "foreign", "english", "romantic", "bloody", "violent", "realistic", "epic", "cult", "slow", "slow-burn",
  "slowburn", "feel", "feelgood", "plot", "story", "stories", "characters", "acting", "endings", "ending",
  "space", "ghosts", "monsters", "killers", "serial", "detectives", "detective", "spies", "spy", "heists",
  "heist", "twist", "twists", "ones", "one", "kind", "type", "genre", "genres", "vibe", "vibes", "mood",
  "high", "quality", "rated", "highly", "popular", "underrated", "hidden", "gems", "gem",
]);

/** Generiska substantiv (och sammansättningar) — "jag gillar skräckfilmer". */
const GENERIC_NOUN_RE =
  /^(?:.*(?:filmer|filmerna|serier|serierna|dokumentärer)|film|filmen|filmerna|serie|serien|tv-serie|tv-serier|dokumentär|movie|movies|film|films|show|shows|series|tv|tv-shows?|docs?|program|programmet|avsnitt|säsong|säsonger|episodes?|seasons?|titlar|titles?|grejer|stuff|things?|content|innehåll)$/iu;

/** Negation strax före utlösaren: "gillar inte", "I don't like", "never liked". */
const NEGATION_BEFORE_RE = /(?:^|[\s,])(?:inte|ej|aldrig|icke|not|never|don't|dont|doesn't|didn't|do\s+not|does\s+not|did\s+not|wouldn't)(?:\s+(?:really|verkligen|alls|så))?\s*$/iu;
/** "I'd like X and Y" = vill ha, inte gillar. Bara för nakna "like". */
const WOULD_BEFORE_RE = /(?:would|i'd|we'd|id|wanna|skulle)\s*$/iu;
/** Negativt omdöme efter "såg nyss X" → inte en favorit. */
const NEGATIVE_AFTER_RE = /\b(?:hatade|hatar|tråkig|tråkigt|dålig|dåligt|gillade\s+(?:den\s+|det\s+)?inte|tyckte\s+inte\s+om|hated|boring|bad|awful|didn't\s+like|did\s+not\s+like|meh)\b/iu;

/** Pronomen som får inleda en titel om den skrivs med versal. */
const SOFT_FIRST = new Set(["den", "det", "de", "dom"]);

function allWordsCapitalized(raw: string): boolean {
  return raw
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w) && !/^(?:of|the|and|in|on|a|an|i|och|på|av|med|till)$/u.test(w))
    .every((w) => isTitleCased(w));
}

function isTitleCased(raw: string): boolean {
  const ch = raw.trim().charAt(0);
  return ch !== "" && ch !== ch.toLowerCase() && ch === ch.toUpperCase();
}

function cleanItem(raw: string): string {
  let q = raw.replace(/\s+/g, " ").trim();
  let prev = "";
  while (prev !== q) {
    prev = q;
    q = q
      .replace(LEAD_FILLER_RE, "")
      .replace(TRAIL_FILLER_RE, "")
      .replace(/^[\s"'“”„«»‘’`´*_\-–—:]+|[\s"'“”„«»‘’`´*_\-–—:,]+$/gu, "")
      .trim();
  }
  return q;
}

/**
 * Är frasen en trolig titel? `explicit` = kom ur citat eller efter "filmen/
 * serien" — då litar vi på den utom när den uppenbart är en bisats.
 */
export function validTitlePhrase(raw: string, explicit = false): string | null {
  const q = cleanItem(raw);
  if (q.length < 2 || q.length > 60) return null;
  if (!/[\p{L}\p{N}]/u.test(q)) return null;
  const words = q.split(" ");
  if (words.length > 6) return null;
  if (explicit) return q;

  const lower = words.map((w) => w.toLowerCase().replace(/[.,!?…]+$/u, ""));
  const content = lower.filter((w, i) => !(i === 0 && ARTICLES.has(w)));
  if (content.length === 0) return null;
  if (normalizeTitle(q).replace(/\s/g, "").length < 2) return null;
  const titleCased = isTitleCased(q);
  // "Den skyldige", "Det sjunde inseglet" — bestämda pronomen inleder svenska
  // titlar, men bara med versal räknas de.
  if (FIRST_STOP.has(content[0]) && !(titleCased && SOFT_FIRST.has(content[0]))) return null;
  if (content.some((w) => CLAUSE_WORDS.has(w))) return null;
  // Engelska kortformer som aldrig är titlar ("i'm", "it's" …).
  if (content.some((w) => /^(?:i'm|it's|that's|there's|det's|i've|i'd|you're|we're)$/u.test(w))) return null;

  const allVocab = content.every((w) => VOCAB_WORDS.has(w) || GENERIC_NOUN_RE.test(w));
  if (allVocab) {
    // "Dark"/"Smart"/"Ghosts" med stor bokstav, ensamma: troligen titeln.
    // Rena genrenamn ("Drama", "Thriller") och generiska ord aldrig.
    // "True Detective", "Black Mirror" — flera ord, alla med versal: titel.
    const single = content.length === 1;
    const w = content[0];
    const singleOk = titleCased && single && !GENRE_WORDS.has(w) && !GENERIC_NOUN_RE.test(w);
    const multiOk = !single && allWordsCapitalized(q) && !content.every((x) => GENRE_WORDS.has(x) || GENERIC_NOUN_RE.test(x));
    if (!singleOk && !multiOk) return null;
  }
  // "spännande filmer som …", "koreanska serier" — generiskt substantiv i
  // gemener är aldrig en titel ("Scary Movie" med versal går igenom).
  if (!titleCased && content.some((w) => GENERIC_NOUN_RE.test(w))) return null;
  return q;
}

function typeOfWord(w: string): RefMediaType | null {
  const t = w.toLowerCase();
  if (/film|movie/.test(t)) return "movie";
  if (/serie|show|series|dokument/.test(t)) return "tv";
  return null;
}

/**
 * Upp till 3 titlar användaren säger att den gillar, i textordning.
 * Tom lista när inget är säkert — hellre ingen referens än fel.
 */
export function extractReferences(text: string | null | undefined): RefQuery[] {
  const src = (text ?? "").replace(/[‘’´`]/g, "'").replace(/\s+/g, " ").trim();
  if (src.length < 2) return [];

  type Found = { at: number; query: string; mediaHint: RefMediaType | null };
  const found: Found[] = [];
  const quotedSpans: [number, number][] = [];

  for (const m of src.matchAll(QUOTED_RE)) {
    const inner = m[1] ?? m[2] ?? "";
    const at = m.index ?? 0;
    quotedSpans.push([at, at + m[0].length]);
    const before = src.slice(Math.max(0, at - 14), at);
    const tw = before.match(/(filmen|serien|tv-serien|dokumentären|the\s+movie|the\s+film|the\s+show|the\s+series)\s*$/iu);
    const q = validTitlePhrase(inner, true);
    if (q) found.push({ at, query: q, mediaHint: tw ? typeOfWord(tw[1]) : null });
  }
  const inQuote = (pos: number) => quotedSpans.some(([a, b]) => pos >= a && pos < b);

  for (const { re, minItems, type, seen, bareLike } of TRIGGER_RES) {
    re.lastIndex = 0;
    for (const m of src.matchAll(re)) {
      const at = m.index ?? 0;
      if (inQuote(at)) continue;
      const before = src.slice(Math.max(0, at - 24), at);
      if (NEGATION_BEFORE_RE.test(before)) continue;
      if (bareLike && WOULD_BEFORE_RE.test(before)) continue;
      const list = m[1] ?? "";
      if (seen && NEGATIVE_AFTER_RE.test(src.slice(at, at + m[0].length + 40))) continue;
      const listStart = at + m[0].length - list.length;
      const items: Found[] = [];
      let offset = 0;
      for (const rawItem of list.split(LIST_SPLIT)) {
        if (!rawItem) continue;
        const pos = list.indexOf(rawItem, offset);
        if (pos >= 0) offset = pos + rawItem.length;
        if (/["“”„«»]/u.test(rawItem)) continue; // citat hanteras ovan
        const trimmed = rawItem.trim().replace(LEAD_FILLER_RE, "");
        const tw = trimmed.match(TYPE_PREFIX_RE);
        const body = tw ? trimmed.slice(tw[0].length) : trimmed;
        // Typordet är "explicit" bara i bestämd form ("serien X", "the show X").
        const explicit = !!tw && /^(?:(?:tv-?)?serien|filmen|dokumentären|the\s)/iu.test(tw[0]);
        const q = validTitlePhrase(body, explicit);
        if (!q) continue;
        // Även explicita fraser får inte vara bisatser ("serien ska vara kort").
        if (explicit && !validLoose(q)) continue;
        items.push({ at: listStart + Math.max(0, pos), query: q, mediaHint: (tw ? typeOfWord(tw[0]) : null) ?? type ?? null });
      }
      if (items.length >= minItems) found.push(...items);
    }
  }

  found.sort((a, b) => a.at - b.at);
  const uniq: (Found & { k: string })[] = [];
  for (const f of found) {
    const k = normalizeTitle(f.query);
    if (!k) continue;
    const dup = uniq.find((u) => u.k === k);
    if (dup) {
      if (!dup.mediaHint && f.mediaHint) dup.mediaHint = f.mediaHint;
      continue;
    }
    uniq.push({ ...f, k });
  }
  // Samma titel ur två utlösare ("något som Inception" / "Inception") —
  // behåll den kortare, renare.
  const contains = (long: string, short: string) => long !== short && ` ${long} `.includes(` ${short} `);
  for (const u of uniq) {
    const shorter = uniq.find((o) => contains(u.k, o.k));
    if (shorter && !shorter.mediaHint && u.mediaHint) shorter.mediaHint = u.mediaHint;
  }
  return uniq
    .filter((u) => !uniq.some((o) => contains(u.k, o.k)))
    .slice(0, MAX_REFS)
    .map((u) => ({ query: u.query, mediaHint: u.mediaHint }));
}

/** Kontroll för explicita fraser: inleds inte med bisatsord. */
function validLoose(q: string): boolean {
  const first = q.split(" ")[0]?.toLowerCase() ?? "";
  return !CLAUSE_WORDS.has(first) && !FIRST_STOP.has(first);
}

/* ======================================================================
 * 2. Matchning av söksträffar (ren)
 * ==================================================================== */

/** Jämförbar titel: gemener, utan diakritik/skiljetecken, utan inledande artikel. */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(?:the|a|an) (?=\S)/, "")
    .trim();
}

export type TmdbSearchHit = {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  vote_count?: number;
  vote_average?: number;
  popularity?: number;
  genre_ids?: number[];
  release_date?: string | null;
  first_air_date?: string | null;
  adult?: boolean;
};

export type PickBestOptions = {
  /** true = typen kom från användarens egna ord om titeln ("serien X") — hård. */
  strictType?: boolean;
  minVotes?: number;
};

function yearOfDate(date: string | null | undefined): number | null {
  if (!date || date.length < 4) return null;
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) && y > 1800 ? y : null;
}

/** "Prisoners (2013)" / "dune 2021" → { q: "prisoners", year: 2013 }. */
export function splitQueryYear(query: string): { q: string; year: number | null } {
  const t = query.trim();
  const m = t.match(/^(.*\S)\s*\(\s*((?:18|19|20)\d{2})\s*\)$/u) ?? t.match(/^(.*\S)\s+((?:18|19|20)\d{2})$/u);
  // "Blade Runner 2049" — ett framtida år är en del av titeln, inte ett årtal.
  const maxYear = new Date().getFullYear() + 2;
  if (m && normalizeTitle(m[1]).length >= 2 && Number(m[2]) <= maxYear) return { q: m[1], year: Number(m[2]) };
  return { q: query, year: null };
}

/**
 * Bästa TMDB-träffen för en referensfråga — hellre ingen än fel.
 *  1. Exakt normaliserad titel/originaltitel (≥ 30 röster).
 *  2. Annars den populäraste vars titel BÖRJAR med frågan som hela ord
 *     ("shutter" → "Shutter Island"; frågan ≥ 4 tecken).
 * Inom en nivå: angivet år först; typ — `strictType` filtrerar bort fel typ
 * om rätt typ finns, annars vinner `preferType` om den inte har < 1/5 av den
 * andra typens röster (då är den andra uppenbart "den" titeln); sist flest röster.
 */
export function pickBestMatch(
  results: readonly TmdbSearchHit[],
  query: string,
  preferType: RefMediaType | null,
  opts: PickBestOptions = {},
): (TmdbSearchHit & { media_type: RefMediaType }) | null {
  const fullQ = normalizeTitle(query);
  const split = splitQueryYear(query);
  const q = normalizeTitle(split.q);
  if (q.length < 2) return null;
  const minVotes = opts.minVotes ?? REF_MIN_VOTES;
  const typed = results.filter(
    (r): r is TmdbSearchHit & { media_type: RefMediaType } =>
      (r.media_type === "movie" || r.media_type === "tv") &&
      Number.isFinite(r.id) &&
      !r.adult &&
      (r.vote_count ?? 0) >= minVotes,
  );
  const titles = (r: TmdbSearchHit) =>
    [r.title, r.name, r.original_title, r.original_name].filter((t): t is string => !!t).map(normalizeTitle);
  const yearOf = (r: TmdbSearchHit) => yearOfDate(r.media_type === "tv" ? r.first_air_date : r.release_date);

  // "1917", "Dune 2021"-liknande titlar: hela frågan som exakt titel först.
  let year = split.year;
  let exact = year ? typed.filter((r) => titles(r).some((t) => t === fullQ)) : [];
  if (exact.length > 0) year = null;
  else exact = typed.filter((r) => titles(r).some((t) => t === q));
  let hits = exact.length > 0 ? exact : q.length >= 4 ? typed.filter((r) => titles(r).some((t) => t.startsWith(`${q} `))) : [];
  if (hits.length === 0) return null;

  if (year) {
    const sameYear = hits.filter((r) => yearOf(r) === year);
    if (sameYear.length > 0) hits = sameYear;
  }
  if (preferType && opts.strictType) {
    const ofType = hits.filter((r) => r.media_type === preferType);
    if (ofType.length > 0) hits = ofType;
  }
  const votes = (r: TmdbSearchHit) => r.vote_count ?? 0;
  const sorted = [...hits].sort((a, b) => votes(b) - votes(a));
  const top = sorted[0];
  if (!preferType || top.media_type === preferType) return top;
  const bestPreferred = sorted.find((r) => r.media_type === preferType);
  if (bestPreferred && votes(bestPreferred) * 5 >= votes(top)) return bestPreferred;
  return top;
}

/* ======================================================================
 * 3. Liknande titlar — sammanslagning och rangordning (ren)
 * ==================================================================== */

export type TmdbListHit = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  genre_ids?: number[];
  vote_average?: number;
  vote_count?: number;
  adult?: boolean;
  media_type?: string;
};

/** Källista för en referens: recommendations och similar, i TMDB:s ordning. */
export type SimilarSource = { ref: ResolvedRef; recommendations: TmdbListHit[]; similar: TmdbListHit[] };

/** Bayes-utjämnad kvalitet (samma prior som recommendern: 6.5 / 250 röster). */
export function bayesRating(avg: number | null, votes: number | null): number {
  const v = Math.max(0, votes ?? 0);
  const a = avg ?? 6.5;
  return (v * a + 250 * 6.5) / (v + 250);
}

/**
 * Slå ihop recommendations/similar för alla referenser. Rankning: antal
 * referenser titeln rekommenderas för, sedan kvalitet (Bayes), sedan bästa
 * position i källistorna (recommendations före similar). Referenserna själva
 * och titlar med < 20 röster tas bort.
 */
export function rankSimilar(
  sources: readonly SimilarSource[],
  opts: { mediaType: RefMediaType | null; limit?: number; minVotes?: number },
): SimilarItem[] {
  const limit = opts.limit ?? 40;
  const minVotes = opts.minVotes ?? 20;
  const refKeys = new Set(sources.map((s) => `${s.ref.mediaType}:${s.ref.tmdbId}`));
  type Agg = SimilarItem & { bestPos: number };
  const byKey = new Map<string, Agg>();
  for (const { ref, recommendations, similar } of sources) {
    const type = ref.mediaType;
    if (opts.mediaType && type !== opts.mediaType) continue;
    // Varva: recommendations (beteendebaserat, oftast bäst) före similar.
    const lists: [TmdbListHit[], number][] = [
      [recommendations, 0],
      [similar, 0.5],
    ];
    for (const [list, bias] of lists) {
      list.forEach((r, i) => {
        if (!r || !Number.isFinite(r.id) || r.adult) return;
        const mt = r.media_type === "movie" || r.media_type === "tv" ? r.media_type : type;
        if (opts.mediaType && mt !== opts.mediaType) return;
        const key = `${mt}:${r.id}`;
        if (refKeys.has(key)) return;
        const votes = typeof r.vote_count === "number" ? r.vote_count : 0;
        if (votes < minVotes) return;
        const pos = i + bias;
        const cur = byKey.get(key);
        if (cur) {
          if (!cur.similarTo.includes(ref.title)) cur.similarTo.push(ref.title);
          cur.bestPos = Math.min(cur.bestPos, pos);
          return;
        }
        byKey.set(key, {
          tmdbId: r.id,
          mediaType: mt,
          title: r.title || r.name || r.original_title || r.original_name || "",
          voteAverage: typeof r.vote_average === "number" && votes > 0 ? r.vote_average : null,
          voteCount: votes,
          genreIds: Array.isArray(r.genre_ids) ? r.genre_ids : [],
          similarTo: [ref.title],
          bestPos: pos,
        });
      });
    }
  }
  return Array.from(byKey.values())
    .filter((a) => a.title)
    .map((a) => ({ a, q: bayesRating(a.voteAverage, a.voteCount) }))
    .sort(
      (x, y) =>
        y.a.similarTo.length - x.a.similarTo.length ||
        // Kvalitet först, men en mycket tidig position väger upp lite.
        y.q - 0.01 * y.a.bestPos - (x.q - 0.01 * x.a.bestPos) ||
        x.a.tmdbId - y.a.tmdbId,
    )
    .slice(0, limit)
    .map(({ a }) => ({
      tmdbId: a.tmdbId,
      mediaType: a.mediaType,
      title: a.title,
      voteAverage: a.voteAverage,
      voteCount: a.voteCount,
      genreIds: a.genreIds,
      similarTo: a.similarTo,
    }));
}

/* ======================================================================
 * TMDB (samma tokenkonvention som candidates.ts: V4-token, annars API-nyckel)
 * ==================================================================== */

const REVALIDATE_S = 6 * 60 * 60;
const MEMO_TTL_MS = 6 * 60 * 60 * 1000;
const MEMO_MAX = 400;
const memo = new Map<string, { at: number; p: Promise<unknown> }>();

/**
 * GET mot TMDB v3. Cachas två gånger: Next fetch-cache (revalidate 6 h) och
 * ett litet minnes-memo per instans som också slår ihop samtidiga anrop
 * (flera referenser i samma samtal → samma sökningar varje tur).
 */
async function tmdbGet<T>(path: string, params: Record<string, string | number | undefined>): Promise<T | null> {
  const v4 = process.env.TMDB_V4_TOKEN ?? process.env.TMDB_v4_TOKEN ?? process.env.TMDB_READ_TOKEN;
  const v3 = process.env.TMDB_API_KEY;
  if (!v4 && !v3) return null;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") usp.set(k, String(v));
  }
  const key = `${path}?${usp}`;
  const now = Date.now();
  const hit = memo.get(key);
  if (hit && now - hit.at < MEMO_TTL_MS) return hit.p as Promise<T | null>;

  if (!v4 && v3) usp.set("api_key", v3);
  const url = `https://api.themoviedb.org/3${path}${usp.toString() ? `?${usp}` : ""}`;
  const p = (async (): Promise<T | null> => {
    try {
      const res = await tmdbFetch(url, {
        headers: v4 ? { Authorization: `Bearer ${v4}` } : undefined,
        next: { revalidate: REVALIDATE_S },
      } as RequestInit);
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  })();
  if (memo.size >= MEMO_MAX) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  memo.set(key, { at: now, p });
  // Misslyckanden ska inte cachas — nästa tur får försöka igen.
  p.then((v) => {
    if (v === null) memo.delete(key);
  }).catch(() => memo.delete(key));
  return p;
}

/**
 * Slå upp referenserna (parallellt, ≤ 3). Söker på UI-språket och, om inget
 * duger, på en-US. Referensens egen typ ("serien X", "favoritfilmer: …") är
 * hård; `preferType` (vad användaren vill se nu) avgör bara vid tvetydighet.
 * Dubbletter (samma TMDB-id) slås ihop. Kastar aldrig.
 */
export async function resolveReferences(
  refs: RefQuery[],
  opts: { tmdbLocale: "sv-SE" | "en-US"; preferType: RefMediaType | null },
): Promise<ResolvedRef[]> {
  const list = refs.slice(0, MAX_REFS).filter((r) => r && typeof r.query === "string" && r.query.trim().length >= 2);
  if (list.length === 0) return [];
  type SearchRes = { results?: TmdbSearchHit[] };
  const search = (query: string, language: string) =>
    tmdbGet<SearchRes>("/search/multi", { query, language, include_adult: "false", page: 1 });

  const one = async (ref: RefQuery): Promise<ResolvedRef | null> => {
    try {
      const prefer = ref.mediaHint ?? opts.preferType;
      const strictType = !!ref.mediaHint;
      const { q } = splitQueryYear(ref.query);
      let hit = pickBestMatch((await search(q, opts.tmdbLocale))?.results ?? [], ref.query, prefer, { strictType });
      if (!hit && opts.tmdbLocale !== "en-US") {
        hit = pickBestMatch((await search(q, "en-US"))?.results ?? [], ref.query, prefer, { strictType });
      }
      if (!hit) return null;
      const mediaType = hit.media_type;
      const title = (mediaType === "movie" ? hit.title : hit.name) || hit.original_title || hit.original_name || ref.query;
      return {
        tmdbId: hit.id,
        mediaType,
        title,
        year: yearOfDate(mediaType === "movie" ? hit.release_date : hit.first_air_date),
        genreIds: Array.isArray(hit.genre_ids) ? hit.genre_ids : [],
        voteAverage: typeof hit.vote_average === "number" && (hit.vote_count ?? 0) > 0 ? hit.vote_average : null,
        voteCount: hit.vote_count ?? 0,
      };
    } catch {
      return null;
    }
  };

  const resolved = await Promise.all(list.map(one));
  const out: ResolvedRef[] = [];
  for (const r of resolved) {
    if (r && !out.some((o) => o.tmdbId === r.tmdbId && o.mediaType === r.mediaType)) out.push(r);
  }
  return out;
}

/**
 * /recommendations + /similar för varje referens (2 cachade anrop per
 * referens, alla parallellt, max 3 referenser = 6 anrop). Med `mediaType`
 * satt hoppas referenser av den andra typen över (TMDB:s listor håller sig
 * inom typen). Kastar aldrig; tom lista vid fel.
 */
export async function similarForReferences(
  refs: ResolvedRef[],
  opts: { tmdbLocale: "sv-SE" | "en-US"; mediaType: RefMediaType | null; limit?: number },
): Promise<SimilarItem[]> {
  const list = refs.slice(0, MAX_REFS).filter((r) => !opts.mediaType || r.mediaType === opts.mediaType);
  if (list.length === 0) return [];
  type ListRes = { results?: TmdbListHit[] };
  try {
    const sources = await Promise.all(
      list.map(async (ref): Promise<SimilarSource> => {
        const [recs, sim] = await Promise.all([
          tmdbGet<ListRes>(`/${ref.mediaType}/${ref.tmdbId}/recommendations`, { language: opts.tmdbLocale, page: 1 }),
          tmdbGet<ListRes>(`/${ref.mediaType}/${ref.tmdbId}/similar`, { language: opts.tmdbLocale, page: 1 }),
        ]);
        return { ref, recommendations: recs?.results ?? [], similar: sim?.results ?? [] };
      }),
    );
    return rankSimilar(sources, { mediaType: opts.mediaType, limit: opts.limit });
  } catch {
    return [];
  }
}
