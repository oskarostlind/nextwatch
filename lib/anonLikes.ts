// lib/anonLikes.ts
//
// Startsidan är spelbar innan man har konto, och gaten lovar att swipesen
// "följer med". Det här är löftet.
//
// Designbeslutet: likesen persisteras INTE på servern. Middleware stämplar visserligen
// nw_uid på anonyma besökare, så det vore tekniskt möjligt — men det skulle skapa
// anonyma rader i en Postgres som delas mellan dev och prod, för besökare som i
// de flesta fall aldrig registrerar sig. De ligger i localStorage tills kontot finns,
// och spelas upp först då. Löftet blir sant utan att skräpa ner.

export type AnonLike = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year: string;
  poster: string | null;
};

const KEY = "nw_anon_likes";
const MAX = 40; // Startsidans lek tar slut vid 10; taket är bara ett skydd mot skräp.

export function readAnonLikes(): AnonLike[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is AnonLike =>
        typeof x === "object" && x !== null && typeof (x as AnonLike).tmdbId === "number"
    );
  } catch {
    return [];
  }
}

export function addAnonLike(like: AnonLike): void {
  if (typeof window === "undefined") return;
  try {
    const cur = readAnonLikes().filter((x) => x.tmdbId !== like.tmdbId);
    const next = [...cur, like].slice(-MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* privat läge / full kvot — heron ska fungera ändå */
  }
}

export function clearAnonLikes(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Spelas upp direkt efter att kontot skapats, innan användaren skickas vidare.
 * Best-effort: en misslyckad titel får aldrig blockera onboardingen, och kön
 * töms oavsett — annars spelas den upp igen vid nästa registrering på samma enhet.
 *
 * @returns antal titlar som kvitterades av servern
 */
export async function replayAnonLikes(): Promise<number> {
  const likes = readAnonLikes();
  if (likes.length === 0) return 0;

  const results = await Promise.allSettled(
    likes.map(async (l) => {
      const rate = await fetch("/api/rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ tmdbId: l.tmdbId, mediaType: l.mediaType, decision: "like" }),
      });
      // Watchlist är det användaren faktiskt ser efter registrering — men en
      // träff där är värdelös om betyget inte gick in, så kräv båda.
      const watch = await fetch("/api/watchlist/like", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          tmdbId: l.tmdbId,
          mediaType: l.mediaType,
          title: l.title,
          year: l.year,
          poster: l.poster,
        }),
      });
      if (!rate.ok || !watch.ok) throw new Error(`replay failed for ${l.tmdbId}`);
      return true;
    })
  );

  clearAnonLikes();
  return results.filter((r) => r.status === "fulfilled").length;
}
