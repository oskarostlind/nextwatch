export type GuideStep = {
  /** data-guide-attribut utan hakparenteser, t.ex. "swipe-card" */
  target?: string;
  /** Nyckel i messages/*.json under namnrymden "tours". */
  titleKey: string;
  bodyKey: string;
  placement?: "top" | "bottom" | "center";
};

export const SWIPE_GUIDE_STEPS: GuideStep[] = [
  {
    titleKey: "swipeGuide.s0.title",
    bodyKey: "swipeGuide.s0.body",
    placement: "center",
  },
  {
    target: "swipe-card",
    titleKey: "swipeGuide.s1.title",
    bodyKey: "swipeGuide.s1.body",
    placement: "bottom",
  },
  {
    target: "swipe-card",
    titleKey: "swipeGuide.s2.title",
    bodyKey: "swipeGuide.s2.body",
    placement: "bottom",
  },
  {
    target: "swipe-card",
    titleKey: "swipeGuide.s3.title",
    bodyKey: "swipeGuide.s3.body",
    placement: "bottom",
  },
  {
    target: "swipe-card",
    titleKey: "swipeGuide.s4.title",
    bodyKey: "swipeGuide.s4.body",
    placement: "bottom",
  },
  {
    target: "action-dock",
    titleKey: "swipeGuide.s5.title",
    bodyKey: "swipeGuide.s5.body",
    placement: "top",
  },
];

export const NAV_GUIDE_STEPS: GuideStep[] = [
  {
    target: "nav-swipe",
    titleKey: "navGuide.s0.title",
    bodyKey: "navGuide.s0.body",
    placement: "top",
  },
  {
    target: "nav-group",
    titleKey: "navGuide.s1.title",
    bodyKey: "navGuide.s1.body",
    placement: "top",
  },
  {
    target: "nav-discover",
    titleKey: "navGuide.s2.title",
    bodyKey: "navGuide.s2.body",
    placement: "top",
  },
  {
    target: "nav-watchlist",
    titleKey: "navGuide.s3.title",
    bodyKey: "navGuide.s3.body",
    placement: "top",
  },
  {
    target: "nav-profile",
    titleKey: "navGuide.s4.title",
    bodyKey: "navGuide.s4.body",
    placement: "top",
  },
];

export const GROUP_GUIDE_STEPS: GuideStep[] = [
  {
    target: "group-tabs",
    titleKey: "groupGuide.s0.title",
    bodyKey: "groupGuide.s0.body",
    placement: "bottom",
  },
  {
    target: "group-create-join",
    titleKey: "groupGuide.s1.title",
    bodyKey: "groupGuide.s1.body",
    placement: "bottom",
  },
  {
    target: "group-start-swipe",
    titleKey: "groupGuide.s2.title",
    bodyKey: "groupGuide.s2.body",
    placement: "bottom",
  },
  {
    target: "friends-search",
    titleKey: "groupGuide.s3.title",
    bodyKey: "groupGuide.s3.body",
    placement: "bottom",
  },
];
