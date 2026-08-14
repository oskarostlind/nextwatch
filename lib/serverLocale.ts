// lib/serverLocale.ts
//
// Läser gränssnittsspråket i route handlers och server components. Skild från
// lib/uiLanguage.ts, som är klientsidan av samma val.

import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LANG_COOKIE, normalizeLocale, type AppLocale } from "@/lib/i18nConfig";

/** Språket för den pågående requesten, ur nw_lang-cookien. */
export async function uiLocaleFromCookies(): Promise<AppLocale> {
  try {
    const jar = await cookies();
    return normalizeLocale(jar.get(LANG_COOKIE)?.value);
  } catch {
    return DEFAULT_LOCALE;
  }
}
