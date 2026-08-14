# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

NextWatch (package name `nextwatch`) is a Swedish-market "Tinder for movies & TV" app built on **Next.js 15 (App Router, Turbopack)** with **React 19**. Users swipe on TMDB titles — solo or in a group — and a group **match** unlocks when enough members like the same title. The app tracks each user's watchlist and ratings, builds a personal taste model, and recommends titles filtered by the streaming services the user (or group) actually has. The web app is also wrapped natively for iOS via Capacitor.

Code comments and most UI copy are in **Swedish**. Some files keep historical "why" comments explaining non-obvious workarounds (e.g. Turbopack export quirks in `lib/cookies.ts`) — read them.

## Commands

```bash
npm run dev              # Next.js dev server (Turbopack)
npm run build            # production build (Turbopack)
npm run start            # start production server
npm run lint             # eslint
npm run bump:ios         # bump iOS CURRENT_PROJECT_VERSION (local/manual only — see below)
npm run appflow:build    # Appflow CI: Trapeze sets build number, then next build

# Prisma
npx prisma generate      # runs automatically on postinstall
npx prisma db push       # how schema changes are applied — there is NO prisma/migrations dir
npx prisma studio
```

There is **no test suite** in this project — no test script and no test files.

`postinstall` runs `prisma generate` + `patch-package` (applies `patches/@capacitor-community+apple-sign-in+7.1.0.patch` for Capacitor 8 SPM compatibility).

## Architecture

### Auth & sessions (home-grown, NOT NextAuth)
Despite a `NEXTAUTH_SECRET` env var, there is **no NextAuth**. Sessions are a plain httpOnly cookie:
- `nw_uid` is the identity cookie (1 year, or 30 days if `remember === false`), set/cleared via helpers in `lib/auth.ts` (`attachSessionCookies`, `sessionRedirect`, `clearAuthCookies`). Cookie options come from `lib/cookies.ts` (kept import-free to dodge a Turbopack export issue).
- `middleware.ts` stamps `nw_uid`, `nw_region`, `nw_locale` on **every** request (including anonymous visitors) — region from `x-vercel-ip-country`, locale from `accept-language` (defaults `SE` / `sv-SE`). It also rewrites `/api/profile/get → /api/profile` for back-compat. Route protection is NOT done here — pages/layouts check the session themselves.
- Real credential flows live under `app/api/auth/*`: `register`, `login`, `logout`, `verify` + `request-verify` (email verification), `forgot` + `reset` (password reset), `apple` (Sign in with Apple, verified in `lib/appleAuth.ts`). Passwords hashed in `lib/hash.ts` (bcryptjs), email via `lib/email.ts` (nodemailer/SMTP).

Most API routes read `const uid = (await cookies()).get("nw_uid")?.value` and return 401 if missing — there is no shared `getSession()` helper, so follow the existing inline pattern.

### Data model (`prisma/schema.prisma`, Postgres)
`User` (id, email, plan, username, appleSub, `appleRefreshToken` for TN3194 revocation, `termsAcceptedAt` for guideline 1.2) is the hub. Related: `Profile` (taste profile — `favoriteGenres`/`dislikedGenres`, `favoriteMovie`/`favoriteShow` as JSON, `providers` as JSON array of service names, region/locale/year preferences), `Rating`, `watchlist` (lowercase model name), `Purchase` (Stripe), `AppleIapTransaction` (App Store subscriptions), `Verification`, `PushToken`. Social/group graph: `Group` → `GroupMember` / `GroupVote` / `GroupInvite` (5-min TTL via `expiresAt`) / `GroupMatchSeen`, plus `FriendRequest` / `Friendship`. Column names are snake_cased via `@map`.

