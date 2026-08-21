// lib/userGuide.ts
//
// Resterna av det gamla, passiva guide-lagret. Guiderna själva (GuideOverlay +
// lib/guideSteps.ts, localStorage-flaggorna nw_guide_*_v1) togs bort 2026-08-21
// och ersattes av EN motor: lib/tours/* med server-persisterad progress och
// bottenark i stället för modaler mitt på skärmen. De gamla localStorage-
// nycklarna läses fortfarande — men bara som migrering, i
// lib/tours/useTourGate.ts, så redan onboardade användare slipper allt igen.
//
// Kvar här: bara sessionskollen, som aldrig hade med guiderna att göra.

/** Finns identitetskakan? (Klientsidans billiga "är jag inloggad"-koll.) */
export function hasAuthCookie(): boolean {
  if (typeof document === "undefined") return false;
  return /(?:^|;\s*)nw_uid=/.test(document.cookie);
}
