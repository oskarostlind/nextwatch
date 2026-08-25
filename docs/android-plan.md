# Android-plan för NextWatch

Status: **PLAN — inget implementerat.** Skriven 2026-08-22.

Beslut tagna med Oskar innan planen skrevs:

- **Betalning:** Google Play Billing (inte Stripe, inte "hänvisa till webben").
- **Distribution:** Google Play Store, med internal testing som första steg.
- **Build:** Android Studio lokalt (Windows fungerar — till skillnad från iOS där Oskar är blind, se `memory/oskar_windows_no_mac.md`).

---

## 0. Utgångsläget — varför det här är mindre jobb än det låter

`capacitor.config.ts` sätter `server.url = "https://www.nextwatch.se"`. iOS-appen är alltså **inte** en bundlad export utan ett WebView-skal runt den hostade Next.js-appen. `webDir: 'www'` är bara en tom fallback för Capacitors copy-steg.

Konsekvensen för Android:

- **Hela UI:t, alla sidor, all routing, i18n, cookies, swipe-däcket, grupper, rekommendationer och API:er följer med gratis.** Ingenting behöver portas, byggas om eller dupliceras.
- Risken för regressioner på webb och iOS är därmed nära noll, eftersom vi inte rör den delade koden — vi *lägger till* grenar.
- Arbetet är i praktiken: **(A)** ett `android/`-skal med rätt native-konfiguration, och **(B)** ~12 filer där `iOS` idag är hårdkodat och behöver bli plattformsmedvetet.

Det finns **ingen testsvit** i projektet. Verifiering blir manuell på emulator + fysisk enhet.

---

## 1. Inventering: exakt vad som är iOS-låst idag

### 1a. Klientkod med plattformsgren

| Fil | Rad(er) | Vad som händer idag | Åtgärd |
|---|---|---|---|
| `lib/premiumPurchase.ts` | 19–25, 111, 181, 199, 209 | `isNativeIos()` är den enda plattformsgrenen; allt icke-iOS faller till Stripe | Introducera `nativePlatform(): "ios" \| "android" \| null`. Android → Play Billing |
| `lib/admobAds.ts` | 142 m.fl. | `if (!isNativeIos()) return false` — hela annonsmotorn död på Android | Byt gate mot `isNativeApp()`; separata ad unit-id:n per plattform |
| `app/components/client/SwipeLimitWall.tsx` | 81 | `offerRewarded = isNativeIos()` → Android får ingen rewarded-video, alltså inga bonus-swipes | Samma gate-byte |
| `app/premium/page.tsx` | 21, 31 | `setOnIos()` styr paywall-copy och success-redirect | Tredje läge: Android/Play |
| `app/profile/ProfileClient.tsx` | 905–907 | Duplicerad, otypad `window.Capacitor`-koll | Ersätt med den delade helpern |
| `app/components/auth/AppleSignInButton.tsx` | 17–20 | `getPlatform() !== "ios"` → visar felet `appleIosOnly` | Se avsnitt 4 (viktigt — inloggningsblockerare) |
| `app/recs/SwipeDeckProvider.tsx` | 29–51 | `isNativePlatform()` stänger av AdSense-kort i native | Korrekt redan; ingen ändring |
| `app/layout.tsx` | AdSense `<Script>` | Får aldrig laddas i WebView | Verifiera att den gaten är `isNativePlatform`, inte iOS-specifik |
| `lib/filmReminders.ts` | 6–12 | `@capacitor/local-notifications`, redan `isNativePlatform()` | Fungerar på Android direkt; kräver `POST_NOTIFICATIONS`-permission (Android 13+) |

### 1b. Serverkod med iOS-antaganden

| Fil | Problem |
|---|---|
| `lib/push.ts` | Skickar **bara** via APNs över HTTP/2. En FCM-token skulle skickas till APNs och tyst dö (och rensas som "stale"). Måste routas på `PushToken.platform`. |
| `app/api/push/register/route.ts` | `platform` defaultar till `"ios"`. Klienten skickar redan `Capacitor.getPlatform()`, så värdet blir rätt — men defaulten är en fälla. |
| `prisma/schema.prisma` → `PushToken` | `platform String @default("ios")` — fungerar, men saknar index för `findMany({ where: { userId } })`-splitten. Ingen migration krävs. |
| `lib/appleIap.ts` + `app/api/apple/iap/*` | Apple-specifikt per design. Android behöver en parallell `lib/googlePlayBilling.ts` + `app/api/google/play/{config,verify}`. Rör inte Apple-koden. |
| `prisma/schema.prisma` → `AppleIapTransaction` | Ny syskonmodell `PlayPurchase` behövs (purchaseToken, productId, orderId, expiryTime, acknowledged). |
| `app/api/user/delete/route.ts` | Avbryter Stripe + återkallar Apple-credential. Behöver även avsluta/void:a en Play-prenumeration (best-effort, får aldrig blockera raderingen). |

