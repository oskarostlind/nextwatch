// lib/subgenres.ts
//
// Curerad, minimal andra lagret av genrer ("sub-genrer") ovanpå TMDB:s breda
// genrer — t.ex. Skräck → Slasher/Zombie. Drivs av TMDB KEYWORDS (id:erna är
// verifierade via TMDB:s /search/keyword, inte gissade). Nyckeln i SUBGENRES
// är den svenska genre-etiketten, samma sträng som redan används av
// GROUP_GENRES (lib/groupSettings.ts) och av MOVIE_GENRES i
// app/components/discover/MediaFilters.tsx — så samma config funkar oavsett
// om anroparen har genre-id (Discover/Watchlist) eller genre-namn
// (Gruppinställningar), se lib/subgenreLookup.ts.
//
// Täcker alla breda genrer i GROUP_GENRES (lib/groupSettings.ts) samt de
// TV-specifika sammanslagna etiketterna i TV_GENRES (t.ex. "Action & Äventyr",
// "Sci-Fi & Fantasy") som Discover-fliken för Serier använder istället för de
// enskilda genrerna — dessa har egna nycklar här (kortare, sammanslagna
// listor) så att sub-genre-unfoldet funkar där också. En genre utan post här
// (eller med tom lista) visar helt enkelt inget unfold i GenrePicker — det är
// ett giltigt läge, inte en bugg (t.ex. Familj saknar en meningsfull
// keyword-uppdelning).

export type SubGenre = {
  /** Svensk visningstext på chippen. */
  label: string;
  /** TMDB keyword-id(n). Flera id:n = OR (samma sub-genre kan spänna över
   *  flera näraliggande keywords, t.ex. "space" + "outer space"). */
  keywordIds: number[];
};

export const SUBGENRES: Record<string, SubGenre[]> = {
  Action: [
    { label: "Spionage", keywordIds: [470, 5265] },
    { label: "Heist", keywordIds: [10051] },
    { label: "Kampsport", keywordIds: [779] },
    { label: "Krig", keywordIds: [273967] },
    { label: "Bil & jakt", keywordIds: [3713, 9844] },
    { label: "Superhjälte", keywordIds: [9715, 9717] },
    { label: "Actionkomedi", keywordIds: [247799] },
    { label: "Katastrof", keywordIds: [10617, 5096] },
  ],
  Skräck: [
    { label: "Slasher", keywordIds: [12339] },
    { label: "Övernaturligt", keywordIds: [6152, 256183] },
    { label: "Zombie", keywordIds: [12377, 186565] },
    { label: "Psykologisk skräck", keywordIds: [295907] },
    { label: "Found footage", keywordIds: [163053] },
    { label: "Monster", keywordIds: [1299] },
    { label: "Ockult & demoner", keywordIds: [156174, 178647, 15001] },
    { label: "Kroppsskräck", keywordIds: [283085] },
    { label: "Hemsökt hus", keywordIds: [3358] },
    { label: "Vampyr", keywordIds: [3133] },
  ],
  "Sci-Fi": [
    { label: "Dystopi", keywordIds: [4565] },
    { label: "Rymden", keywordIds: [9882, 252634] },
    { label: "Tidsresor", keywordIds: [4379] },
    { label: "Cyberpunk", keywordIds: [12190] },
    { label: "Aliens", keywordIds: [9951, 9739] },
    { label: "Post-apokalyps", keywordIds: [359337, 4458] },
    { label: "AI & robotar", keywordIds: [310, 14544] },
  ],
  Fantasy: [
    { label: "Episkt", keywordIds: [211227, 234213] },
    { label: "Sagor", keywordIds: [3205] },
    { label: "Övernaturligt", keywordIds: [6152, 256183] },
    { label: "Svärd & magi", keywordIds: [234213, 2343] },
    { label: "Urban fantasy", keywordIds: [298549] },
  ],
  Drama: [
    { label: "Coming of age", keywordIds: [10683] },
    { label: "Rättegång", keywordIds: [11038, 33519] },
    { label: "Biografiskt", keywordIds: [5565, 9672] },
    { label: "Familj", keywordIds: [12279] },
    { label: "Sport", keywordIds: [333328] },
    { label: "Krigsdrama", keywordIds: [273967] },
    { label: "Medicinskt", keywordIds: [258786, 11612] },
  ],
  Komedi: [
    { label: "Romcom", keywordIds: [9799] },
    { label: "Parodi", keywordIds: [9755, 11931] },
    { label: "Mörk komedi", keywordIds: [10123, 373401] },
    { label: "Buddy", keywordIds: [167541] },
    { label: "Tonårskomedi", keywordIds: [155722] },
  ],
  Thriller: [
    { label: "Psykologisk", keywordIds: [12565] },
    { label: "Spionage", keywordIds: [470, 5265] },
    { label: "Crime thriller", keywordIds: [355372] },
    { label: "Techno-thriller", keywordIds: [298605] },
    { label: "Konspirationer", keywordIds: [10410, 11208] },
  ],
  Kriminal: [
    { label: "Maffia", keywordIds: [10391] },
    { label: "Heist", keywordIds: [10051] },
    { label: "Detektiv", keywordIds: [703] },
    { label: "Seriemördare", keywordIds: [10714] },
    { label: "Film noir", keywordIds: [9807] },
  ],
  Romantik: [
    { label: "Romcom", keywordIds: [9799] },
    { label: "Ungdomsromantik", keywordIds: [368947] },
    { label: "Historisk romantik", keywordIds: [361772, 248451] },
    { label: "Dramatisk romantik", keywordIds: [186956, 304976] },
  ],
  Äventyr: [
    { label: "Skattjakt", keywordIds: [6956] },
    { label: "Överlevnad", keywordIds: [10349] },
    { label: "Sjöröveri", keywordIds: [12988] },
    { label: "Expedition", keywordIds: [1963] },
  ],
  Mysterium: [
    { label: "Whodunit", keywordIds: [12570, 364800] },
    { label: "Detektiv", keywordIds: [703] },
    { label: "Övernaturligt mysterium", keywordIds: [6152, 256183] },
  ],
  Animerat: [
    { label: "Anime", keywordIds: [210024] },
    { label: "Stop-motion", keywordIds: [10121] },
  ],
  Dokumentär: [
    { label: "True crime", keywordIds: [33722] },
    { label: "Natur", keywordIds: [221355] },
    { label: "Musik-dok", keywordIds: [246377] },
    { label: "Sport-dok", keywordIds: [159290] },
  ],
  Western: [{ label: "Neo-western", keywordIds: [168713] }],
  Musik: [
    { label: "Musikal", keywordIds: [4344] },
    { label: "Konsertfilm", keywordIds: [156205] },
  ],
  Krig: [
    { label: "Första världskriget", keywordIds: [2504, 11007] },
    { label: "Andra världskriget", keywordIds: [1956, 160224] },
    { label: "Vietnamkriget", keywordIds: [2957] },
    { label: "Kalla kriget", keywordIds: [2106] },
  ],
  Historia: [
    { label: "Antiken", keywordIds: [5049] },
    { label: "Medeltiden", keywordIds: [355987, 41406] },
    { label: "Hovdrama", keywordIds: [154794] },
  ],

  // TV-fliken i Discover slår ihop vissa genrer (se TV_GENRES i
  // app/components/discover/MediaFilters.tsx) — egna, kortare nycklar här så
  // GenrePicker-unfoldet funkar med de sammanslagna etiketterna också.
  "Action & Äventyr": [
    { label: "Spionage", keywordIds: [470, 5265] },
    { label: "Heist", keywordIds: [10051] },
    { label: "Kampsport", keywordIds: [779] },
    { label: "Bil & jakt", keywordIds: [3713, 9844] },
    { label: "Superhjälte", keywordIds: [9715, 9717] },
    { label: "Skattjakt", keywordIds: [6956] },
    { label: "Sjöröveri", keywordIds: [12988] },
    { label: "Överlevnad", keywordIds: [10349] },
  ],
  "Sci-Fi & Fantasy": [
    { label: "Dystopi", keywordIds: [4565] },
    { label: "Rymden", keywordIds: [9882, 252634] },
    { label: "Tidsresor", keywordIds: [4379] },
    { label: "Cyberpunk", keywordIds: [12190] },
    { label: "Episkt", keywordIds: [211227, 234213] },
    { label: "Sagor", keywordIds: [3205] },
    { label: "Aliens", keywordIds: [9951, 9739] },
    { label: "Post-apokalyps", keywordIds: [359337, 4458] },
    { label: "Svärd & magi", keywordIds: [234213, 2343] },
  ],
  Mystik: [
    { label: "Whodunit", keywordIds: [12570, 364800] },
    { label: "Detektiv", keywordIds: [703] },
    { label: "Övernaturligt mysterium", keywordIds: [6152, 256183] },
  ],
  "Krig & Politik": [
    { label: "Första världskriget", keywordIds: [2504, 11007] },
    { label: "Andra världskriget", keywordIds: [1956, 160224] },
    { label: "Vietnamkriget", keywordIds: [2957] },
    { label: "Kalla kriget", keywordIds: [2106] },
    { label: "Konspirationer", keywordIds: [10410, 11208] },
    { label: "Rättegång", keywordIds: [11038, 33519] },
  ],
};

