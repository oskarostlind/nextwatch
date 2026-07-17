// app/hero-lab/curated.ts
//
// Kurerad hero-lista. Prototyp — se app/hero-lab/page.tsx.
//
// Designbeslutet bakom den här filen: TMDB ger ingen dominant färg, och projektet
// har ingen bildbehandlingsdependency (sharp saknas). Att extrahera på klienten
// kräver CORS-krångel genom next/image. Alltså hårdkodas accenten per titel — vilket
// dessutom ger art direction gratis, för ett slumpat trending-flöde blandar magnifika
// posters med fula.
//
// tmdbId hårdkodas men poster_path hämtas i runtime: filnamnen hos TMDB kan rotera,
// och en hårdkodad path som 404:ar ger ett trasigt hero.

export type CuratedTitle = {
  tmdbId: number;
  /** Förväntad titel — används bara för att upptäcka fel id vid utveckling. */
  expect: string;
  /** Hårdkodad accentfärg. Bär glöden bakom leken och tonen i gate-knappen. */
  accent: string;
};

export const CURATED: CuratedTitle[] = [
  { tmdbId: 693134, expect: "Dune: Part Two", accent: "#D98A3A" },
  { tmdbId: 346698, expect: "Barbie", accent: "#F0439B" },
  { tmdbId: 603, expect: "The Matrix", accent: "#3FA34D" },
  { tmdbId: 157336, expect: "Interstellar", accent: "#6BA3C4" },
  { tmdbId: 313369, expect: "La La Land", accent: "#5B5FBF" },
  { tmdbId: 329865, expect: "Arrival", accent: "#4E8C8A" },
  { tmdbId: 335984, expect: "Blade Runner 2049", accent: "#E0632A" },
  { tmdbId: 872585, expect: "Oppenheimer", accent: "#C4472B" },
  { tmdbId: 545611, expect: "Everything Everywhere All at Once", accent: "#E4B429" },
  { tmdbId: 324857, expect: "Spider-Man: Into the Spider-Verse", accent: "#E5266E" },
  { tmdbId: 244786, expect: "Whiplash", accent: "#B8862B" },
  { tmdbId: 120467, expect: "The Grand Budapest Hotel", accent: "#D9739E" },
];

export type HeroCard = {
  id: number;
  title: string;
  year: string;
  poster: string | null;
  accent: string;
  /** Stabil per titel — en kortlek ligger aldrig perfekt rak, och slarvet säljer fysiken. */
  jitter: number;
};