### 1c. Native-plugins — Android-status

Alla installerade Capacitor-plugins stödjer Android:

- `@capacitor/app`, `push-notifications`, `local-notifications`, `preferences`, `splash-screen` — ja.
- `@capacitor-community/admob` — ja (kräver eget AdMob-app-id i `AndroidManifest.xml`).
- `@capgo/native-purchases` — ja, Google Play Billing 7.x.
- `@capacitor-community/apple-sign-in` — **iOS-only.** Patchen i `patches/` är iOS/SPM-specifik och är ofarlig för Android-bygget.

**Saknas:** `@capacitor/android` (dev-beroende + `android/`-plattform).

---

## 2. Fasplan

Varje fas är självständigt körbar och lämnar repot i ett fungerande läge. Ingen fas ändrar beteende för webb eller iOS.

### Fas 1 — Skalet (körbar app, ingen monetisering)

**Mål:** en Android-app som startar, laddar `www.nextwatch.se`, och där man kan logga in med e-post och swipa.

1. `npm i -D @capacitor/android` + `npx cap add android` → skapar `android/`.
2. Utöka `capacitor.config.ts` med ett `android`-block. **iOS-blocket rörs inte.** `server.url` är delad och behöver ingen ändring.
3. `AndroidManifest.xml`:
   - `android:usesCleartextTraffic="false"` (matchar `cleartext: false`).
   - Intent-filter för `nextwatch://` (matchar `lib/nativeApp.ts` `APP_DEEP_LINK_SCHEME`).
   - `INTERNET`, `POST_NOTIFICATIONS`.
4. Ikoner/splash via `@capacitor/assets` från `resources/` (samma källor som iOS).
5. `SplashScreen`-konfigen är redan plattformsneutral (`launchAutoHide: false` + `SplashScreenHide.tsx`) — verifiera bara att den svarta bakgrunden gäller även på Android.
6. **Hårdvaru-bakåtknappen** — finns ingen hantering idag. Utan den stänger knappen appen mitt i ett swipe-pass. Ny liten klientkomponent bredvid `AppDeepLinkHandler.tsx` som lyssnar på `App.addListener("backButton")` och gör `history.back()`, eller `App.exitApp()` när man står på en rot-flik.
7. Bygg i Android Studio, kör på emulator + fysisk enhet.

**Verifiering:** logga in, swipa, gruppflöde, byt språk, logga ut. Jämför sida för sida mot iOS.

### Fas 2 — Layout & edge-to-edge (den enda riktiga UI-risken)

Android 15 (targetSdk 35) **tvingar** edge-to-edge — WebView:n renderar bakom status- och navigationsfältet, och på Android 16 finns ingen opt-out kvar. Play kommer kräva targetSdk 35.

Koden använder redan `env(safe-area-inset-*)` på ~10 ställen (`BottomTabs`, `LoginSheet`, `PremiumUpsellModal`, `HintSheet`, `SwipeGestureTour`, `PushRegistration`). Projektet kör Capacitor 8.4.0, alltså över 8.3.2 där insets-rapporteringen på Android blev tillförlitlig.

1. Sätt `viewport-fit=cover` i viewport-metan (verifiera att den redan finns).
2. Gå igenom varje `env(safe-area-inset-*)`-användning på en Android-enhet med gesture-navigation **och** en med 3-knappsnavigation — det är där felen visar sig.
3. Statusfältets ikonfärg (ljus text på svart bakgrund) sätts i Android-temat, inte i CSS.

**Detta är den fas som kan tvinga fram ändringar i delad CSS.** Alla sådana ändringar ska vara additiva (t.ex. större `max()`-clamp), aldrig ett byte som ändrar iOS-utseendet. Skärmdumpsjämförelse iOS före/efter krävs.

### Fas 3 — Push (FCM)

APNs används av `lib/push.ts` idag; Android kräver Firebase Cloud Messaging.

