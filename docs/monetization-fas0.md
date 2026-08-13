# Monetisering – Fas 0 (kodfundament)

Detta är fundamentet för annonser (gratis) + Premium 19 kr/mån (annonsfritt), byggt för
**både webb (Stripe + AdSense) och iOS (Apple IAP + AdMob via RevenueCat)**.
Fas 0 innehåller allt som inte kräver externa konton. Fas 1 (webb) och Fas 2 (iOS) kopplas på
när konton finns.

## Vad som är gjort i Fas 0

- **Datamodell** (`prisma/schema.prisma`): `User.stripeCustomerId`, `subProvider`, `subStatus`,
  `subCurrentPeriodEnd`. `Profile` fick fem notis-flaggor (`notify*`).
- **Entitlement** (`lib/entitlements.ts`): en sanning för "är premium?" oavsett Stripe/Apple.
  `plan` = `free` | `premium` | `lifetime` (lifetime = grandfathad engångsköpare).
- **`/api/billing/status`**: returnerar nu `isPremium`, `source`, `status`, `renewsAt`.
- **Notiser**: `/api/profile/notifications` (GET/PUT). `lib/push.ts` skippar push som användaren
  stängt av (mappar `payload.data.type` → notis-flagga). Gäller daily-recs, gruppmatch,
  vänförfrågan, gruppinbjudan.
- **Annonser i swipe** (`lib/ads.ts`): vart 10:e kort blir en annons **för gratisanvändare**,
  bakom feature-flaggan `NEXT_PUBLIC_ADS_ENABLED`. `SwipeCard.kind === "ad"` hoppas över i
  betyg/watchlist/gruppröst-logiken. `AdCard` visar AdSense när konfigurerat, annars en platshållare.
  (Solo-däcket. Gruppdäcket lämnas utan annonser tills vidare.)
- **Inställningsflik** i profilen: prenumerationsstatus + Uppgradera/Hantera + notistogglar.
- **Stripe-prenumeration förberedd**: checkout stödjer `mode: "subscription"` (default `monthly`),
  `/api/stripe/portal` för uppsägning, webhook hanterar `customer.subscription.*`.

## Kör detta lokalt (viktigt – gör innan build)

```bash
# 1. Regenerera Prisma-klienten (nya fält)
npx prisma generate

# 2. Applicera schemaändringarna mot databasen (välj en)
npx prisma db push
#   ELLER kör SQL:en manuellt: prisma/sql/2026-07-04_subscriptions_notifications.sql

# 3. Verifiera
npm run lint
npm run build
```

Utan steg 1–2 kommer TypeScript/bygget att klaga på de nya Prisma-fälten.

## Env-variabler

### Fas 0
> ⚠️ **Inaktuellt sedan 2026-08-13.** Annonser är numera PÅ som standard och
> `NEXT_PUBLIC_ADS_ENABLED=0` är kill-switchen (osatt = på). Att flaggan var
> osatt i produktion var precis anledningen till att premium inte gav något.
> Den aktuella sanningen för vad premium gejtar finns i **CLAUDE.md → "What
> Premium actually gates"**.

```
NEXT_PUBLIC_ADS_ENABLED=0              # ENDAST för att stänga av annonser helt
NEXT_PUBLIC_ADSENSE_CLIENT=ca-pub-xxxx…  # osatt = AdSense-scriptet laddas inte alls
NEXT_PUBLIC_ADSENSE_SLOT_SWIPE=xxxx…
FREE_DAILY_SWIPE_LIMIT=100             # osatt = 100. 0 = obegränsat (kill-switch)
NW_FREE_GROUP_MAX_MEMBERS=3            # osatt = 3
NW_PREMIUM_GROUP_MAX_MEMBERS=20        # osatt = 20
```

### Fas 1 – Stripe-prenumeration (webb)
```
STRIPE_SECRET_KEY=sk_live_…            # finns redan om du satt upp lifetime
STRIPE_WEBHOOK_SECRET=whsec_…          # oförändrad – samma webhook-endpoint återanvänds
STRIPE_PRICE_PREMIUM_MONTHLY=price_1TpRniCP5vbtRNgLu2ET9kRD   # NYTT – skapat 2026-07-04
STRIPE_PRICE_LIFETIME=price_…          # (valfritt, om du vill behålla lifetime)
```

