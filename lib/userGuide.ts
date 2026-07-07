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