/** Alla sub-genre-etiketter för en given bred genre, eller tom lista. */
export function subgenresFor(genreLabel: string): SubGenre[] {
  return SUBGENRES[genreLabel] ?? [];
}

/**
 * Plockar ut keyword-id:n ur TMDB:s `append_to_response=keywords`-fält.
 * Filmer nästlar dem under `keywords`, serier under `results` — samma
 * inkonsekvens som lib/tasteModel.ts (extractKeywords) redan hanterar för
 * smakmodellen. Delad här så watchlist-/betygskorten (lib/watchlistCards.ts,
 * app/api/ratings/list) kan avgöra vilka sub-genre-keywords en titel bär utan
 * ett separat TMDB-anrop per titel.
 */
export function extractKeywordIds(kw: unknown): number[] {
  if (!kw || typeof kw !== "object") return [];
  const obj = kw as { keywords?: unknown; results?: unknown };
  const arr = Array.isArray(obj.keywords) ? obj.keywords : Array.isArray(obj.results) ? obj.results : [];
  return arr.filter((x): x is { id: number } => Boolean(x) && typeof x.id === "number").map((x) => x.id);
}

/**
 * Togglar en hel sub-genre-grupp (kan vara flera keyword-id:n) som en enhet:
 * står alla redan i `current` tas alla bort, annars läggs alla till. Delas av
 * GenrePicker (chip-klick) och dess automatiska städning när en bred genre
 * avmarkeras (se GenrePicker.tsx) — samma kontrakt i båda fallen.
 */
export function toggleKeywordGroup(current: number[], group: number[]): number[] {
  const has = group.every((id) => current.includes(id));
  if (has) return current.filter((id) => !group.includes(id));
  return Array.from(new Set([...current, ...group]));
}
