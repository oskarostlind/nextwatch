// lib/apiMessages.ts
//
// Felmeddelanden från API-routes visas ofta rakt av i UI:t (`data.message`).
// De var hårdkodade — mest på svenska, några på engelska — så en engelsk
// användare fick svensk text och tvärtom. Nu slås de upp i namnrymden "api"
// i messages/*.json på anroparens språk (nw_lang-cookien, via i18n/request.ts).
//
// Maskinkoder (t.ex. error: "swipe_limit") ska INTE gå hit — klienten matchar
// på dem. Bara text som en människa ska läsa.
import { getTranslations } from "next-intl/server";
import type sv from "@/messages/sv.json";

export type ApiMsgKey = keyof (typeof sv)["api"];

export async function apiMsg(key: ApiMsgKey, values?: Record<string, string | number>): Promise<string> {
  try {
    const t = await getTranslations("api");
    return t(key, values);
  } catch {
    // Utan request-scope (skript, cron) finns ingen cookie att läsa.
    const t = await getTranslations({ locale: "sv", namespace: "api" });
    return t(key, values);
  }
}
