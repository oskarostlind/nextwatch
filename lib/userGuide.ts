export type GuideId = "swipe" | "nav" | "group";

const KEYS: Record<GuideId, string> = {
  swipe: "nw_guide_swipe_v1",
  nav: "nw_guide_nav_v1",
  group: "nw_guide_group_v1",
};

export function hasSeenGuide(id: GuideId): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(KEYS[id]) === "1";
  } catch {
    return true;
  }
}

export function markGuideSeen(id: GuideId): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEYS[id], "1");
  } catch {
    /* no-op */
  }
}

export function hasAuthCookie(): boolean {
  if (typeof document === "undefined") return false;
  return /(?:^|;\s*)nw_uid=/.test(document.cookie);
}

// ---- En guide åt gången ----
//
// Guiderna bor i olika komponenter (nav i AppShell, group i GroupClient, swipe i
// swipe-sidan) med varsin timer och varsitt öppna-villkor. Inget hindrade att två
// öppnades samtidigt — t.ex. nav-guiden mitt i sitt flöde när man landade på
// /group och grupp-guiden tände ovanpå. Ett modul-globalt lås gör dem ömsesidigt
// uteslutande: den som hinner först visas, den andra hoppar över och dyker upp
// nästa session (den markeras inte som sedd förrän den faktiskt körts).
let activeGuide: GuideId | null = null;

/** Försök ta låset. Returnerar false om en ANNAN guide redan är aktiv. */
export function tryAcquireGuide(id: GuideId): boolean {
  if (activeGuide && activeGuide !== id) return false;
  activeGuide = id;
  return true;
}

export function releaseGuide(id: GuideId): void {
  if (activeGuide === id) activeGuide = null;
}
