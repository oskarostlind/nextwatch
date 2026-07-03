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
npx prisma migrate dev --name <name>
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
`User` (id, email, plan, username, appleSub) is the hub. Related: `Profile` (taste profile — `favoriteGenres`/`dislikedGenres`, `favoriteMovie`/`favoriteShow` as JSON, `providers` as JSON array of service names, region/locale/year preferences), `Rating`, `watchlist` (lowercase model name), `Purchase` (Stripe lifetime), `Verification`, `PushToken`. Social/group graph: `Group` → `GroupMember` / `GroupVote` / `GroupInvite` (5-min TTL via `expiresAt`) / `GroupMatchSeen`, plus `FriendRequest` / `Friendship`. Column names are snake_cased via `@map`.

### Recommendation engine
The canonical recommender pipeline lives in **`lib/unifiedRecs.ts`** (`computeUnifiedRecs`), shared by `app/api/recs/unified/route.ts` (cookie/rate-limit wrapper) and the daily push cron `app/api/cron/daily-recs/route.ts`. Pipeline:
1. Load profile + ratings + watchlist via Prisma. In group mode (`?group=CODE` query param or `nw_group` cookie), also load every member's profile + watchlist.
2. Union the streaming providers (solo, or OR-combined across the whole group), map service names → TMDB provider IDs (`PROVIDER_MAP`), and let TMDB `/discover` do provider filtering server-side (avoids N+1). Group genre preferences are aggregated too (liked = union, disliked = union minus anything anyone likes), and the SE age-certification cap uses the youngest member.
3. **V1 score**: genre match (liked/disliked) + quality (vote avg × log vote count) + recency bonus.
4. **V2 taste model**: fetch keywords + top cast + director/creator for "seeds" (favorite + watchlist items — in group mode, from *all* members, capped at 12), weight them, and score candidates by keyword/people overlap.
5. **MMR diversification** (Jaccard similarity, λ=0.3) for the final ranked list.

`recs/unified` is the only recs route — group swipe (`app/group/swipe/_legacy.tsx`, via `lib/swipeDeckStore.ts`'s `ensureGroupDeck`) calls it with `?group=CODE` instead of using a separate group recommender. The old `recs/group` route (client-side provider intersection, no taste model) was removed as fully superseded. Other older overlapping variants (`recs/route.ts`, `recs/smart`, `recs/personal`, `recs/for-you`, `recs/group-smart`, plus the `_known-filter.ts` helper and the `recs-test`/`group/recs-test` dev pages) were removed earlier (2026-07 dead-code cleanup) as unreferenced. Before extending recommendations, prefer extending `computeUnifiedRecs` rather than adding a new variant.

### Swipe & group match
- Solo swipe: `app/api/swipe/decide/route.ts` writes a `Rating` and, on "like", upserts into `watchlist`. Also `app/api/rate` and `app/api/ratings/save`.
- Group: `app/api/group/*` — active endpoints are `create`, `join`, `leave`, `vote` (alias re-exporting `POST` from `votes/route.ts`), `invite` (+`invite/list`, `invite/respond`), `members`, `match` (+`match/ack`). The orphaned `status`/`info`/`recs`/`profile`/`votes/progress`/`my-friends`/bare `group` routes were removed in the 2026-07 cleanup. Active group is tracked by the `nw_group` cookie. Match resolution (`app/api/group/match/route.ts`) ranks candidates by LIKE count, requires `max(2, ceil(memberCount * 0.6))` likes, and uses `GroupMatchSeen` so an acknowledged match isn't shown again. UI: `app/group/swipe/Client.tsx`, live updates via `lib/useGroupMatch.ts` / `lib/useGroupInvites.ts`.

### TMDB integration
`lib/tmdb.ts` is the typed helper (genre-name→id maps, `discoverByGenres`, poster URLs). ⚠️ **Token conventions are inconsistent** across the codebase: `lib/tmdb.ts` reads `TMDB_READ_TOKEN`/`TMDB_TOKEN`, while `recs/unified` and `group/match` read `TMDB_V4_TOKEN`/`TMDB_API_KEY`. The env file defines `TMDB_V4_TOKEN` + `TMDB_API_KEY`. When adding TMDB calls, match the convention already used by the route you're editing, and consider normalizing.

### Commerce
Stripe **one-time "lifetime" purchase** (not subscription): `app/api/stripe/checkout/route.ts` creates a `mode: "payment"` session tied to `nw_uid` via `client_reference_id`/metadata; `app/api/stripe/webhook/route.ts` fulfils it and flips `User.plan`/`planSince`. Missing `STRIPE_SECRET_KEY` returns 503 instead of crashing. Premium UI under `app/premium/*`, status via `app/api/billing/status`.

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
