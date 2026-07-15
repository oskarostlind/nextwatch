/**
 * Smakprofil / swipe-insyn — enkel feature-flagga för premium-gating.
 * Sätt till true när insyn ska kräva Premium.
 */
export const TASTE_PROFILE_REQUIRES_PREMIUM = false;

/** Andel swipe-kort som får en "Varför det här?"-rad (0–1). */
export const SWIPE_REASONS_SHOW_RATE = 0.35;

/**
 * Tröskel för "Toppmatch för dig" i solo-swipe.
 *
 * Mäts mot smakscoren (matchade nyckelord + personer) och INTE mot slutscoren:
 * slutscoren innehåller kvalitet och nyhetsbonus, så en hyllad blockbuster utan
 * någon koppling till din smak kan passera en hög total — och då finns ingen
 * ärlig motivering att visa. Med smakscoren som grind är motiveringen garanterad.
 *
 * Rätt nivå går inte att räkna ut i förväg utan riktig data, därför env-styrd:
 * sätt NW_TOPMATCH_MIN_TASTE för att kalibrera utan ny deploy. Högre = mer sällsynt.
 */
export const TOPMATCH_MIN_TASTE_SCORE = (() => {
  const raw = Number(process.env.NW_TOPMATCH_MIN_TASTE);
  return Number.isFinite(raw) && raw > 0 ? raw : 1.5;
})();

/** Minsta antal konkreta person-/tematräffar för att få kalla något toppmatch. */
export const TOPMATCH_MIN_EVIDENCE = 1;