1. Firebase-projekt + `google-services.json` i `android/app/`. **Filen får inte committas okrypterad** — lägg i `.gitignore` och dokumentera var den hämtas.
2. `@capacitor/push-notifications` fungerar oförändrat på klienten; `PushRegistration.tsx` skickar redan `platform: Capacitor.getPlatform()` → `"android"`.
3. Server: ny `lib/fcmPush.ts` som skickar via FCM HTTP v1 (service-account-JWT — `jose` finns redan som beroende, ingen ny dependency).
4. Refaktorera `sendPushToUser` till att dela tokens på `platform` och skicka APNs respektive FCM parallellt. **`lib/push.ts`:s publika API ändras inte**, så alla anropare (`cron/daily-recs`, gruppmatch, vänförfrågningar) är orörda.
5. Stale-token-rensningen måste förstå FCM:s `UNREGISTERED`/`INVALID_ARGUMENT` — annars raderas giltiga tokens.
6. Android 13+ kräver runtime-permission `POST_NOTIFICATIONS`. Den befintliga permission-prompten i `PushRegistration.tsx` (rad 126–151) hanterar detta via samma Capacitor-API.

**Verifiering:** kör `cron/daily-recs` mot ett testkonto med både en iOS- och en Android-token registrerad — båda ska få notisen, ingen ska rensas.

### Fas 4 — Google Play Billing

Spegelbild av Apple-IAP-implementationen, i separata filer.

1. Play Console: prenumeration `nextwatch_premium_monthly` med base plan 19 kr/mån, samt licenstestare.
2. `app/api/google/play/config` — publik produkt-id-endpoint (spegel av `apple/iap/config`).
3. Klient: `lib/premiumPurchase.ts` får en `startPlayPurchase()` vid sidan av `startAppleIapPurchase()`. Samma `@capgo/native-purchases`-API, `PURCHASE_TYPE.SUBS`.
4. Server: `lib/googlePlayBilling.ts` verifierar `purchaseToken` mot **Google Play Developer API** (service account). Kritiskt: plugin:et populerar *inte* `isActive`/`expirationDate` på Android — servern är enda sanningskällan. Kräv `purchaseState === PURCHASED` **och** `acknowledged === true`.
5. **Acknowledgement inom 3 dygn, annars återbetalas köpet automatiskt av Google.** Detta är den vanligaste buggen i Play-integrationer — verify-endpointen måste acknowledga, inte bara läsa.
6. Real-time Developer Notifications (Pub/Sub → webhook) för förnyelse/uppsägning, motsvarande Apple-notifikationerna.
7. Ny Prisma-modell `PlayPurchase`; `npx prisma db push` (inga migrations i projektet).
8. `restorePremiumPurchases()` får en Android-gren.

**Play-policy, motsvarande App Store-genomgången i `memory/appstore_rejection_1.md`:** Play kräver att prenumerationens namn, pris, period och förnyelsevillkor visas vid köptillfället, plus länk till villkor. Copyn i `app/premium/page.tsx` är redan skriven för Apples 3.1.2(c) — den behöver en Android-variant, inte en trimning. **Rör inte Apple-blocket.**

### Fas 5 — AdMob på Android

1. AdMob: skapa Android-app + interstitial- och rewarded-enheter. Nya env: `NEXT_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_ID`, `NEXT_PUBLIC_ADMOB_ANDROID_REWARDED_ID`. Befintliga iOS-env:ar behålls oförändrade.
2. `adId()` i `lib/admobAds.ts` väljer id efter plattform; test-id-fallbacken och `isAdUnitId()`-varningen behålls (den fångade ett riktigt fel en gång).
3. AdMob-app-id i `AndroidManifest.xml` som `com.google.android.gms.ads.APPLICATION_ID`.
4. **ATT finns inte på Android** — hoppa den grenen. UMP/GDPR-formuläret gäller fortfarande och används likadant.
5. `com.google.android.gms.permission.AD_ID` måste deklareras i manifestet **och** i Play Data safety-formuläret.
6. `initAdMobIfEligible()` anropas redan från både `app/swipe/page_client.tsx` och `app/group/swipe/_legacy.tsx` — inget nytt anropsställe behövs.

**Regressionsrisken från `CLAUDE.md` gäller oförändrat:** gruppdäcket får fortfarande **inga** annonskort, bara interstitials. `_legacy.tsx` saknar `kind === "ad"`-gren och skulle posta en gruppröst för `tmdbId: -1`.

### Fas 6 — Play Store-release

1. Trapeze: lägg till ett `android`-block i `appflow.yml` med `versionCode: $CI_BUILD_NUMBER` (samma mönster som iOS `buildNumber`). `appflow:build` är redan plattformsgenerisk via `$CI_PLATFORM`.
2. Signeringsnyckel (keystore) — skapas en gång, **säkerhetskopieras utanför repot**. Tappad keystore = ny app-listning.
3. Play Console: Data safety, målgrupp/innehållsklassning, integritetspolicy-URL, **kontoraderings-URL** (`/api/user/delete`-flödet finns redan, byggt för Apple 5.1.1(v) — Play kräver samma sak).
4. App Links: `assetlinks.json` under `https://www.nextwatch.se/.well-known/` så `nextwatch.se`-länkar öppnar appen.
5. Internal testing → closed testing → produktion.

