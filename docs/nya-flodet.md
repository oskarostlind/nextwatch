# Nya flödet (2026-10-15) – spec, beslut och vem som äger vad

Bakgrund och siffror: projektdokumenten `claude/flodesanalys-2026-10-14.md` och `claude/nya-flodet-2026-10-15.md`.
Klickbar prototyp (referens för utseende och beteende, läs markupen):
`/tmp/claude-0/-home-claude/2cffe129-ca13-5ce6-84c0-56fee77ca7ba/scratchpad/canvas/project/Flow.dc.html`
(steglistan i `stepsData()` beskriver varje steg i text).

## Flödet för en NY enhet
1. **Kallstart** – appen (iOS/Android) öppnar direkt på ett riktigt filmkort. Gästprofil skapas tyst. Ingen startsida, inget gäst/konto-val. "Har du konto? Logga in" som diskret länk. Webben: startsidan finns kvar för SEO, men huvudknappen går rakt in i leken (ingen spärr efter 4 demokort).
2. **Leken lär sig** – efter 3 gilla en chip "N gillade – vi lär oss din smak"; progress "N av 10 – sedan väljer AI kvällens film".
3. **Tjänster + ålder som ett kort i leken** (efter 5 swipes, inte en modal): 9 tjänster + åldersknappar (under 15 / 15–17 / 18+) på samma kort. Ersätter `ProviderPromptSheet` för nya enheter.
4. **✦ AI väljer kvällens film** – vid 10 swipes öppnas Välj åt mig av sig själv med ett FÄRDIGT förslag (förberäknat, gratis, räknas inte mot kvoten). Ny futuristisk look (glasark, cyan/violett kant, synlig "tänker", svaret skrivs fram). Chips: Lättare / Kortare / Överraska mig. Knapp "Spara kvällens film".
5. **Spara** – "Spara dina N filmer och kvällens val": iOS Fortsätt med Apple (ett tryck, rakt tillbaka till leken – ingen 4-stegs onboarding), Android/webb e-post. "Senare".
6. **Mjuk betalvägg (A/B 50 %)** – direkt efter spara: NextWatch Premium, 7 dagar gratis, Årsvis 599 kr / Månadsvis 79 kr, all 3.1.2-text, stängbar.
7. **Notisfråga med löfte** – "Vill du få kvällens AI-val när du brukar titta?" tidsval 18/19/20/21 + förhandsvisad notis. Ersätter frågan efter första gilla för nya enheter.
8. **Bjud in** – kort i leken: "Vem tittar du med ikväll?" → länk (`/g/<kod>`), dina gillade följer med, "Ni får båda 5 AI-val när din vän swipat 10 kort".
9. **Vännen på webben** – länken öppnar leken direkt i webbläsaren, gäst skapas tyst, värdens gillade först, match när båda gillar, lugn uppmaning att ladda ner appen.
10. **Nästa dag** – notisen kommer vald tid med kvällens val.

Befintliga användare/enheter påverkas INTE (de har inget `nw_fs_v1`-tillstånd → `eligible=false`).

## Beslut (Oskar, 2026-10-15)
- Premium: **79 kr/mån** och **599 kr/år**, **7 dagar gratis på båda**. Befintliga prenumeranter behåller 19 kr. Lifetime rörs inte.
- Premium ger: helt annonsfritt · obegränsat med swipes · grupper upp till 20 · **Smakprofilen (/profile → Smak)** · **obegränsat med Välj åt mig** (med ett dolt rimlighetstak mot missbruk, env `NW_PICK_PREMIUM_DAILY_CAP`, default 100/dygn).
- Åldern frågas med ett tryck på tjänstekortet. Innan dess gäller det som gäster redan har idag.
- Gäller iOS, Android och webb. Köp: iOS StoreKit, Android Google Play, webb Stripe – aldrig Stripe i apparna.

