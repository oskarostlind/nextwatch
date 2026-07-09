export const ALL_GENRES_SV = [
  "Action",
  "Äventyr",
  "Animerat",
  "Komedi",
  "Kriminal",
  "Dokumentär",
  "Drama",
  "Fantasy",
  "Skräck",
  "Romantik",
  "Sci-Fi",
  "Thriller",
  "Mysterium",
  "Familj",
  "Historia",
  "Musik",
  "Krig",
  "Western",
] as const;

export const ENG_TO_SV: Record<string, string> = {
  Action: "Action",
  Adventure: "Äventyr",
  Animation: "Animerat",
  Comedy: "Komedi",
  Crime: "Kriminal",
  Documentary: "Dokumentär",
  Drama: "Drama",
  Fantasy: "Fantasy",
  Horror: "Skräck",
  Romance: "Romantik",
  "Science Fiction": "Sci-Fi",
  Thriller: "Thriller",
  Mystery: "Mysterium",
  Family: "Familj",
  History: "Historia",
  Music: "Musik",
  War: "Krig",
  Western: "Western",
  "TV Movie": "TV-film",
};

export function toSvGenres(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const raw of arr) {
    if (typeof raw !== "string") continue;
    const v = ENG_TO_SV[raw] ?? raw;
    if (ALL_GENRES_SV.includes(v as (typeof ALL_GENRES_SV)[number])) out.push(v);
  }
  return Array.from(new Set(out));
}
