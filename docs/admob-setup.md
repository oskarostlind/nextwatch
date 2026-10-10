# AdMob-intäkter i admin-dashboarden — engångssetup

Admin-dashboarden (`/admin`) visar AdMob-statistik: intäkt idag/7 d/30 d i
intäktsrutan, och under **Annonser** intäkt, visningar, eCPM, fill rate och
klick dag för dag och per annonsformat (7/30/90 d). Koden finns i `lib/admobReport.ts` och aktiveras
av fyra env-varar i Vercel. Saknas de visar dashboarden "Inte uppkopplat" —
inget går sönder.

**Varför så krångligt?** AdMob Reporting API stödjer inte service accounts —
bara OAuth med ett riktigt Google-konto. Därför måste du en (1) gång logga in
med ditt AdMob-konto och generera en refresh token. Den går sedan inte ut så
länge den används (Google återkallar oanvända tokens efter 6 månader).

## Steg 1 — Google Cloud-projekt + aktivera API:t

1. Gå till [console.cloud.google.com](https://console.cloud.google.com), skapa
   ett projekt (t.ex. `nextwatch-admin`) — eller återanvänd ett befintligt.
2. **APIs & Services → Library** → sök "AdMob API" → **Enable**.

## Steg 2 — OAuth-klient

1. **Google Auth Platform** (förr "OAuth consent screen"): typ **External**,
   fyll i namn + din e-post. Under **Branding**: hemsida, integritetspolicy
   (`/legal/privacy`), villkor (`/legal/terms`) och auktoriserad domän
   `nextwatch.se`. Under **Audience**: **Publish app → In production**.
   ⚠️ Lämnas appen i "Testing" går refresh token ut efter **7 dagar** och
   siffrorna slutar komma. Ingen Google-granskning krävs för eget bruk — du
   klickar bara förbi "Google hasn't verified this app" vid godkännandet.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URIs: `https://developers.google.com/oauthplayground`
3. Spara **Client ID** och **Client secret**.

## Steg 3 — generera refresh token (OAuth Playground)

1. Gå till [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground).
2. Kugghjulet uppe till höger → bocka i **Use your own OAuth credentials** →
   klistra in Client ID + Client secret från steg 2.
3. I vänsterspalten, fyll i scope manuellt:
   `https://www.googleapis.com/auth/admob.readonly` → **Authorize APIs**.
4. Logga in med Google-kontot som äger AdMob-kontot, godkänn.
5. **Exchange authorization code for tokens** → kopiera **Refresh token**.

## Steg 4 — publisher-id

AdMob-konsolen ([apps.admob.com](https://apps.admob.com)) → **Inställningar →
Kontoinformation** → Utgivar-id, formatet `pub-XXXXXXXXXXXXXXXX`.

## Steg 5 — env-varar i Vercel

| Variabel | Värde |
|---|---|
| `ADMOB_CLIENT_ID` | Client ID från steg 2 |
| `ADMOB_CLIENT_SECRET` | Client secret från steg 2 |
| `ADMOB_REFRESH_TOKEN` | Refresh token från steg 3 |
| `ADMOB_PUBLISHER_ID` | `pub-XXXXXXXXXXXXXXXX` från steg 4 |

Redeploya. Klart — `/admin` visar nu AdMob-siffrorna (cachas 1 h per
serverinstans, så siffran uppdateras inte oftare än så).

## Felsökning

- **"Inte uppkopplat"** — någon av de fyra env-vararna saknas/är tom.
- **"Hämtar från Google…" som aldrig blir siffror** — kolla Vercel-loggarna
  efter `[admob]`-varningar. Vanligast: fel scope vid steg 3 (måste vara
  `admob.readonly`), eller att refresh token genererades med Playgrounds egna
  credentials i stället för dina (kugghjulet i steg 3.2 missades).
- **`AdMob OAuth 400` efter ungefär en vecka** — OAuth-appen står kvar i
  "Testing". Publicera den (steg 2.1) och gör om steg 3.
- **`AdMob OAuth 400`** — refresh token återkallad (t.ex. lösenordsbyte med
  "logga ut överallt", eller 6 månaders oanvändning). Gör om steg 3.

## Uppsatt 2026-10-10

Google Cloud-projekt **Nextwatch** (`nextwatch-20fb2`), OAuth-klient "NextWatch
admin (AdMob-rapporter)", appen publicerad (In production). Publisher-id
`pub-2616665688666431`.
