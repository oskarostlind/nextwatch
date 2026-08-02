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
// Hålls medvetet kort: 4-6 sub-genrer per genre, och bara för genrer där en
// bra uppdelning finns. En genre utan post här (eller med tom lista) visar
// helt enkelt inget unfold i GenrePicker — det är ett giltigt läge, inte en
// bugg.

export type SubGenre = {
  /** Svensk visningstext på chippen. */
  label: string;
  /** TMDB keyword-id(n). Flera id:n = OR (samma sub-genre kan spänna över
   *  flera näraliggande keywords, t.ex. "space" + "outer space"). */
  keywordIds: number[];
};

export const SUBGENRES: Record<string, SubGenre[]> = {
  Skräck: [
    { label: "Slasher", keywordIds: [12339] },
    { label: "Övernaturligt", keywordIds: [6152, 256183] },
    { label: "Zombie", keywordIds: [12377, 186565] },
    { label: "Psykologisk skräck", keywordIds: [295907] },
    { label: "Found footage", keywordIds: [163053] },
  ],
  Action: [
    { label: "Spionage", keywordIds: [470, 5265] },
    { label: "Heist", keywordIds: [10051] },
    { label: "Kampsport", keywordIds: [779] },
    { label: "Krig", keywordIds: [273967] },
    { label: "Bil & jakt", keywordIds: [3713, 9844] },
  ],
  Drama: [
    { label: "Coming of age", keywordIds: [10683] },
    { label: "Rättegång", keywordIds: [11038, 33519] },
    { label: "Biografiskt", keywordIds: [5565, 9672] },
    { label: "Familj", keywordIds: [12279] },
  ],
  "Sci-Fi": [
    { label: "Dystopi", keywordIds: [4565] },
    { label: "Rymden", keywordIds: [9882, 252634] },
    { label: "Tidsresor", keywordIds: [4379] },
    { label: "Cyberpunk", keywordIds: [12190] },
  ],
  Fantasy: [
    { label: "Episkt", keywordIds: [211227, 234213] },
    { label: "Sagor", keywordIds: [3205] },
    { label: "Övernaturligt", keywordIds: [6152, 256183] },
  ],
  Romantik: [
    { label: "Romcom", keywordIds: [9799] },
    { label: "Ungdomsromantik", keywordIds: [368947] },
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
