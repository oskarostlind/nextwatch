/** Custom URL-schema registrerat i ios/App/App/Info.plist */
export const APP_DEEP_LINK_SCHEME = "nextwatch";

/** Deep link som Safari-knappen använder efter lyckad e-postverifiering. */
export const APP_VERIFY_RETURN_URL = `${APP_DEEP_LINK_SCHEME}://auth/verified`;

export function isLikelyMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}
