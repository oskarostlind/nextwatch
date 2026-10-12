// lib/engagement.ts — hur mycket en enhet faktiskt använt appen, för att
// tajma frågor (push-frågan) till efter att användaren fått något ut av den.
//
// Push-frågan kom tidigare vid 0 s på startsidan, innan man sett ett enda kort
// (tratten 2026-10-12: 84 av 85 nya iOS-enheter fick den direkt, 49 tryckte
// "Inte nu"). Nu frågar PushRegistration först efter PUSH_ASK_AFTER_LIKES gilla.
// Per enhet i localStorage, best effort.

export const LIKED_EVENT = "nw:liked";
export const PUSH_ASK_AFTER_LIKES = 5;

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
