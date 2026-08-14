// lib/uiLanguage.ts
//
// Klientsidan av språkbytet. Cookien skrivs direkt i webbläsaren så att
// nästa render (server som klient) redan talar rätt språk — den behöver alltså
// inte vänta på att profilen sparas. Profilen uppdateras i bakgrunden så att
// valet följer med till nästa enhet/inloggning.

import { LANG_COOKIE, normalizeLocale, type AppLocale } from "@/lib/i18nConfig";
import { clearClientCache } from "@/lib/clientCache";

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Läser nuvarande språk ur cookien. Faller till svenska på servern. */
export function readUiLanguage(): AppLocale {
  if (typeof document === "undefined") return normalizeLocale(undefined);
  const hit = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${LANG_COOKIE}=`));
  return normalizeLocale(hit ? decodeURIComponent(hit.slice(LANG_COOKIE.length + 1)) : undefined);
}

/** Skriver cookien. `secure` utelämnas på http://localhost, annars vägrar Chrome. */
export function writeUiLanguageCookie(locale: AppLocale): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LANG_COOKIE}=${locale}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure}`;
}

/**
 * Byter språk: cookie först (omedelbar effekt), sedan persistering mot profilen.
 *
 * Klientcachen rensas med flit. TMDB-titlar, synopsis och watchlist-kort ligger
 * cachade i localStorage på det språk de hämtades — utan rensning hade
 * gränssnittet bytt till engelska medan korten låg kvar på svenska tills
 * respektive TTL löpt ut.
 */
export async function setUiLanguage(next: AppLocale): Promise<void> {
  writeUiLanguageCookie(next);
  try {
    clearClientCache();
  } catch {
    /* noop */
  }
  try {
    await fetch("/api/profile/language", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ uiLanguage: next }),
    });
  } catch {
    // Cookien gäller ändå — valet är kvar på den här enheten även om
    // persisteringen misslyckas.
  }
}
