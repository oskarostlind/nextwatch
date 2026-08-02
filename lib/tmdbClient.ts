// lib/tmdbClient.ts
//
// EN grind för alla TMDB-anrop: concurrency-tak + retry på 429/5xx.
//
// Bakgrund (regression 2026-07-22): smoothness-rundan ersatte de sekventiella
// 10-batcharna i watchlistCards och ratings/list med `Promise.all` över HELA
// listan. Mätt mot TMDB gav 200 samtidiga anrop 61 st HTTP 429 — och varje
// anropsställe sväljer felet (`.catch(() => null)`), så titlar försvann tyst ur
// watchlist och betyg. Samma burst fick /discover i recs-pipelinen att kasta,
// vilket bubblade till computeUnifiedRecs yttre catch → tom kortlek och
// "Slut på förslag nu" (värst för filtret "Båda", som gör dubbelt så många
// discover-anrop som Film eller Serier var för sig).
//
// Samma mätning vid tak 8/12/16/24 gav NOLL 429. Parallellism är alltså inte
// problemet — obegränsad fan-out är det. Taket behåller hastighetsvinsten
// (pipelinen hålls full i stället för att stanna vid varje batchgräns) utan att
// spränga TMDB:s limiter.
//
// OBS: taket är per instans, precis som lib/rateLimit.ts. Det hindrar en enskild
// request från att skjuta 200 anrop på en gång; det är den delen som faktiskt
// small.

/** Samtidiga TMDB-anrop per instans. Mätt säkert upp till 24; 12 med marginal. */
const MAX_CONCURRENT = 12;
/** Antal omförsök efter första försöket. */
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 5000;

let active = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return;
  }
  // Ärver platsen av den som släpper — därför ingen ökning av `active` här.
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function release(): void {
  const next = waiting.shift();
  if (next) next();
  else active -= 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(res: Response, attempt: number): number {
  const header = res.headers.get("retry-after");
  const retryAfter = header ? Number(header) : NaN;
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_BACKOFF_MS);
  }
  const expo = BASE_BACKOFF_MS * 2 ** attempt;
  // Jitter så att parallella anrop inte återkommer i takt.
  return Math.min(expo + Math.random() * BASE_BACKOFF_MS, MAX_BACKOFF_MS);
}

/**
 * `fetch` mot TMDB genom concurrency-grinden, med omförsök på 429/5xx.
 *
 * Platsen hålls under backoffen med flit: när TMDB säger ifrån ska HELA
 * instansen sakta ner, inte bara den enskilda anroparen.
 *
 * Returnerar sista svaret även om det fortfarande är 429/5xx — anroparen
 * behåller sin egen felhantering.
 */
export async function tmdbFetch(url: string, init?: RequestInit): Promise<Response> {
  await acquire();
  try {
    for (let attempt = 0; ; attempt += 1) {
      const res = await fetch(url, init);
      if (res.status !== 429 && res.status < 500) return res;
      if (attempt >= MAX_RETRIES) return res;
      // Kroppen läses aldrig vid omförsök — stäng den så undici inte håller
      // kvar socketen.
      await res.body?.cancel().catch(() => {});
      await sleep(backoffMs(res, attempt));
    }
  } finally {
    release();
  }
}
