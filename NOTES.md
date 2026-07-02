# NOTES.md — Claude's arbetskarta för NextWatch

> Personlig referensfil (kompletterar `CLAUDE.md`). Snabb orientering + fallgropar
> jag måste komma ihåg innan jag rör koden. Uppdatera vid arkitekturändringar.

## 1. Vad appen är
"Tinder för film & TV" för svenska marknaden. Användare swipar på TMDB-titlar,
solo eller i grupp. En grupp får en **match** när tillräckligt många gillar samma
titel. Appen bygger en smakprofil och rekommenderar filtrerat på användarens (eller
gruppens) streamingtjänster.

- **Stack:** Next.js 15 (App Router, Turbopack) · React 19 · Prisma/Postgres · TMDB API · Stripe (engångs "lifetime") · Capacitor (iOS-wrapper mot live-sajten).
- **Språk:** Kod-kommentarer och UI-copy på **svenska**. Behåll svenska.
- **Ingen testsvit.** Inget `test`-script, inga testfiler. Verifiera manuellt / via `npm run build` + `lint`.
- **Domän:** `www.nextwatch.se`. iOS = WebView mot den hostade sajten (`capacitor.config.ts` → `server.url`), INTE statisk export.

## 2. Kommandon
```bash
npm run dev            # dev (Turbopack)
npm run build          # prod-build (Turbopack)
npm run lint           # eslint
npx prisma generate    # körs på postinstall
npx prisma migrate dev --name <namn>
npx prisma studio
npm run bump:ios       # ENDAST lokal iOS-testning, ej före Appflow-build
```
`postinstall` = `prisma generate` + `patch-package` (Capacitor apple-sign-in-patch).

## 3. Auth & sessions — hemmabyggt, INTE NextAuth
Trots `NEXTAUTH_SECRET` finns ingen NextAuth. Session = httpOnly-cookie.
- `nw_uid` = identitetscookie (1 år, 30 dagar om `remember===false`). Sätts/rensas via `lib/auth.ts` (`attachSessionCookies`, `sessionRedirect`, `clearAuthCookies`). Cookie-optioner i `lib/cookies.ts` (**hålls import-fri** för att undvika Turbopack-exportbugg — rör inte det).
- `middleware.ts` stämplar `nw_uid`, `nw_region`, `nw_locale` på **varje** request (även anonyma). Region från `x-vercel-ip-country`, locale från `accept-language` (default `SE`/`sv-SE`). Rewrites `/api/profile/get → /api/profile`. **Ingen route-skydd här** — sidor/layouts kollar session själva.
- Credential-flöden: `app/api/auth/*` — `register`, `login`, `logout`, `verify` + `request-verify`, `forgot` + `reset`, `apple` (verifieras i `lib/appleAuth.ts`). Lösenord: `lib/hash.ts` (bcryptjs). E-post: `lib/email.ts` (nodemailer/SMTP).
- **Mönster i API-routes:** `const uid = (await cookies()).get("nw_uid")?.value;` → 401 om saknas. Det finns **ingen** delad `getSession()` — följ inline-mönstret.

## 4. Datamodell (`prisma/schema.prisma`, Postgres, snake_case via `@map`)
`User` (id, email, plan, username, appleSub) är navet.
- `Profile` — smakprofil: `favoriteGenres`/`dislikedGenres` (String[]), `favoriteMovie`/`favoriteShow` (JSON), `providers` (JSON-array av tjänstenamn), region/locale/`yearPreference`, `recycleAfterDays`.
- `Rating` — swipe/betyg (`decision`, `rating`, unik på `userId+tmdbId+mediaType`).
- `watchlist` — **lowercase modellnamn**. Unik på `userId+tmdbId+mediaType`.
- `Purchase` — Stripe lifetime.
- `Verification`, `PushToken`.
- Grupp: `Group`(PK=`code`) → `GroupMember` / `GroupVote` / `GroupInvite`(5-min TTL via `expiresAt`) / `GroupMatchSeen`.
- Vänner: `FriendRequest` / `Friendship`.
- **Prisma-regler:** undvik N+1 (`include`/`select`), bounda listor med `where`/`take`, kolla `@@index` före tunga queries. `lib/prisma.ts` är enda DB-lagret.

## 5. Rekommendationsmotor
**Kanonisk = `app/api/recs/unified/route.ts`.** Pipeline:
1. Ladda profil + ratings + watchlist (+ gruppmedlemmar om `nw_group`-cookie) via Prisma.
2. Unionera providers (solo, eller OR över gruppen), mappa namn→TMDB-id (`PROVIDER_MAP` i filen), låt TMDB `/discover` filtrera server-side (undviker N+1).
3. **V1-score:** genre-match + kvalitet (vote_avg × log vote_count) + recency-bonus.
4. **V2 smakmodell:** keywords + top cast + regissör/skapare för favoriter/watchlist-"seeds", viktat, scorar kandidater på overlap.
5. **MMR-diversifiering** (Jaccard, λ=0.3) för slutlig ranking.
- Klient-hook: `app/recs/useUnifiedRecs.ts`.
- **Efter dead-code-städning (2026-07) finns bara två recs-routes kvar:** `recs/unified` (kanonisk) och `recs/group` (används av aktiva `group/swipe/_legacy.tsx`). Borttagna: `recs/route.ts`, `recs/smart`, `recs/personal`, `recs/for-you`, `recs/group-smart`, `_known-filter.ts` + test-sidorna `recs-test`/`group/recs-test`. Konsolidera mot `unified` istället för nya varianter.

