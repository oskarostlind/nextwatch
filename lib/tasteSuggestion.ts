// lib/tasteSuggestion.ts — härleder förslaget för "Fyll i från mina
// betyg"-knappen i Profil → Smak: vilka BREDA genrer och kurerade
// SUB-genre-nyckelord (lib/subgenres.ts) användarens betygshistorik pekar
// mot. Bygger på samma seeds/vikter som V2-rekommendationerna
// (lib/tasteModel.ts buildSeeds/buildTasteMaps) — INTE de
// visningsanpassade topp-5/8-listorna i lib/tasteProfile.ts, som är för
// snäva (bara namngivna toppträffar totalt sett) för att pålitligt träffa
// de kurerade sub-genre-keyword-id:na.

import { buildSeeds, buildTasteMaps, loadTasteInput } from "@/lib/tasteModel";
import { SUBGENRES } from "@/lib/subgenres";

/**
 * TMDB movie-genre-id → svensk etikett. Samma 18 som GROUP_GENRES
 * (lib/groupSettings.ts) — id:na är stabila oavsett locale, bara namnen
 * översätts, så det här är en säkrare nyckel än att gå via TMDB-namnet.
 */
const GENRE_ID_TO_SV: Record<number, string> = {
  28: "Action",
  12: "Äventyr",
  16: "Animerat",
  35: "Komedi",
  80: "Kriminal",
  99: "Dokumentär",
  18: "Drama",
  10751: "Familj",
  14: "Fantasy",
  36: "Historia",
  27: "Skräck",
  10402: "Musik",
  9648: "Mysterium",
  10749: "Romantik",
  878: "Sci-Fi",
  53: "Thriller",
  10752: "Krig",
  37: "Western",
};

/** Under detta antal betyg/reaktioner är signalen för svag för att föreslå något. */
const MIN_RATINGS_FOR_SUGGESTION = 5;
const MAX_GENRES = 5;
const MAX_KEYWORD_GROUPS = 8;
/** Tröskel på den normaliserade [-1,1]-vikten (topp = 1) — "tydligt föredraget", inte marginellt. */
const MIN_GENRE_WEIGHT = 0.3;
const MIN_KEYWORD_WEIGHT = 0.3;

/**
 * Unika sub-genre-grupper över ALLA breda genrer i SUBGENRES. Samma grupp
 * (t.ex. "Spionage") återkommer under flera breda genrer (Action, Thriller)
 * med identiska keyword-id:n — dedupas här via en sorterad nyckel så den
 * inte räknas två gånger.
 */
const SUBGENRE_GROUPS: number[][] = (() => {
  const seen = new Map<string, number[]>();
  for (const subs of Object.values(SUBGENRES)) {
    for (const sub of subs) {
      const key = [...sub.keywordIds].sort((a, b) => a - b).join(",");
      if (!seen.has(key)) seen.set(key, sub.keywordIds);
    }
  }
  return Array.from(seen.values());
})();

export type TasteSuggestionResult =
  | {
      ok: true;
      lowConfidence: boolean;
      ratingsCount: number;
      genres: string[];
      keywordIds: number[];
    }
  | { ok: false; message: string; status: number };

export async function computeTasteSuggestion(uid: string): Promise<TasteSuggestionResult> {
  const input = await loadTasteInput(uid, null);
  if (!input) return { ok: false, message: "Ingen profil hittades.", status: 200 };

  const ratingsCount = input.ratings.length;
  if (ratingsCount < MIN_RATINGS_FOR_SUGGESTION) {
    return { ok: true, lowConfidence: true, ratingsCount, genres: [], keywordIds: [] };
  }

  const seeds = buildSeeds(input);
  if (seeds.length === 0) {
    return { ok: true, lowConfidence: true, ratingsCount, genres: [], keywordIds: [] };
  }

  const { genreW, keywordW } = await buildTasteMaps(seeds, input.locale);

  const genres = Array.from(genreW.entries())
    .filter(([, w]) => w >= MIN_GENRE_WEIGHT)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => GENRE_ID_TO_SV[id])
    .filter((label): label is string => Boolean(label))
    .slice(0, MAX_GENRES);

  const scoredGroups = SUBGENRE_GROUPS.map((ids) => {
    const weights = ids
      .map((id) => keywordW.get(id))
      .filter((w): w is number => w !== undefined);
    if (weights.length === 0) return null;
    return { ids, score: Math.max(...weights) };
  })
    .filter((g): g is { ids: number[]; score: number } => g !== null && g.score >= MIN_KEYWORD_WEIGHT)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_KEYWORD_GROUPS);

  const keywordIds = Array.from(new Set(scoredGroups.flatMap((g) => g.ids)));

  return { ok: true, lowConfidence: false, ratingsCount, genres, keywordIds };
}
