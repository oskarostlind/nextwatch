// lib/tours/lock.ts
//
// En genomgång åt gången. Genomgångarna bor i olika komponenter (nav i
// AppShell, grupper/vänner i /group, watchlist i /watchlist) med varsitt
// öppna-villkor, och inget hindrade att två tände samtidigt — t.ex. nav-hinten
// mitt i sitt flöde när man landade på /group och grupp-hinten ovanpå.
//
// Ersätter det modul-globala låset som låg i lib/userGuide.ts (de gamla
// passiva GuideOverlay-guiderna) så hela onboardingen har EN motor.

import type { TourId } from "./registry";

let active: TourId | null = null;

/** Försök ta låset. False om en ANNAN genomgång redan kör. */
export function tryAcquireTour(id: TourId): boolean {
  if (active && active !== id) return false;
  active = id;
  return true;
}

export function releaseTour(id: TourId): void {
  if (active === id) active = null;
}

export function tourLockHeldBy(): TourId | null {
  return active;
}