---

## 3. Ändringar i delad kod — och hur vi håller risken nere

Detta är den enda delen som kan påverka webb/iOS. Regel: **varje ändring är additiv.**

| Ny/ändrad fil | Typ | Risk för iOS/webb |
|---|---|---|
| `lib/nativePlatform.ts` (ny) | `nativePlatform()`, `isNativeApp()`, `isNativeAndroid()` | Ingen — ny fil |
| `lib/premiumPurchase.ts` | `isNativeIos()` **behålls** som wrapper så inga anropare bryts | Ingen om wrappern är exakt ekvivalent |
| `lib/admobAds.ts` | Gate `isNativeIos` → `isNativeApp`; id-val per plattform | Låg — iOS-grenen returnerar samma id:n |
| `lib/push.ts` | Split på `platform`; publika API:t oförändrat | Låg — iOS-tokens går fortfarande till APNs |
| `app/premium/page.tsx` | Tredje copy-variant | **Måste granskas** — App Review-yta |
| Globala CSS/safe-area | Endast om Fas 2 kräver det | **Högst risk** — kräver skärmdumpsjämförelse |
| `capacitor.config.ts` | Nytt `android`-block | Ingen — iOS-blocket orört |

Dessutom: `CLAUDE.md` måste uppdateras i samma commit som varje fas landar. Filen påstår idag att iOS är enda native-plattformen, och den påstådda sanningen är det som styr framtida arbete.

---

## 4. Öppen fråga som måste beslutas före Fas 1: Sign in with Apple-användare

**Problem:** användare som registrerat sig med Sign in with Apple har **inget lösenord**. `@capacitor-community/apple-sign-in` är iOS-only. På Android skulle de alltså inte kunna logga in alls — det är en funktionsförlust, precis det du sa att vi inte får ha.

Tre vägar:

- **A. Web-baserad Sign in with Apple (rekommenderad).** Apple stödjer OAuth i webbläsare/WebView via ett Services ID + `POST`-callback. Kräver ett nytt Services ID i Apple Developer, en ny route `app/api/auth/apple/callback` (form_post), och att `AppleSignInButton` faller tillbaka på redirect-flödet i stället för felmeddelandet `appleIosOnly`. Verifieringen i `lib/appleAuth.ts` återanvänds oförändrad — det är samma identity token.
- **B. "Sätt lösenord"-flöde.** Apple-användare får ett e-postbaserat lösenordsåterställningsflöde. Enklast, men sämre UX och kräver att de har en riktig e-post (Apple private relay fungerar men känns skört).
- **C. Google Sign-In på Android.** Löser inte problemet — det skapar en tredje identitet, inte en väg in i det befintliga kontot.

**Rekommendation: A.** Den bevarar funktionen fullt ut och återanvänder befintlig serverkod. Bör göras som en egen fas mellan 1 och 2.

---

## 5. Vad som är kvar att bekräfta innan implementation

1. **Sign in with Apple-vägen ovan (A/B/C)** — blockerar Fas 1:s definition av "ingen funktion tappad".
2. **Firebase-projekt** — finns inget idag (APNs används direkt utan Firebase). Ett måste skapas.
3. **Google Play Developer-konto** (25 USD engångsavgift) — finns det?
4. **Prisparitet:** 19 kr/mån på Play kräver en egen prissättning per land; Play tar 15 % under första 1 M USD (jämfört med Apples Small Business Program).
5. **Android Studio + JDK 21** installerat på Windows-maskinen.

---

## 6. Grov tidsuppskattning

| Fas | Omfattning |
|---|---|
| 1 — Skalet | Liten. En dag inkl. första lyckade emulator-körningen. |
| Apple-inloggning på webben | Liten–medel. Mest Apple Developer-konfiguration. |
| 2 — Edge-to-edge | Medel. Svårt att tidsätta — beror på hur mycket CSS som spricker. |
| 3 — FCM | Medel. Ny sändarkod + Firebase-setup. |
| 4 — Play Billing | Störst. Server-verifiering, acknowledgement, RTDN-webhook, policy-copy. |
| 5 — AdMob | Liten. Mest konfiguration. |
| 6 — Release | Medel. Play Console-formulären tar tid, inte koden. |

**Snabbaste vägen till något du kan hålla i handen:** Fas 1 ensam. Den ger en fullt fungerande Android-app med hela produkten — bara utan push, annonser och köp. Det är också den bästa validering vi kan få av att remote-WebView-antagandet håller innan vi investerar i faserna 3–6.
