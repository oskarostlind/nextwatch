// lib/swipeLimitEvent.ts
//
// Signalen mellan swipe-anropen och <SwipeLimitWall />. Ligger i en EGEN modul
// och inte i SwipeLimitWall.tsx med flit: swipe-vyn lat-laddar väggen med
// next/dynamic, och en namngiven import från samma fil hade dragit in hela
// komponenten (framer-motion, lucide, premiumPurchase) i förstaladdningens
// bundle igen — då blir dynamic() en ren no-op.

export const SWIPE_LIMIT_EVENT = "nw:swipe-limit";

/** Meddelar väggen att servern nekat en swipe. Returnerar true vid 429. */
export function reportSwipeLimitFrom(res: Response): boolean {
  if (res.status !== 429) return false;
  window.dispatchEvent(new Event(SWIPE_LIMIT_EVENT));
  return true;
}
