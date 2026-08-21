// Innehållet i coach-genomgångarna. Varje steg pekar ut ett RIKTIGT element via
// data-tour och förklaras i ett bottenark (HintSheet) — inte i en modal mitt på
// skärmen. Steg med requiresTarget hoppas över tyst när elementet inte finns,
// vilket är hela poängen med "just-in-time": man får hinten först när ytan den
// beskriver faktiskt är på skärmen.
import type { CoachTourStep } from "./types";

/** Ersätter den gamla femstegskedjan över tabbraden med EN ruta. */
export const NAV_TOUR_STEPS: CoachTourStep[] = [
  {
    mode: "coach",
    id: "nav-overview",
    target: "nav-tabs",
    titleKey: "navTour.s0.title",
    bodyKey: "navTour.s0.body",
    requiresTarget: true,
    list: [
      { icon: "swipe", key: "navTour.s0.swipe" },
      { icon: "group", key: "navTour.s0.group" },
      { icon: "discover", key: "navTour.s0.discover" },
      { icon: "watchlist", key: "navTour.s0.watchlist" },
      { icon: "profile", key: "navTour.s0.profile" },
    ],
  },
];

export const FRIENDS_TOUR_STEPS: CoachTourStep[] = [
  {
    mode: "coach",
    id: "friends-add",
    target: "friends-add",
    titleKey: "friendsTour.s0.title",
    bodyKey: "friendsTour.s0.body",
    requiresTarget: true,
  },
  {
    mode: "coach",
    id: "friends-value",
    titleKey: "friendsTour.s2.title",
    bodyKey: "friendsTour.s2.body",
  },
];

/** Visas på "ingen grupp än"-vyn. */
export const GROUPS_START_STEPS: CoachTourStep[] = [
  {
    mode: "coach",
    id: "group-join-create",
    target: "group-join-create",
    titleKey: "groupsTour.s0.title",
    bodyKey: "groupsTour.s0.body",
    requiresTarget: true,
  },
];

/** Visas först när man FAKTISKT är med i en grupp — egna steg, egen tour. */
export const GROUP_ACTIVE_STEPS: CoachTourStep[] = [
  {
    mode: "coach",
    id: "group-invite",
    target: "group-invite",
    titleKey: "groupsTour.s1.title",
    bodyKey: "groupsTour.s1.body",
    requiresTarget: true,
  },
  {
    mode: "coach",
    id: "group-settings",
    target: "group-settings",
    titleKey: "groupsTour.s2.title",
    bodyKey: "groupsTour.s2.body",
    requiresTarget: true,
  },
  {
    mode: "coach",
    id: "group-start-swipe",
    target: "group-start-swipe",
    titleKey: "groupsTour.s3.title",
    bodyKey: "groupsTour.s3.body",
    requiresTarget: true,
  },
];

export const WATCHLIST_TOUR_STEPS: CoachTourStep[] = [
  {
    mode: "coach",
    id: "watchlist-intro",
    target: "watchlist-tabs",
    titleKey: "watchlistTour.s0.title",
    bodyKey: "watchlistTour.s0.body",
    requiresTarget: true,
  },
  {
    mode: "coach",
    id: "watchlist-grid",
    target: "watchlist-grid",
    titleKey: "watchlistTour.s1.title",
    bodyKey: "watchlistTour.s1.body",
    requiresTarget: true,
  },
  {
    mode: "coach",
    id: "watchlist-rate",
    titleKey: "watchlistTour.s2.title",
    bodyKey: "watchlistTour.s2.body",
  },
];
