// Ett ställe som listar alla onboarding-genomgångar och deras aktuella version.
// Bumpa en tours version här för att visa den för alla igen (gamla rader i
// OnboardingTour med lägre version räknas som osedda) — se prisma/schema.prisma.
export const TOUR_VERSIONS = {
  "swipe-gestures": 1,
  "friends-tour": 1,
  "groups-tour": 1,
  "watchlist-tour": 1,
} as const;

export type TourId = keyof typeof TOUR_VERSIONS;
