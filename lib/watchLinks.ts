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

/* ---------------- Visning av providers ---------------- */
//
// Hyr-/köpalternativ är avstängda som standard och styrs av
// Profile.showPaidOptions (se lib/swipeSettingsStore.ts). Anledningen är dels
// att de tre sektionerna åt upp halva kortbaksidan, dels att "Kolla nu" annars
// kunde skicka användaren till en hyrsida för en titel de trodde ingick i
// deras abonnemang.

export type WatchProviderEntry = { provider_name: string; logo_path: string | null };

export type WatchProviders = {
  link?: string;
  flatrate?: WatchProviderEntry[];
  rent?: WatchProviderEntry[];
  buy?: WatchProviderEntry[];
};

export type ProviderGroup = { label: string; list: WatchProviderEntry[] };

/**
 * Sektionerna som ska renderas. Utan opt-in returneras enbart "Streama" —
 * hyr/köp utelämnas helt.
 */
export function providerGroupsFor(
  providers: WatchProviders | null | undefined,
  showPaidOptions: boolean
): ProviderGroup[] {
  if (!providers) return [];
  const out: ProviderGroup[] = [];
  if (providers.flatrate?.length) out.push({ label: "Streama", list: providers.flatrate });
  if (showPaidOptions) {
    if (providers.rent?.length) out.push({ label: "Hyr", list: providers.rent });
    if (providers.buy?.length) out.push({ label: "Köp", list: providers.buy });
  }
  return out;
}

/**
 * Titeln går bara att hyra/köpa och användaren har inte bett om de alternativen.
 * Ytorna visar då en diskret rad istället för en länk som leder till en betalsida.
 */
export function isPaidOnly(
  providers: WatchProviders | null | undefined,
  showPaidOptions: boolean
): boolean {
  if (!providers || showPaidOptions) return false;
  const hasFlatrate = Boolean(providers.flatrate?.length);
  const hasPaid = Boolean(providers.rent?.length || providers.buy?.length);
  return !hasFlatrate && hasPaid;
}

export const PAID_ONLY_LABEL = "Endast att hyra eller köpa";

/**
 * Bästa "Kolla nu"-länk för en titel. Utan opt-in vägs bara flatrate in, så
 * knappen aldrig leder till en hyr-/köpsida — då returneras undefined och
 * ytan döljer knappen.
 */
export function bestWatchUrl(
  providers: WatchProviders | null | undefined,
  title: string,
  showPaidOptions: boolean
): string | undefined {
  if (!providers) return undefined;

  const candidates: WatchProviderEntry[] = showPaidOptions
    ? [...(providers.flatrate ?? []), ...(providers.rent ?? []), ...(providers.buy ?? [])]
    : [...(providers.flatrate ?? [])];

  for (const p of candidates) {
    const url = providerWatchUrl(p.provider_name, title);
    if (url) return url;
  }

  // TMDB:s egen watch-sida listar även hyr/köp — bara rimlig som fallback när
  // användaren faktiskt bett om de alternativen.
  if (showPaidOptions) return providers.link;
  return candidates.length > 0 ? providers.link : undefined;
}
