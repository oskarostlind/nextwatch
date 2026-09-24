// lib/clientMessages.ts (klient)
//
// Texter från vanliga klientfunktioner — köpflödet, lokala påminnelser,
// rekommendationshämtningen — som inte är React-komponenter och därför inte
// kan använda useTranslations(). Språket läses ur nw_lang-cookien precis som
// resten av gränssnittet (lib/uiLanguage.ts).
//
// Hålls här i stället för i messages/*.json för att inte skeppa hela
// ordlistorna (~56 kB/språk) till klienten bara för ett tiotal felmeddelanden.
// `satisfies` nedan gör att en nyckel som saknas i engelskan är ett typfel.
import { readUiLanguage } from "@/lib/uiLanguage";

const sv = {
  purchaseUnavailableRetry: "Premium-köp är inte tillgängligt i appen ännu. Försök igen senare.",
  purchaseUnavailable: "Premium-köp är inte tillgängligt i appen ännu.",
  purchaseUnverified:
    "Köpet gick igenom men kunde inte verifieras. Starta om appen — kontakta oss om premium inte aktiveras.",
  purchaseFailed: "Köpet kunde inte slutföras. Försök igen.",
  checkoutFailed: "Kunde inte starta betalning.",
  restoreOnIos: "Återställning av köp görs i iOS-appen.",
  noActiveSubscription: "Ingen aktiv prenumeration hittades på det här Apple-kontot.",
  purchaseVerifyFailed: "Kunde inte verifiera köpet.",
  subscriptionExpired: "Prenumerationen har gått ut.",
  restoreFailed: "Kunde inte återställa köp. Försök igen.",
  remindersAppOnly: "Påminnelser fungerar bara i appen.",
  remindersAllowNotifications: "Tillåt notiser för att få en påminnelse.",
  remindersUnknownDate: "Okänt releasedatum.",
  remindersAlreadyReleased: "Filmen har redan släppts.",
  remindersFailed: "Kunde inte skapa påminnelse.",
  reminderTitle: "Släpps idag 🎬",
  reminderBody: "{title} finns nu att se!",
  recsLoadFailed: "Kunde inte ladda rekommendationer.",
  networkError: "Nätverksfel.",
  voteFailed: "Kunde inte skicka röst.",
};

const en = {
  purchaseUnavailableRetry: "Premium purchases aren't available in the app yet. Please try again later.",
  purchaseUnavailable: "Premium purchases aren't available in the app yet.",
  purchaseUnverified:
    "The purchase went through but couldn't be verified. Restart the app — contact us if Premium isn't activated.",
  purchaseFailed: "The purchase couldn't be completed. Please try again.",
  checkoutFailed: "Couldn't start the payment.",
  restoreOnIos: "Purchases are restored in the iOS app.",
  noActiveSubscription: "No active subscription was found on this Apple account.",
  purchaseVerifyFailed: "Couldn't verify the purchase.",
  subscriptionExpired: "The subscription has expired.",
  restoreFailed: "Couldn't restore purchases. Please try again.",
  remindersAppOnly: "Reminders only work in the app.",
  remindersAllowNotifications: "Allow notifications to get a reminder.",
  remindersUnknownDate: "Unknown release date.",
  remindersAlreadyReleased: "This movie has already been released.",
  remindersFailed: "Couldn't create the reminder.",
  reminderTitle: "Out today 🎬",
  reminderBody: "{title} is now available to watch!",
  recsLoadFailed: "Couldn't load recommendations.",
  networkError: "Network error.",
  voteFailed: "Couldn't send your vote.",
} satisfies Record<keyof typeof sv, string>;

export type ClientMsgKey = keyof typeof sv;

export function clientMsg(key: ClientMsgKey, values?: Record<string, string | number>): string {
  const dict = readUiLanguage() === "en" ? en : sv;
  let out: string = dict[key];
  if (values) for (const [k, v] of Object.entries(values)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}
