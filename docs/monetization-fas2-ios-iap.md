# Monetisering – Fas 2 (iOS: Apple IAP + premium-CTA:er + swipegräns)

Byggt på branchen `feature/premium-cta-iap`. Samma IAP-upplägg som AvyraCards:
`@capgo/native-purchases` (StoreKit 2) i appen + server-side-verifiering mot
App Store Server API. **Stripe öppnas aldrig i iOS-appen** (App Store-regel
3.1.1); webben använder Stripe precis som förut.

## Köpflödet per plattform

`lib/premiumPurchase.ts` → `startPremiumPurchase()` är den enda ingången:

- **Native iOS (Capacitor):** hämtar produkt-id från `/api/apple/iap/config`,
  köper via `NativePurchases.purchaseProduct()` och postar `transactionId` till
  `/api/apple/iap/verify`. Servern hämtar transaktionen signerad direkt från
  Apple (production, med sandbox-fallback för TestFlight), validerar produkt-id
  och sätter `plan="premium"`, `subProvider="apple"`, `subStatus="active"`,
  `subCurrentPeriodEnd=<Apples expiresDate>`. Idempotent per transactionId
  (tabellen `apple_iap_transactions`).
- **Webb:** befintlig Stripe Checkout (`/api/stripe/checkout`, plan monthly).

Förnyelser: ingen webhook ännu — `/api/billing/status` gör en "lazy" synk via
App Store Server API:s subscriptions-endpoint när en apple-prenumeration är
inom 12 h från (eller förbi) periodslut. App Store Server Notifications är ett
naturligt nästa steg men krävs inte för korrekt entitlement.

**Återställ köp** (App Store guideline 3.8): "Återställ tidigare köp" på
`/premium` (endast iOS) — `restorePremiumPurchases()` synkar StoreKit, hittar
den aktiva transaktionen för vår produkt och kör samma server-verifiering som
vid köp. Servern ger aldrig premium för utgångna transaktioner eller
transaktioner som hör till ett annat NextWatch-konto (409). Profilens
prenumerationssektion har dessutom "Hantera i App Store"
(`manageSubscriptions()`) på native iOS.

## CTA-ytor (alla → `goPremium()`: iOS = IAP-flöde, webb = /premium)

- Annonsplatshållarkortet i swipe-däcket är tappbart.
- Upsell-popup efter var 3:e annons, max en gång per session
  (`PremiumUpsellModal`, sessionStorage-cap).
- Diskret kron-chip "Premium" uppe till höger i appskalet för gratisanvändare
  (`PremiumBadge`).
- `/premium`-sidan är plattformsmedveten (App Store-text + IAP-knapp på iOS).

## Swipegräns (gratis)

100 swipes per rullande 24 h (`lib/swipeLimit.ts`), premium = obegränsat.
Enforcas server-side i `/api/rate`, `/api/swipe/decide` och `/api/group/vote`
(429 med `error:"swipe_limit"`). `GET /api/swipe/limit` för UI-status.
`SwipeLimitWall` visar väggen i solo- och gruppswipen.

## Databas (krävs före deploy)

```bash
npx prisma db push   # eller kör prisma/sql/2026-07-05_apple_iap.sql manuellt
```

Ny tabell: `apple_iap_transactions`.

## Env-variabler (Vercel)

Se `.env.example` för hela listan. IAP-relevanta:

```
APPLE_IAP_ISSUER_ID=…          # App Store Connect → Users and Access → Integrations → In-App Purchase
APPLE_IAP_KEY_ID=…             # nyckel-id för In-App Purchase-API-nyckeln
APPLE_IAP_PRIVATE_KEY=…        # .p8-innehållet, \n som radbrytningar
APPLE_IAP_PREMIUM_MONTHLY=com.nextwatch.premium.monthly
# valfri: APPLE_IAP_BUNDLE_ID (default com.nextwatch.app)
```

Utan dessa svarar `/api/apple/iap/config` `enabled:false` och iOS-knappen visar
"inte tillgängligt ännu" — inget kraschar.

### Verifiera att produktion är redo

Efter deploy + env i Vercel:

```bash
curl -s https://www.nextwatch.se/api/apple/iap/config
```

Förväntat svar när allt är klart:

```json
{
  "ok": true,
  "enabled": true,
  "products": { "monthly": "com.nextwatch.premium.monthly" },
  "bundleId": "com.nextwatch.app"
}
```

Dev-only: `GET /api/debug/env` visar om IAP-nycklar finns (maskerade, inga hemligheter).

## App Store Connect — checklista

| Steg | Vad | Status |
|------|-----|--------|
| 0–1 | Paid Apps Agreement, bank, skatt | ✅ |
| 2 | In-App Purchase API-nyckel (`.p8` → `ISSUER_ID`, `KEY_ID`, `PRIVATE_KEY`) | ✅ |
| 3 | Prenumerationsgrupp + `com.nextwatch.premium.monthly` @ 19 SEK/mån | ✅ |
| 4 | `APPLE_IAP_*` i Vercel + redeploy | ✅ |
| 5 | `/api/apple/iap/config` → `enabled: true` | ✅ |
| 6 | Skicka in prenumerationen med nästa app-version till App Review | ⏳ vid release |
| 7 | Sandbox-köp / restore på TestFlight (valfritt före submit) | hoppas över |

Detaljer för steg 2–3:

1. **In-App Purchase-API-nyckel**: Users and Access → Integrations →
   In-App Purchase → generera nyckel.
2. **Auto-förnyande prenumeration** på `com.nextwatch.app`:
   - Subscription group: t.ex. "NextWatch Premium".
   - Produkt-id: `com.nextwatch.premium.monthly` (samma konvention som
     AvyraCards: `<domän baklänges>.premium.<period>`).
   - Pris: 19 kr/mån (SEK), 1 månads period.
3. Lokaliserad beskrivning + granskningsinformation — skickas in tillsammans
   med nästa app-version.

Servern hanterar sandbox automatiskt vid TestFlight-köp (fallback i
`lib/appleIap.ts`); manuell sandbox-testning krävs inte för att aktivera IAP i
produktion.

## Nytt iOS-beroende

`@capgo/native-purchases` är tillagt och `npx cap sync ios` är kört
(`NativePurchasesPlugin` i `packageClassList` + `CapgoNativePurchases` i
`CapApp-SPM/Package.swift`). Nästa Appflow-bygge plockar upp det automatiskt.