### Recommendation engine
The canonical recommender pipeline lives in **`lib/unifiedRecs.ts`** (`computeUnifiedRecs`), shared by `app/api/recs/unified/route.ts` (cookie/rate-limit wrapper) and the daily push cron `app/api/cron/daily-recs/route.ts`. Rebuilt 2026-08-14 after a benchmark showed 55 % of the deck was recycled dislikes — read **`docs/recs-benchmark-2026-08-14.md`** before touching scoring. Pipeline:
1. Load profile + ratings + watchlist via Prisma. In group mode (`?group=CODE` query param or `nw_group` cookie), also load every member's profile + watchlist. Behavioral genre stats (`profiles.genre_stats`, maintained by `lib/genreStats.ts` — **raw SQL on purpose**, see that file) load in parallel.
2. Union the streaming providers (solo, or OR-combined across the whole group), map service names → TMDB provider IDs (`PROVIDER_MAP`), and let TMDB `/discover` do provider filtering server-side (avoids N+1). Group genre preferences are aggregated too, and the SE age-certification cap uses the youngest member. If the popularity scan yields < 40 unseen candidates (heavy swipers exhaust the popular head), taste-directed discover passes run: top behavioral genres sorted by rating + top taste keywords sorted by votes.
3. **V1 score**: declared genre match blended against *behavioral* genre score (declared fades to 55 % as `genre_stats` grows), Bayesian-smoothed quality (prior 6.5/250 votes) + recency bonus, minus a recycle penalty (−2.5, 1-year half-life) for previously disliked titles. Hard gates: quality floor (≥50 votes & < 5.8 dropped) and a kids heuristic (Kids genre, or Animation∧Family) when `showKidsContent` is off.
4. **V2 taste model** (`lib/tasteModel.ts` `buildSeeds`): seeds = favorites (1.6) + ratings (10→1.5 … like→0.7) + watchlist (0.6), capped at 24 positive + 12 negative (group 30+10), recency tiebreak. Candidates scored by keyword/people overlap; movies in a TMDB collection where the user disliked/rated ≤6 any part get a −1.8 franchise penalty.
5. **MMR diversification** (Jaccard similarity, λ=0.3) with a 20 % cap on recycled titles in the final deck.

Ratings writers (`swipe/decide`, `rate`, `ratings/save`) fire-and-forget `recordSwipeGenres` to keep `genre_stats` current; `scripts/backfill-genre-stats.mjs` rebuilds it from history (already run for all users 2026-08-14).