## Kontrakt mellan delarna
- `lib/firstSession.ts` (finns) – stegmaskinen. `startFirstSession()` anropas när en ny enhet kallstartar. Leken anropar `recordFsSwipe(like|null)` för varje solo-swipe. Varje steg anropar `advanceFs("<steg>", { isPremium })` när det är klart ELLER stängs.
- `app/components/firstSession/FirstSessionHost.tsx` (finns) monteras i solo-leken och visar `AiReveal`, `SaveSheet`, `SoftPaywall`, `PushAskSheet`, `InviteCard` (stubbar – ägarna fyller i).
- Köp: `lib/premiumPurchase.ts` exporterar `goPremium(plan?: "monthly" | "yearly")` (default "monthly" så gamla anrop fungerar) och `getPremiumOffers(): Promise<PremiumOffers>` där `PremiumOffers = { monthly: Offer; yearly: Offer }`, `Offer = { price: string; period: "month" | "year"; trialDays: number; available: boolean }` – butikens lokaliserade pris när det finns, annars "79 kr"/"599 kr".
- AI auto-förslag: `POST /api/pick` med `{ auto: true, ... }` → gratis, räknas inte, högst 1 per användare och dygn, `source = 'auto'`. Klienthjälpare `fetchAutoPick()` i `lib/aiPick/client.ts`.
- Mätning (tratten, `funnel()` i `lib/funnel.ts`, lägg till etiketter i `lib/funnelSteps.ts`): `guest_autocreated`, `fs_services_card`, `fs_age_set`, `ai_auto_reveal`, `ai_auto_ok`, `save_card_shown`, `save_card_apple`, `save_card_email`, `paywall_view`, `paywall_plan_yearly`, `paywall_plan_monthly`, `trial_start`, `push_ask_shown`, `push_time_chosen`, `invite_shown`, `invite_shared`, `web_swipe`, `group_match_link`, `referral_reward`, `web_to_install`. Steg-ägaren lägger till sina egna.

## Ägare (en agent per del, egen gren/arbetskopia)
| Del | Äger (får ändra) |
|---|---|
| 1 Kallstart + leken | `app/page.tsx`, `app/components/client/AuthGate.tsx`, `app/components/landing/*`, `app/swipe/*`, `app/components/client/ProviderPromptSheet.tsx`, `app/components/auth/SignupNudge.tsx` (+ `lib/signupNudge*`), `app/components/client/FunnelTracker.tsx`, `lib/funnel.ts`, `lib/funnelSteps.ts`, `app/api/profile/guest/*`, nya filer under `app/components/firstSession/deck/` |
| 2 AI 2.0 | `app/components/pick/*`, `lib/aiPick/*`, `app/api/pick/*`, `app/components/firstSession/AiReveal.tsx` |
| 3 Butik + priser | `lib/premiumPurchase.ts`, `lib/appleIap.ts`, `app/api/apple/*`, `lib/googlePlay.ts`, `app/api/google/*`, `app/api/stripe/*`, `app/api/billing/*`, `lib/entitlements.ts`, `app/premium/*`, `app/components/**/PremiumUpsell*`, `lib/email.ts` (pristext) |
| 4 Spara + mjuk betalvägg | `app/components/firstSession/SaveSheet.tsx`, `app/components/firstSession/SoftPaywall.tsx` (+ egna hjälpfiler under `app/components/firstSession/`) |
| 5 Notisfråga | `app/components/client/PushRegistration.tsx`, `lib/engagement.ts`, `app/components/firstSession/PushAskSheet.tsx`, `app/api/push/*` (ny preferens-route), `lib/pushRecs/*` (bara utskickstimmen), `app/api/cron/daily-recs/*` (bara utskickstimmen) |
| 6 Bjud in + webbswipe | `app/g/**` (ny), `app/api/group/*`, `lib/referral.ts` (ny), `app/components/firstSession/InviteCard.tsx`, `app/group/**` (bara där länken/kod-anslutningen kräver det) |

Ändra inte andra delars filer. Behöver du något från en annan del: använd kontraktet ovan, eller lägg en tydlig `// TODO(nya-flodet:<del>)` och skriv det i din rapport.

## Regler för alla
- Läs `CLAUDE.md` först. Svenska kommentarer och copy. Bevara App Store-compliance (3.1.2-texten, Sign in with Apple-namnet, villkor, kontoradering).
- **Inget Android-arbete får ändra iOS-beteendet**; plattformsskillnader via `isNativeIos()` / `isNativeAndroid()` / `isNativeStoreApp()`.
- i18n: lägg ALLA nya nycklar under din egen toppnivå-namnrymd i `messages/sv.json` OCH `messages/en.json` (1 `fsDeck`, 2 `pick2`, 3 `store`, 4 `fsSave`, 5 `pushAsk`, 6 `invite`). Kör `node scripts/check-i18n-keys.mjs`.
- Databas: bara additivt. Ny tabell/kolumn = rå SQL i `prisma/sql/2026-10-15_<namn>.sql` (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`) + additiv ändring i `prisma/schema.prisma` om koden använder Prisma-klienten. Kör inget mot produktionsdatabasen.
- Ny env: dokumentera i din rapport; koden ska fungera säkert utan den.
- Kontroll innan du är klar: `npx tsc --noEmit` (inga nya fel), `npx eslint <dina filer>`, `node scripts/check-i18n-keys.mjs`.
- Committa i din egen gren (`git add -A && git commit`), pusha INTE.
