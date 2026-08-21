import type { CoachTourStep } from "./types";

export const FRIENDS_TOUR_STEPS: CoachTourStep[] = [
  {
    mode: "coach",
    id: "friends-add",
    target: "friends-add",
    titleKey: "friendsTour.s0.title",
    bodyKey: "friendsTour.s0.body",
    placement: "bottom",
  },
  {
    mode: "coach",
    id: "friends-requests",
    target: "friends-requests",
    titleKey: "friendsTour.s1.title",
    bodyKey: "friendsTour.s1.body",
    placement: "top",
  },
  {
    mode: "coach",
    id: "friends-list",
    target: "friends-list",
    titleKey: "friendsTour.s2.title",
    bodyKey: "friendsTour.s2.body",
    placement: "top",
  },
];

export const GROUPS_TOUR_STEPS: CoachTourStep[] = [
  {
    mode: "coach",
    id: "group-join-create",
    target: "group-join-create",
    titleKey: "groupsTour.s0.title",
    bodyKey: "groupsTour.s0.body",
    placement: "bottom",
  },
  {
    mode: "coach",
    id: "group-invite",
    target: "group-invite",
    titleKey: "groupsTour.s1.title",
    bodyKey: "groupsTour.s1.body",
    placement: "bottom",
  },
  {
    mode: "coach",
    id: "group-settings",
    target: "group-settings",
    titleKey: "groupsTour.s2.title",
    bodyKey: "groupsTour.s2.body",
    placement: "bottom",
  },
  {
    mode: "coach",
    id: "group-start-swipe",
    target: "group-start-swipe",
    titleKey: "groupsTour.s3.title",
    bodyKey: "groupsTour.s3.body",
    placement: "bottom",
  },
];

export const WATCHLIST_TOUR_STEPS: CoachTourStep[] = [
  {
    mode: "coach",
    id: "watchlist-intro",
    target: "watchlist-tabs",
    titleKey: "watchlistTour.s0.title",
    bodyKey: "watchlistTour.s0.body",
    placement: "bottom",
  },
  {
    mode: "coach",
    id: "watchlist-grid",
    target: "watchlist-grid",
    titleKey: "watchlistTour.s1.title",
    bodyKey: "watchlistTour.s1.body",
    placement: "top",
  },
  {
    mode: "coach",
    id: "watchlist-rate",
    titleKey: "watchlistTour.s2.title",
    bodyKey: "watchlistTour.s2.body",
    placement: "center",
  },
  {
    mode: "coach",
    id: "watchlist-watch",
    titleKey: "watchlistTour.s3.title",
    bodyKey: "watchlistTour.s3.body",
    placement: "center",
  },
];