`recs/unified` is the only recs route — group swipe (`app/group/swipe/_legacy.tsx`, via `lib/swipeDeckStore.ts`'s `ensureGroupDeck`) calls it with `?group=CODE` instead of using a separate group recommender. The old `recs/group` route (client-side provider intersection, no taste model) was removed as fully superseded. Other older overlapping variants (`recs/route.ts`, `recs/smart`, `recs/personal`, `recs/for-you`, `recs/group-smart`, plus the `_known-filter.ts` helper and the `recs-test`/`group/recs-test` dev pages) were removed earlier (2026-07 dead-code cleanup) as unreferenced. Before extending recommendations, prefer extending `computeUnifiedRecs` rather than adding a new variant.

### Swipe & group match
- Solo swipe: `app/api/swipe/decide/route.ts` writes a `Rating` and, on "like", upserts into `watchlist`. Also `app/api/rate` and `app/api/ratings/save`.
- Group: `app/api/group/*` — active endpoints are `create`, `join`, `leave`, `vote` (alias re-exporting `POST` from `votes/route.ts`), `invite` (+`invite/list`, `invite/respond`), `members`, `match` (+`match/ack`). The orphaned `status`/`info`/`recs`/`profile`/`votes/progress`/`my-friends`/bare `group` routes were removed in the 2026-07 cleanup. Active group is tracked by the `nw_group` cookie. Match resolution (`app/api/group/match/route.ts`) ranks candidates by LIKE count, requires `max(2, ceil(memberCount * 0.6))` likes, and uses `GroupMatchSeen` so an acknowledged match isn't shown again. UI: `app/group/swipe/Client.tsx`, live updates via `lib/useGroupMatch.ts` / `lib/useGroupInvites.ts`.

### TMDB integration
`lib/tmdb.ts` is the typed helper (genre-name→id maps, `discoverByGenres`, poster URLs). ⚠️ **Token conventions are inconsistent** across the codebase: `lib/tmdb.ts` reads `TMDB_READ_TOKEN`/`TMDB_TOKEN`, while `recs/unified` and `group/match` read `TMDB_V4_TOKEN`/`TMDB_API_KEY`. The env file defines `TMDB_V4_TOKEN` + `TMDB_API_KEY`. When adding TMDB calls, match the convention already used by the route you're editing, and consider normalizing.

### Språk / i18n (next-intl, cookie-baserat — INGEN URL-routing)
Appen finns på **svenska och engelska**. `next-intl` körs i läget *without i18n routing*: adresserna förblir `/swipe`, `/profile`, … och språket kommer från cookien **`nw_lang`**. Skälet är Capacitor — iOS laddar `www.nextwatch.se` och djuplänkar/push/App Store-länkar pekar på befintliga sökvägar, så ett `/en`-prefix hade krävt native-ändringar och därmed en ny Appflow-build. Att lägga till `next-intl` gjorde det inte: det är ett rent webb-beroende.

- **Konfig:** `i18n/request.ts` (läser cookien; ett explicit `locale` vinner alltid — det är så e-post och push renderas på *mottagarens* språk från cronen), `next.config.ts` wrappas med `createNextIntlPlugin`, `NextIntlClientProvider` sitter i `app/layout.tsx`.
- **Ordlistor:** `messages/sv.json` + `messages/en.json`. Nyckeluppsättningarna måste vara identiska — `node scripts/check-i18n-keys.mjs` verifierar att varje `t("…")` i koden finns i BÅDA filerna och körs lämpligen före commit.
- **Källan till språket:** `lib/i18nConfig.ts` är avsiktligt import-fri (samma skäl som `lib/cookies.ts`) och delas av middleware, server och klient. Klientsidan: `lib/uiLanguage.ts`. Serversidan: `lib/serverLocale.ts`. TMDB: `lib/tmdbLanguage.ts`.
- **Byte av språk** sker i profilen och slår igenom direkt (cookie → `router.refresh()`), persisteras till `Profile.uiLanguage` via `app/api/profile/language`, och sätts på cookien igen vid inloggning (`attachUiLanguageCookie` i `lib/auth.ts`) så valet följer med till nya enheter. Klientcachen rensas vid bytet — annars ligger TMDB-titlar kvar på gamla språket tills deras TTL löper ut.
- **Region ≠ språk.** `nw_region`/`nw_locale` styr fortfarande watch-providers och den svenska åldersgränsen. Bara `nw_lang` styr språket. Byt aldrig region utifrån språkvalet — då ändras *innehållet* i rekommendationerna, inte bara texten.
- **Identitet vs. etikett:** genrer (`GROUP_GENRES`), sub-genrer (`SUBGENRES`), anmälningsskäl och avatar-id:n är SVENSKA STRÄNGAR som fungerar som identitet (de sparas i DB och slår upp konfiguration). De översätts bara vid rendering — nycklarna i `messages/*.json` ÄR den svenska texten. Byt aldrig ut dem mot engelska i koden.
- **Konsekvens att känna till:** eftersom språket läses ur en cookie renderas sidorna dynamiskt i stället för statiskt. Flikbyten serveras fortfarande ur router-cachen (`experimental.staleTimes`), så navigeringen påverkas inte — det är första laddningen som går via servern.
- `scripts/apply-i18n.mjs` är engångsverktyget som flyttade copyn till ordlistorna (det maskerar kommentarer så de inte skrivs sönder). Behövs normalt inte igen.

### Commerce
Premium is an **auto-renewable monthly subscription** (19 kr/mån), sold through two different rails depending on platform — `lib/premiumPurchase.ts` picks the right one via `isNativeIos()`:
- **iOS: Apple IAP / StoreKit** (required by guideline 3.1.1 — never route an iOS purchase through Stripe). `@capgo/native-purchases` buys the product id from `app/api/apple/iap/config`, the transaction is verified server-side in `lib/appleIap.ts` (App Store Server API, `APPLE_IAP_*` env) via `app/api/apple/iap/verify`. `restorePremiumPurchases()` backs the mandatory "Återställ tidigare köp" button.
- **Web: Stripe subscription.** `app/api/stripe/checkout/route.ts` + `app/api/stripe/webhook/route.ts` flip `User.plan`/`planSince`. Missing `STRIPE_SECRET_KEY` returns 503 instead of crashing.

`STRIPE_PRICE_LIFETIME` still exists in the env but is legacy — the live product is `STRIPE_PRICE_PREMIUM_MONTHLY`. Premium UI under `app/premium/*`, entitlement checks in `lib/entitlements.ts`, status via `app/api/billing/status`.

⚠️ The paywall copy in `app/premium/page.tsx` is **App Review surface area**, not decoration: guideline 3.1.2(c) requires the subscription name, price, period, auto-renewal wording and working links to the Apple EULA + privacy policy at the point of purchase. Build 27 was rejected for missing exactly this. Don't trim that block.

### What Premium actually gates (reviewed 2026-08-13)
Until 2026-08-13 every one of these was inert and premium bought nothing — the flags existed but were all switched off, so free and paid were identical. **Each bullet on `/premium` must map to a live gate below; if you disable a gate, change the copy in the same commit.**

| Gate | Free | Premium | Where |
|---|---|---|---|
| Ads | interstitial every 15 swipes (iOS, solo **and** group), ad card every 10th (web, solo only) | none | `lib/ads.ts`, `lib/admobAds.ts` |
| Daily swipes | 100 / rolling 24 h | unlimited | `lib/swipeLimit.ts` |
| Group size | 3 members | 20 members | `lib/groupLimits.ts` |
| Taste profile | upsell | full panel | `lib/tasteFeature.ts` |

- **Ads are on by default.** `adsFeatureEnabled()` returns true unless `NEXT_PUBLIC_ADS_ENABLED=0` — an unset env must never silently make the app free-for-all again (that's the bug this table documents). On iOS, `initAdMobIfEligible()` **must** be called before `registerSwipeForAds()` does anything; it's invoked on mount from *both* `app/swipe/page_client.tsx` and `app/group/swipe/_legacy.tsx`. Before that call existed, `initAdMobIfEligible()` had no caller reachable from app code at all (its only caller was `watchRewardedForAdFree`, which was itself gated behind `initialized`) — so live AdMob keys produced zero ads. The AdSense `<Script>` in `app/layout.tsx` additionally requires a configured `NEXT_PUBLIC_ADSENSE_CLIENT` — AdSense rejected the site, and the script must never load inside the iOS WebView.
- **The group deck carries no ad cards** — only interstitials. `withAdsMaybe` is applied to the solo fetch only; `_legacy.tsx` has no `kind === "ad"` branch, so an injected ad card would render as a broken title and post a group vote for `tmdbId: -1`. Add that branch to every one of `handleLike`/`handleDislike`/`handleSeen`/`sendVote`/undo before ever enabling ad cards in group mode.
- **Group caps follow the group's creator, not the joiner** — a paying host lifts the whole party. Enforced on all three entry points: `group/join`, `group/invite` (fails early, at send time) and `group/invite/respond`. Existing over-cap groups are never pruned; only new joins are blocked.
- The swipe limit is enforced server-side on `/api/rate`, `/api/swipe/decide` and `/api/group/vote` (429 + `error:"swipe_limit"`), so it can't be bypassed from the client.
- Tuning without a deploy: `FREE_DAILY_SWIPE_LIMIT`, `NW_FREE_GROUP_MAX_MEMBERS`, `NW_PREMIUM_GROUP_MAX_MEMBERS`. `FREE_DAILY_SWIPE_LIMIT=0` explicitly means unlimited (kill switch); *unset* means the 100 default.

### App Store compliance (don't regress these)
Three behaviours exist because App Review demanded them — see `.cursor/skills/` and the git history before changing them:
- **Guideline 4 (Sign in with Apple):** `AppleSignInButton` forwards `givenName`/`familyName` (Apple sends them only on the *first* authorization) and `authorizationCode` to `app/api/auth/apple`, which stores the name as `Profile.displayName` or hands it to onboarding via the short-lived `nw_apple_name` cookie. The onboarding display-name field is deliberately **optional and pre-filled** — never make it required again.
- **Guideline 1.2 (UGC):** friends/group members can be both blocked (`app/api/friends/block`) and reported (`app/api/report`, mails support via `sendReportMail` and blocks by default). Onboarding and registration require an explicit terms checkbox, stored as `User.termsAcceptedAt`; `app/api/auth/register` rejects a signup without it.
- **Guideline 5.1.1(v) / Apple TN3194:** `app/api/user/delete` cancels Stripe *and* revokes the Sign in with Apple credential (`revokeAppleToken` in `lib/appleAuth.ts`, using the refresh token stored in `User.appleRefreshToken`). Both are best-effort — a failure must never block the deletion itself. Needs `APPLE_TEAM_ID`, `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_PRIVATE_KEY`; without them the revoke degrades to a logged warning.

### Push notifications & iOS / Capacitor
The Next.js app is deployed to the web (`www.nextwatch.se`) and loaded inside a native iOS shell via Capacitor — `capacitor.config.ts` sets `server.url` to the live site, so **iOS is a WebView wrapper, not a static bundle** (the app can't be statically exported; it needs API routes/middleware/cookies). `www/index.html` is only a required local fallback for Capacitor's copy step. Push tokens are registered client-side (`app/components/client/PushRegistration.tsx`) and stored via `app/api/push/register` in `PushToken`; server sending logic in `lib/push.ts`.

**iOS build numbers are auto-bumped by Appflow** (Trapeze reads `CI_BUILD_NUMBER` in `appflow:build`) — do NOT manually bump before every build. `npm run bump:ios` is only for local, non-Appflow testing. Full details in `.cursor/skills/ios-appflow-build/SKILL.md`. Key iOS files: `ios/App/App/App.entitlements` (Sign in with Apple), `appflow.yml`, `patches/@capacitor-community+apple-sign-in+7.1.0.patch`. App ID: `com.nextwatch.app`.

### Rate limiting
`lib/rateLimit.ts` is an **in-memory, per-instance** limiter (not Redis/KV) — fine for single-instance but does not hold across serverless instances. Used on heavy endpoints (`recs`, `group/match`). Constants: `RECS_LIMIT`, `MATCH_LIMIT`, `AUTH_LIMIT`. Key is `nw_uid`, falling back to IP.

### Route structure
- `app/api/**` — App Router `route.ts` handlers grouped by domain (`auth`, `profile`, `recs`, `group`, `friends`, `swipe`, `ratings`, `watchlist`, `tmdb`, `stripe`, `push`, `billing`, `cron`, `debug`).
- `app/api/debug/**` — dev-only diagnostics (db, tmdb, smtp, providers, discover-filter, whoami, env). Not user-facing.
- `app/api/cron/cleanup` — scheduled cleanup, guarded by `CRON_SECRET`.
- Pages: `app/page.tsx` (landing), `onboarding`, `swipe`, `group` (+ `group/swipe`, `group/match`), `discover`, `watchlist`, `profile`, `premium`, `auth/*`.
- Components: `app/components/**` (auth, navigation, onboarding, ui, layouts, watch, panels). Shared client hooks in `lib/*` and `app/recs/`.
- `**/_legacy.tsx` and `**/page_client.tsx` — older or split-out client variants; check which is actually imported before editing.

### Data access
Prisma (`lib/prisma.ts`) is the sole DB layer. Guidelines followed throughout:
- Avoid N+1 — use `findMany` with `include`/`select` and let TMDB `/discover` filter by provider server-side (see `recs/unified`).
- Always bound growable lists with `where`/`take`.
- Check `prisma/schema.prisma` `@@index` before adding heavy queries.

### Build config caveats
- `next dev`/`next build` use **Turbopack**. `lib/cookies.ts` avoids `next/server` imports specifically to sidestep a Turbopack export problem — keep it dependency-free.
- README.md's file tree is **stale** — use the actual `app/` tree as the source of truth.
