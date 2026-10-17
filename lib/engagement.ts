// lib/engagement.ts — hur mycket en enhet faktiskt använt appen, för att
// tajma frågor (push-frågan) till efter att användaren fått något ut av den.
//
// Push-frågan kom tidigare vid 0 s på startsidan, innan man sett ett enda kort
// (tratten 2026-10-12: 84 av 85 nya iOS-enheter fick den direkt, 49 tryckte
// "Inte nu"). Nu frågar PushRegistration efter PUSH_ASK_AFTER_LIKES gilla.
// Per enhet i localStorage, best effort.
//
// 2026-10-13: sänkt från 5 till 1 (Oskars beslut). Med 5 nådde bara 13 av 41
// nya iOS-enheter frågan och andelen som tillät push föll från 35 % till 10 %.
// Första "gilla" nåddes av 17 av 41 — frågan kommer ändå efter att man sett
// vad appen gör.

export const LIKED_EVENT = "nw:liked";
export const PUSH_ASK_AFTER_LIKES = 1;

const KEY = "nw_like_count";

export function likeCount(): number {
  try {
    return Number(localStorage.getItem(KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** Anropas vid varje "gilla" (solo och grupp). */
export function recordLike(): void {
  try {
    localStorage.setItem(KEY, String(likeCount() + 1));
  } catch {
    /* privat läge */
  }
  try {
    window.dispatchEvent(new Event(LIKED_EVENT));
  } catch {
    /* SSR */
  }
}

/** Ligger ett ark/en modal redan öppen? Då väntar frågor till nästa tillfälle. */
export function blockingSheetOpen(): boolean {
  try {
    return Boolean(document.querySelector('[role="dialog"], [aria-modal="true"], [data-blocking-sheet]'));
  } catch {
    return false;
  }
}

/**
 * "Kommer snart"-kortet gillades → fråga direkt om push för just den titeln
 * ("Får vi skicka en notis när X släpps?"). Till skillnad från den allmänna
 * frågan efter första gilla ignorerar den här snoozen och tidigare nej:
 * användaren har precis bett om en bevakning, och utan push kan den aldrig
 * levereras (Oskars beslut 2026-10-14). PushRegistration lyssnar och avgör
 * vad som går att visa utifrån OS-behörigheten.
 */
export const RELEASE_ASK_EVENT = "nw:release-ask";

/**
 * kind "stream" = "Bevaka" på en titel som inte går att se än (WatchNowButton):
 * egna texter ("…när X finns på dina tjänster"), och ingen bekräftelse om
 * notiser redan är på — knappen har redan bekräftat.
 */
export type ReleaseAskKind = "release" | "stream";

export function requestReleasePushAsk(title: string, kind: ReleaseAskKind = "release"): void {
  try {
    window.dispatchEvent(new CustomEvent(RELEASE_ASK_EVENT, { detail: { title, kind } }));
  } catch {
    /* SSR */
  }
}
