// lib/ads.ts
//
// Annonslogik för swipe-däcket. Gratisanvändare får ett annonskort ungefär
// vart 10:e kort; premium ser aldrig annonser.
//
// Plattform:
//   - Webb  -> Google AdSense (renderas i AdCard)
//   - iOS   -> Google AdMob (native, via Capacitor-plugin – kopplas i Fas 2)
//
// Allt sitter bakom feature-flaggan NEXT_PUBLIC_ADS_ENABLED så att inget visas
// förrän AdSense/AdMob-konton är godkända och konfigurerade.

import type { SwipeCard } from "@/lib/swipeDeck";

/** Vart N:te kort blir en annons (räknat på riktiga titlar). */
export const AD_EVERY = 10;

/** Global feature-flagga. Sätt NEXT_PUBLIC_ADS_ENABLED=1 för att aktivera. */
export function adsFeatureEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ADS_ENABLED === "1";
}

/** AdSense-klient-id (ca-pub-...), sätts när kontot är godkänt. */
export function adsenseClientId(): string | null {
  return process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? null;
}

/** AdSense-slot-id för swipe-annonsen. */
export function adsenseSlotId(): string | null {
  return process.env.NEXT_PUBLIC_ADSENSE_SLOT_SWIPE ?? null;
}

/** Skapar ett annons-"kort" som passar in i SwipeCard-flödet. */
export function makeAdCard(key: string): SwipeCard {
  return {
    id: `ad_${key}`,
    kind: "ad",
    tmdbId: -1,
    mediaType: "movie",
    title: "",
    year: null,
    poster: null,
    overview: null,
    rating: null,
  };
}

export function isAdCard(card: Pick<SwipeCard, "kind">): boolean {
  return card.kind === "ad";
}

/**
 * Injicerar annonskort i en sida med titlar. Anropas per hämtad sida så att
 * positionerna blir stabila (befintliga kort får aldrig nya index).
 *
 * @param titles  mappade titelkort för den här sidan
 * @param pageKey unik nyckel per sida (t.ex. sidnummer) för stabila ad-id:n
 */
export function injectAdCards(titles: SwipeCard[], pageKey: string | number): SwipeCard[] {
  if (titles.length === 0) return titles;
  const out: SwipeCard[] = [];
  for (let i = 0; i < titles.length; i++) {
    out.push(titles[i]);
    // Efter var AD_EVERY:e titel, lägg in en annons (men inte allra sist).
    if ((i + 1) % AD_EVERY === 0 && i + 1 < titles.length) {
      out.push(makeAdCard(`${pageKey}_${i + 1}`));
    }
  }
  return out;
}
