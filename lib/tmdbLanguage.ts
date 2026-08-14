// lib/tmdbLanguage.ts
//
// Ett ställe som avgör vilket språk TMDB ska svara på. Tidigare läste varje
// route nw_locale (som beskriver var användaren ÄR, inte vilket språk hen valt)
// och föll tillbaka på "sv-SE" — så gränssnittet kunde stå på engelska medan
// titlar och synopsis fortsatte komma på svenska.
//
// Region hålls medvetet utanför: watch-providers och den svenska
// åldersgränsen ska fortsätta filtreras på SE även för en engelsk användare,
// annars byter rekommendationerna innehåll och inte bara språk.

import { cookies } from "next/headers";
import { LANG_COOKIE, tmdbLanguage, type AppLocale } from "@/lib/i18nConfig";

/** TMDB-språk för den pågående requesten, ur nw_lang-cookien. */
export async function tmdbLanguageFromCookies(): Promise<"sv-SE" | "en-US"> {
  try {
    const jar = await cookies();
    return tmdbLanguage(jar.get(LANG_COOKIE)?.value);
  } catch {
    return tmdbLanguage(undefined);
  }
}

/**
 * TMDB-språk för en annan användare än den som gör requesten — t.ex. i
 * push-cronen, som skickar notiser till alla. `uiLanguage` kommer då från
 * mottagarens Profile.
 */
export function tmdbLanguageFor(uiLanguage: string | AppLocale | null | undefined) {
  return tmdbLanguage(uiLanguage);
}
