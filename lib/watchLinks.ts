// Direktlänkar till streamingtjänsternas sök för en titel.
// TMDB:s watch-providers-API ger bara en länk till TMDB:s egen watch-sida,
// så vi bygger tjänste-specifika sök-URL:er själva. På mobil öppnas dessa
// som universal links direkt i respektive app (Netflix, Prime, Disney+ m.fl.).
// URL-mönstren är verifierade mot live-tjänsterna (2026-07).

type LinkBuilder = (title: string) => string;

const q = (title: string) => encodeURIComponent(title.trim());

/** Nyckelord (matchas mot lowercased provider_name) → sök-URL. Ordningen spelar roll. */
const PROVIDER_PATTERNS: Array<[keyword: string, build: LinkBuilder]> = [
  ["netflix", (t) => `https://www.netflix.com/search?q=${q(t)}`],
  ["disney", (t) => `https://www.disneyplus.com/browse/search?q=${q(t)}`],
  ["hbo", (t) => `https://play.hbomax.com/search/result?q=${q(t)}`],
  ["max amazon", (t) => `https://play.hbomax.com/search/result?q=${q(t)}`],
  ["prime video", (t) => `https://www.primevideo.com/search?phrase=${q(t)}`],
  ["amazon video", (t) => `https://www.primevideo.com/search?phrase=${q(t)}`],
  ["amazon prime", (t) => `https://www.primevideo.com/search?phrase=${q(t)}`],
  ["viaplay", (t) => `https://viaplay.se/search?query=${q(t)}`],
  ["apple tv", (t) => `https://tv.apple.com/se/search?term=${q(t)}`],
  ["svt", (t) => `https://www.svtplay.se/sok?q=${q(t)}`],
  ["tv4", (t) => `https://www.tv4play.se/sok?q=${q(t)}`],
  ["sf anytime", (t) => `https://www.sfanytime.com/sv/search?q=${q(t)}`],
  ["discovery", (t) => `https://www.discoveryplus.com/se/search?q=${q(t)}`],
  ["google play", (t) => `https://play.google.com/store/search?q=${q(t)}&c=movies`],
];

/**
 * Sök-URL hos en streamingtjänst för en given titel, eller null om vi inte
 * känner till tjänsten (t.ex. SkyShowtime som saknar publik sök-URL).
 */
export function providerWatchUrl(providerName: string, title: string): string | null {
  const name = providerName.toLowerCase();
  if (!title.trim()) return null;
  for (const [keyword, build] of PROVIDER_PATTERNS) {
    if (name.includes(keyword)) return build(title);
  }
  return null;
}

/**
 * Bästa "Kolla nu"-länk för en titel: första streamingtjänst (flatrate först,
 * sedan hyr/köp) som vi kan direktlänka till. Faller tillbaka på fallbackUrl
 * (TMDB:s watch-sida) om ingen tjänst är känd.
 */
export function bestWatchUrl(
  providerNames: string[],
  title: string,
  fallbackUrl?: string
): string | undefined {
  for (const name of providerNames) {
    const url = providerWatchUrl(name, title);
    if (url) return url;
  }
  return fallbackUrl;
}
