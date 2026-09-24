// lib/signupNudge.ts
//
// Triggade "skapa konto"-prompter för gäster. Ytorna i appen anropar
// nudgeSignup(trigger) i rätt ögonblick; SignupNudge (monterad globalt via
// OverlayMount) lyssnar, kontrollerar att användaren faktiskt är gäst och
// visar ett kontextuellt ark.
//
// Tjat-skydd (localStorage):
//   - varje trigger visas högst EN gång per enhet,
//   - minst COOLDOWN_MS mellan två prompter oavsett trigger.
// "premium" är undantaget: den visas vid varje köpförsök av en gäst, eftersom
// ett köp på ett konto utan inloggning kan gå förlorat (se ensureAccountBeforePremium).

export type NudgeTrigger = "swipes" | "watchlist" | "group" | "friend" | "premium";

export const SIGNUP_NUDGE_EVENT = "nw:signup-nudge";

export type SignupNudgeDetail = {
  trigger: NudgeTrigger;
  /** Endast premium: anropas med true om användaren väljer "fortsätt utan konto". */
  onResolve?: (continueWithoutAccount: boolean) => void;
};

/** Antal swipes innan "swipes"-prompten. */
export const SWIPES_THRESHOLD = 25;
/** Antal likes (= sparade titlar i watchlist) innan "watchlist"-prompten. */
export const LIKES_THRESHOLD = 3;
/** Minsta tid mellan två prompter. */
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

const K_SWIPES = "nw_nudge_swipes";
const K_LIKES = "nw_nudge_likes";
const K_LAST = "nw_nudge_last";
const shownKey = (t: NudgeTrigger) => `nw_nudge_shown_${t}`;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* privat läge — prompten blir då bara av/på per session, ofarligt */
  }
}

/** Får triggern visas nu? (Premium går alltid.) */
export function nudgeAllowed(trigger: NudgeTrigger, now = Date.now()): boolean {
  if (trigger === "premium") return true;
  if (read(shownKey(trigger))) return false;
  const last = Number(read(K_LAST) ?? 0);
  return !(last && now - last < COOLDOWN_MS);
}

/** Anropas av SignupNudge när arket faktiskt visats. */
export function markNudgeShown(trigger: NudgeTrigger, now = Date.now()): void {
  if (trigger === "premium") return;
  write(shownKey(trigger), String(now));
  write(K_LAST, String(now));
}

export function nudgeSignup(trigger: NudgeTrigger, onResolve?: SignupNudgeDetail["onResolve"]): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SignupNudgeDetail>(SIGNUP_NUDGE_EVENT, { detail: { trigger, onResolve } }),
  );
}

function bump(key: string): number {
  const n = Number(read(key) ?? 0) + 1;
  write(key, String(n));
  return n;
}

/**
 * Räkna en swipe i solo-/gruppsvepet. Triggar "watchlist" vid tredje liken och
 * "swipes" vid den 25:e swipen. Räknaren nollställs aldrig — varje trigger
 * visas ändå bara en gång.
 */
export function trackSwipeForNudge(kind: "like" | "dislike" | "seen"): void {
  const swipes = bump(K_SWIPES);
  if (kind === "like" && bump(K_LIKES) === LIKES_THRESHOLD) {
    nudgeSignup("watchlist");
    return;
  }
  if (swipes === SWIPES_THRESHOLD) nudgeSignup("swipes");
}

/** Sätts av SignupNudge. Utan monterad värd går köpet direkt vidare. */
let hostMounted = false;
export function setSignupNudgeHostMounted(v: boolean): void {
  hostMounted = v;
}

/**
 * Innan ett Premium-köp: är användaren gäst visas ett ark som rekommenderar
 * konto först. Resolvar true = gå vidare med köpet, false = avbryt (användaren
 * valde att skapa konto eller stängde arket).
 *
 * Mjuk spärr med avsikt: Apple tillåter att man kräver konto för
 * prenumerationer, men "Köp ändå" håller oss på säkra sidan i review och
 * låter köpet gå igenom om statusen inte går att läsa.
 */
export function ensureAccountBeforePremium(): Promise<boolean> {
  if (typeof window === "undefined" || !hostMounted) return Promise.resolve(true);
  // Värden svarar alltid: statusanropet har timeout (lib/accountStatus.ts) och
  // okänd status räknas som "inte gäst" → resolve(true).
  return new Promise((resolve) => {
    let settled = false;
    nudgeSignup("premium", (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    });
  });
}