**Redan konfigurerat i Stripe (live, konto `acct_1S5VYKCP5vbtRNgL` = nextwatch.se):**
- Produkt **NextWatch Premium** – pris `price_1TpRniCP5vbtRNgLu2ET9kRD` (19,00 kr/mån SEK, moms inklusive).
- Webhook `we_1S5VrjCP5vbtRNgL5xg6acHs` → `https://nextwatch.se/api/stripe/webhook` lyssnar nu på:
  checkout.session.completed, payment_intent.succeeded, customer.subscription.created/updated/deleted.
- Customer Portal aktiverad (`bpc_…`, Standard) – uppsägning vid periodens slut.

**Redan gjort åt dig (2026-07-04):**
- ✅ `STRIPE_PRICE_PREMIUM_MONTHLY=price_1TpRniCP5vbtRNgLu2ET9kRD` tillagd i Vercel (Production + Preview).
- ✅ Databasmigreringen körd mot Neon `production`-branchen (alla nya kolumner finns).
  Notera: jag lade kolumnerna utan den partiella unika indexen på `stripe_customer_id` och
  `sub_current_period_end` som `TIMESTAMP` (inte `TIMESTAMP(3)`). Allt fungerar i drift; kör
  `npx prisma db push` när du ändå deployar så synkas index/precision exakt mot schemat.

**Enda kvarvarande steg för att aktivera Fas 1 (måste göras från din dator):**
```bash
git add -A
git commit -m "feat: prenumeration (19 kr/mån), annonser, notisinställningar (Fas 0)"
git push origin main
```
Det triggar en Vercel-deploy som plockar upp env-variabeln. (Jag kunde inte pusha åt dig:
sandboxen når inte github.com och saknar dina git-uppgifter.)

**Verifiera efter deploy:**
- Att `https://nextwatch.se/api/stripe/webhook` svarar 200 **direkt** (utan redirect till www) —
  Stripe följer inte redirects. Tvingar sajten www? Byt webhook-URL till `www.nextwatch.se/...`.
- Gör ett skarpt testköp (19 kr) och verifiera i Stripe att prenumerationen skapas och att
  `User.plan` blir `premium`. Säg upp direkt i kundportalen efteråt om du vill.

## Kvarvarande steg (kräver dig / inloggning)

**Fas 1 – Webb**
1. Stripe: skapa produkt "NextWatch Premium" + återkommande pris 19 kr/mån (SEK) → `STRIPE_PRICE_PREMIUM_MONTHLY`.
2. Stripe: lägg webhook-endpoint `/api/stripe/webhook` med events `checkout.session.completed`,
   `customer.subscription.created/updated/deleted`.
3. Stripe: aktivera Billing Portal (Settings → Billing → Customer portal).
4. AdSense: ansök (kräver publik sajt + integritetspolicy). När godkänt: lägg AdSense-scriptet i
   root-layouten och sätt `NEXT_PUBLIC_ADSENSE_*`.

**Fas 2 – iOS**
1. RevenueCat-konto → koppla App Store Connect + Stripe för ett gemensamt entitlement.
2. App Store Connect: auto-förnyande prenumeration 19 kr/mån.
3. Capacitor-plugin för RevenueCat (`@revenuecat/purchases-capacitor`) + köpflöde i appen som
   ersätter Stripe-knappen när `Capacitor.getPlatform() === "ios"`.
4. AdMob-plugin (`@capacitor-community/admob`) + ATT-prompt; rendera AdMob i `AdCard` på iOS.
5. Server: endpoint för RevenueCat/App Store Server Notifications → sätt `subProvider="apple"`.

## Viktiga policy-noteringar
- **AdSense får inte visas inuti iOS-appen** (WebView) – där krävs AdMob. AdSense endast på webben.
- **Digitala köp i iOS-appen måste gå via Apple IAP**, inte Stripe. Stripe endast på webben.