## 6. Swipe & gruppmatch
- **Solo:** `app/api/swipe/decide/route.ts` skriver `Rating`, upsertar `watchlist` på "like". Även `app/api/rate` och `app/api/ratings/save`.
- **Grupp:** aktiva endpoints = `create`, `join`, `leave`, `vote` (alias → `votes/route.ts`), `invite`(+`list`/`respond`), `members`, `match`(+`ack`). Aktiv grupp via `nw_group`-cookie. ⚠️ `group/vote` **importerar** `POST` från `group/votes/route.ts` — ta aldrig bort `votes` utan att fixa aliaset. Borttagna orphans (2026-07): `status`/`info`/`recs`/`profile`/`votes/progress`/`my-friends`/bare `group`.
- **Matchupplösning** (`app/api/group/match/route.ts`): rankar på LIKE-count, kräver `max(2, ceil(memberCount * 0.6))` likes, `GroupMatchSeen` hindrar återvisning.
- UI: `app/group/swipe/Client.tsx`. Live: `lib/useGroupMatch.ts` / `lib/useGroupInvites.ts`.

## 7. TMDB
- `lib/tmdb.ts` = typad helper (genre-namn→id, `discoverByGenres`, poster-URL).
- ⚠️ **Inkonsekventa token-konventioner:** `lib/tmdb.ts` läser `TMDB_READ_TOKEN`/`TMDB_TOKEN`; `recs/unified` + `group/match` läser `TMDB_V4_TOKEN`/`TMDB_API_KEY`. `.env` definierar `TMDB_V4_TOKEN` + `TMDB_API_KEY`. **Matcha routens befintliga konvention** när jag lägger till TMDB-anrop.

## 8. Commerce (Stripe)
Engångs "lifetime" (`mode: "payment"`, INTE subscription).
- `app/api/stripe/checkout/route.ts` — knyter till `nw_uid` via `client_reference_id`/metadata.
- `app/api/stripe/webhook/route.ts` — fulfillar, flippar `User.plan`/`planSince`.
- Saknas `STRIPE_SECRET_KEY` → 503 istället för krasch. UI: `app/premium/*`. Status: `app/api/billing/status`.

## 9. Push & iOS/Capacitor
- Push-tokens registreras klient-side (`app/components/client/PushRegistration.tsx`), lagras via `app/api/push/register` i `PushToken`. Sändning: `lib/push.ts`.
- **iOS build-nummer auto-bumpas av Appflow** (Trapeze läser `CI_BUILD_NUMBER` i `appflow:build`) — bumpa INTE manuellt före varje build. `npm run bump:ios` = endast lokal test.
- Nyckelfiler: `ios/App/App/App.entitlements` (Sign in with Apple), `appflow.yml`, `patches/@capacitor-community+apple-sign-in+7.1.0.patch`. App ID: `com.nextwatch.app`.
- `www/index.html` = bara lokal fallback för Capacitors copy-steg.

## 10. Rate limiting
`lib/rateLimit.ts` = **in-memory, per-instans** (ej Redis/KV) — funkar för single-instance, håller ej över serverless-instanser. På tunga endpoints (`recs`, `group/match`, auth). Konstanter: `RECS_LIMIT`, `MATCH_LIMIT`, `AUTH_LIMIT`. Nyckel = `nw_uid`, fallback IP.

## 11. Route-/fil-struktur & fallgropar
- `app/api/**` — route-handlers grupperade per domän (auth, profile, recs, group, friends, swipe, ratings, watchlist, tmdb, stripe, push, billing, cron, debug).
- `app/api/debug/**` — dev-diagnostik (db, tmdb, smtp, providers, discover-filter, whoami, env). Ej user-facing.
- `app/api/cron/cleanup` — schemalagd städning, vaktad av `CRON_SECRET`.
- Sidor: `page.tsx` (landing), `onboarding`, `swipe`, `group` (+`group/swipe`, `group/match`), `discover`, `watchlist`, `profile`, `premium`, `auth/*`.
- ⚠️ **Dubblettvarianter — kolla vad som faktiskt importeras före edit:** `**/_legacy.tsx`, `**/page_client.tsx`, `**/client.tsx`. OBS: `app/swipe/` använder `page_client.tsx` (INTE `Client.tsx`, borttagen), medan `app/group/swipe/` använder `Client.tsx` som renderar sin aktiva `_legacy.tsx`. Borttagna orphan-dubbletter (2026-07): `swipe/Client.tsx`, `swipe/_legacy.tsx`, `swipe/MatchOverlayMount.tsx`, `profile/page_client.tsx`, `auth/verify/verify-client.tsx`.
- README.md:s filträd är **stalt** — använd faktiska `app/`-trädet.

## 12. Build-caveats
- `next dev`/`build` = **Turbopack**.
- `lib/cookies.ts` undviker `next/server`-imports specifikt för att kringgå Turbopack-exportproblem — **håll den dependency-fri**.
- Plattform: Windows (win32), PowerShell primärt. Prisma-modellnamn `watchlist` är gemener.

## 13. Att göra INNAN jag rör recs eller TMDB
1. Greppa anropare (`useUnifiedRecs.ts` och övriga hooks) för att veta vilken route som faktiskt används.
2. Matcha TMDB-token-konvention efter routen jag editerar.
3. Föredra konsolidering mot `unified` framför nya varianter.
4. Verifiera med `npm run build` + `npm run lint` (ingen testsvit finns).
