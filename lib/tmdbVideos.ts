// Trailerval ur TMDB:s /videos.
//
// TMDB hostar inga videofiler — bara referenser till YouTube m.fl. Därför spelar
// vi trailern i en YouTube-iframe (app/components/watch/TrailerModal.tsx) i
// stället för en egen mediaspelare.
//
// Svenska trailers saknas för de flesta titlar, så anropen begär sv + en
// tillsammans (include_video_language) och vi faller tillbaka på engelska.

export type TmdbVideo = {
  key?: string;
  site?: string;
  type?: string;
  name?: string;
  official?: boolean;
  iso_639_1?: string;
  published_at?: string;
};

export type Trailer = {
  /** YouTube-video-id. */
  key: string;
  name: string;
  /** "sv" | "en" | annat — visas inte, men användbart vid felsökning. */
  language: string;
};

/** Efterfrågas i append_to_response så en titel bara kostar ett TMDB-anrop. */
export const VIDEO_APPEND_PARAMS = "videos";
export const VIDEO_LANGUAGE_PARAM = "sv,en,null";

function scoreVideo(v: TmdbVideo): number {
  let s = 0;
  // Riktig trailer slår teaser; allt annat (clips, featurettes) är ointressant.
  if (v.type === "Trailer") s += 100;
  else if (v.type === "Teaser") s += 50;
  if (v.official) s += 20;
  if (v.iso_639_1 === "sv") s += 10;
  else if (v.iso_639_1 === "en") s += 5;
  return s;
}

/**
 * Bästa spelbara trailern, eller null när titeln saknar en. Null är vanligt —
 * knappen ska då inte visas alls.
 */
export function pickTrailer(videos: TmdbVideo[] | undefined | null): Trailer | null {
  if (!Array.isArray(videos) || videos.length === 0) return null;

  const playable = videos.filter(
    (v) => v.site === "YouTube" && typeof v.key === "string" && v.key.length > 0
  );
  const candidates = playable.filter((v) => v.type === "Trailer" || v.type === "Teaser");
  if (candidates.length === 0) return null;

  const best = candidates.reduce((a, b) => (scoreVideo(b) > scoreVideo(a) ? b : a));
  return {
    key: best.key as string,
    name: best.name ?? "Trailer",
    language: best.iso_639_1 ?? "en",
  };
}

/**
 * Inbäddnings-URL. playsinline=1 är nödvändigt i Capacitors WebView — utan den
 * kapar iOS uppspelningen och tar över med sin egen helskärmsspelare.
 * nocookie-domänen undviker att YouTube sätter spårningscookies före uppspelning.
 */
export function youtubeEmbedUrl(key: string): string {
  const params = new URLSearchParams({
    autoplay: "1",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
  });
  return `https://www.youtube-nocookie.com/embed/${key}?${params.toString()}`;
}
