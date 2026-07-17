// lib/deckVisuals.ts
//
// Delat visuellt språk för kortlekarna (startsidan och /swipe).
//
// Två saker bor här, och båda är medvetet dumma funktioner utan state:
//   1. pose()  — EN transformfunktion med en spridningsparameter. Mobil och
//      desktop är inte två layouter; de är samma funktion med olika `spread`.
//   2. accentFor() — färgkällan.
//
// Om accentFor: startsidan har en kurerad lista med hårdkodade färger, men
// /swipe får sina kort från computeUnifiedRecs och kan omöjligt ha det. TMDB
// ger ingen dominant färg och projektet har ingen bildbehandlingsdependency,
// så genren får bära färgen. Det är inte godtyckligt — det speglar något
// verkligt om titeln, och det kostar noll ny infrastruktur.

export type Pose = {
  x: number;
  y: number;
  z: number;
  rotateY: number;
  rotateZ: number;
  scale: number;
};

/**
 * @param depth 0 = toppkortet, 1,2,3… bakåt i leken
 * @param spread 0 = hög på ett bord, 1 = utfälld solfjäder
 * @param jitter grader — en lek ligger aldrig perfekt rak, och slarvet säljer fysiken
 */
export function pose(depth: number, spread: number, jitter: number): Pose {
  return {
    x: depth * 148 * spread,
    y: depth * 6 * (1 - spread),
    z: -depth * (70 * spread + 14 * (1 - spread)),
    rotateY: -depth * 15 * spread,
    // Jittern rätas ut när leken fälls ut — en utspridd hand hålls medvetet,
    // en hög på ett bord gör det inte.
    rotateZ: jitter * (1 - spread) - depth * 5 * spread,
    scale: 1 - depth * (0.055 * spread + 0.014 * (1 - spread)),
  };
}

/** Viewportbredd → spridning. Kontinuerlig, aldrig ett breakpoint-hopp. */
export function spreadForWidth(w: number): number {
  return Math.min(Math.max((w - 640) / 440, 0), 1);
}

const JITTER = [0, -1.1, 0.8, -0.6, 1.2, -0.9, 0.5, -1.3, 1.0, -0.4, 0.9, -0.7];

export function jitterFor(index: number): number {
  return JITTER[((index % JITTER.length) + JITTER.length) % JITTER.length] ?? 0;
}

/* ------------------------------------------------------------------ */

/** Neutral varm ton när genren är okänd — aldrig cyan, den är UI-färg. */
export const ACCENT_FALLBACK = "#9A8F80";

// Både svenska och engelska nycklar: /api/tmdb/details anropas med sv-SE men
// faller tillbaka på en-US när svensk overview saknas (se page_client.tsx),
// så genrerna kan komma på båda språken.
const GENRE_ACCENT: Record<string, string> = {
  "science fiction": "#5B8FBF",
  "sci-fi": "#5B8FBF",
  skräck: "#B3352F",
  horror: "#B3352F",
  komedi: "#E0A32E",
  comedy: "#E0A32E",
  romantik: "#D9639B",
  romance: "#D9639B",
  thriller: "#7A5BBF",
  mysterium: "#7A5BBF",
  mystery: "#7A5BBF",
  action: "#D9612A",
  äventyr: "#D98A3A",
  adventure: "#D98A3A",
  fantasy: "#8E5BBF",
  animerat: "#3FA38C",
  animation: "#3FA38C",
  dokumentär: "#6B8E7A",
  documentary: "#6B8E7A",
  drama: "#B5765A",
  familj: "#4FA35B",
  family: "#4FA35B",
  krig: "#6E7A5B",
  war: "#6E7A5B",
  historia: "#A88B4F",
  history: "#A88B4F",
  western: "#B07A3C",
  kriminal: "#8A5B4F",
  crime: "#8A5B4F",
  musik: "#C4577F",
  music: "#C4577F",
};

/** Första genren med en mappning vinner. Ordningen från TMDB är signifikant. */
export function accentFor(genres: readonly string[] | undefined | null): string {
  if (!genres) return ACCENT_FALLBACK;
  for (const g of genres) {
    const hit = GENRE_ACCENT[g.trim().toLowerCase()];
    if (hit) return hit;
  }
  return ACCENT_FALLBACK;
}
