// Ett ställe som listar alla onboarding-genomgångar och deras aktuella version.
// Bumpa en tours version här för att visa den för alla igen (gamla rader i
// OnboardingTour med lägre version räknas som osedda) — se prisma/schema.prisma.
//
// OBS: bumpa INTE en version bara för att designen ändras. Redan onboardade
// användare ska inte få genomgången igen — "Visa igen" i Profil (?tour=<id>)
// är vägen tillbaka för den som vill se den en gång till.
export const TOUR_VERSIONS = {
  "swipe-gestures": 1,
  "nav-tour": 1,
  "friends-tour": 1,
  "groups-tour": 1,
  "group-active-tour": 1,
  "watchlist-tour": 1,
} as const;

export type TourId = keyof typeof TOUR_VERSIONS;

/**
 * Gamla localStorage-nycklar från de passiva GuideOverlay-guiderna (borttagna
 * 2026-08-21). En användare som redan sett den gamla guiden ska INTE få den
 * nya hinten — gaten läser nyckeln, hoppar över genomgången och skriver
 * samtidigt en OnboardingTour-rad så migreringen bara sker en gång per enhet.
 */
export const LEGACY_GUIDE_KEYS: Partial<Record<TourId, string>> = {
  "nav-tour": "nw_guide_nav_v1",
  "groups-tour": "nw_guide_group_v1",
  "group-active-tour": "nw_guide_group_v1",
  "friends-tour": "nw_guide_group_v1",
  "watchlist-tour": "nw_guide_watchlist_v1",
};
