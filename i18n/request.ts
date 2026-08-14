// i18n/request.ts
//
// next-intl körs UTAN URL-routing: adresserna förblir /swipe, /profile, ...
// och språket kommer från cookien nw_lang. Skälet är att appen laddas i en
// Capacitor-WebView mot www.nextwatch.se och att djuplänkar, App Store-länkar
// och push-notiser pekar på befintliga sökvägar — ett /en-prefix hade tvingat
// fram ändringar på native-sidan och därmed en ny Appflow-build.
//
// Konsekvens att känna till: eftersom vi läser cookies() här renderas sidorna
// dynamiskt i stället för statiskt. Flikbyten serveras fortfarande ur
// router-cachen (experimental.staleTimes i next.config.ts), så navigeringen
// påverkas inte — det är första laddningen som går via servern.

import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LANG_COOKIE, normalizeLocale } from "../lib/i18nConfig";

export default getRequestConfig(async ({ locale: requested }) => {
  let locale = DEFAULT_LOCALE;

  if (requested) {
    // Explicit språk (getTranslations({ locale })) vinner alltid. Det är så
    // e-post och push kan renderas på MOTTAGARENS språk från cronen, där det
    // inte finns någon cookie att läsa.
    locale = normalizeLocale(requested);
  } else {
    try {
      const store = await cookies();
      locale = normalizeLocale(store.get(LANG_COOKIE)?.value);
    } catch {
      // Kan hända i kontexter utan request-scope (t.ex. vissa byggsteg).
      locale = DEFAULT_LOCALE;
    }
  }

  const messages = (await import(`../messages/${locale}.json`)).default;

  return {
    locale,
    messages,
    timeZone: "Europe/Stockholm",
    // Saknad nyckel ska aldrig krascha en sida i produktion — visa nyckeln och
    // logga i stället, så att en missad översättning blir ett kosmetiskt fel.
    onError() {},
    getMessageFallback({ key, namespace }: { key: string; namespace?: string }) {
      return namespace ? `${namespace}.${key}` : key;
    },
  };
});
