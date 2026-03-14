This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

```
nextwatch
├─ app
│  ├─ api
│  │  ├─ auth
│  │  │  ├─ login
│  │  │  │  └─ route.ts
│  │  │  ├─ logout
│  │  │  │  └─ route.ts
│  │  │  ├─ register
│  │  │  │  └─ route.ts
│  │  │  ├─ request-verify
│  │  │  │  └─ route.ts
│  │  │  ├─ signup
│  │  │  │  └─ page.tsx
│  │  │  └─ verify
│  │  │     └─ route.ts
│  │  ├─ billing
│  │  │  └─ status
│  │  │     └─ route.ts
│  │  ├─ cron
│  │  │  └─ cleanup
│  │  │     └─ route.ts
│  │  ├─ debug
│  │  │  ├─ cert-filter
│  │  │  │  └─ route.ts
│  │  │  ├─ db
│  │  │  │  └─ route.ts
│  │  │  ├─ db-ping
│  │  │  │  └─ route.ts
│  │  │  ├─ discover-filter
│  │  │  │  └─ route.ts
│  │  │  ├─ discover-smart
│  │  │  │  └─ route.ts
│  │  │  ├─ email
│  │  │  │  └─ route.ts
│  │  │  ├─ env
│  │  │  │  └─ route.ts
│  │  │  ├─ group-members
│  │  │  │  └─ route.ts
│  │  │  ├─ group-ratings
│  │  │  │  └─ route.ts
│  │  │  ├─ providers
│  │  │  │  ├─ list
│  │  │  │  │  └─ route.ts
│  │  │  │  └─ route.ts
│  │  │  ├─ smtp
│  │  │  │  └─ route.ts
│  │  │  ├─ tmdb
│  │  │  │  └─ route.ts
│  │  │  └─ whoami
│  │  │     └─ route.ts
│  │  ├─ friends
│  │  │  ├─ accept
│  │  │  │  └─ route.ts
│  │  │  ├─ list
│  │  │  │  └─ route.ts
│  │  │  ├─ request
│  │  │  │  └─ route.ts
│  │  │  └─ search
│  │  │     └─ route.ts
│  │  ├─ group
│  │  │  ├─ create
│  │  │  │  └─ route.ts
│  │  │  ├─ info
│  │  │  │  └─ route.ts
│  │  │  ├─ invite
│  │  │  │  ├─ list
│  │  │  │  │  └─ route.ts
│  │  │  │  ├─ respond
│  │  │  │  │  └─ route.ts
│  │  │  │  └─ route.ts
│  │  │  ├─ join
│  │  │  │  └─ route.ts
│  │  │  ├─ leave
│  │  │  │  └─ route.ts
│  │  │  ├─ match
│  │  │  │  ├─ ack
│  │  │  │  │  └─ route.ts
│  │  │  │  └─ route.ts
│  │  │  ├─ members
│  │  │  │  └─ route.ts
│  │  │  ├─ my-friends
│  │  │  │  └─ route.ts
│  │  │  ├─ profile
│  │  │  │  └─ route.ts
│  │  │  ├─ recs
│  │  │  │  └─ route.ts
│  │  │  ├─ route.ts
│  │  │  ├─ status
│  │  │  │  └─ route.ts
│  │  │  ├─ vote
│  │  │  │  └─ route.ts
│  │  │  └─ votes
│  │  │     ├─ progress
│  │  │     │  └─ route.ts
│  │  │     └─ route.ts
│  │  ├─ profile
│  │  │  ├─ exists
│  │  │  │  └─ route.ts
│  │  │  ├─ get
│  │  │  │  └─ route.ts
│  │  │  ├─ me
│  │  │  │  └─ route.ts
│  │  │  ├─ route.ts
│  │  │  ├─ save-onboarding
│  │  │  │  └─ route.ts
│  │  │  └─ status
│  │  │     └─ route.ts
│  │  ├─ rate
│  │  │  └─ route.ts
│  │  ├─ ratings
│  │  │  └─ save
│  │  │     └─ route.ts
│  │  ├─ recs
│  │  │  ├─ for-you
│  │  │  │  └─ route.ts
│  │  │  ├─ group
│  │  │  │  └─ route.ts
│  │  │  ├─ group-smart
│  │  │  │  └─ route.ts
│  │  │  ├─ personal
│  │  │  │  └─ route.ts
│  │  │  ├─ route.ts
│  │  │  ├─ smart
│  │  │  │  └─ route.ts
│  │  │  ├─ unified
│  │  │  │  └─ route.ts
│  │  │  └─ _known-filter.ts
│  │  ├─ session
│  │  │  └─ init
│  │  │     └─ route.ts
│  │  ├─ stripe
│  │  │  ├─ checkout
│  │  │  │  └─ route.ts
│  │  │  ├─ route.ts
│  │  │  └─ webhook
│  │  ├─ swipe
│  │  │  └─ decide
│  │  │     └─ route.ts
│  │  ├─ tmdb
│  │  │  ├─ details
│  │  │  │  └─ route.ts
│  │  │  ├─ discover
│  │  │  │  └─ route.ts
│  │  │  ├─ landing-posters
│  │  │  │  └─ route.ts
│  │  │  ├─ search
│  │  │  │  └─ route.ts
│  │  │  └─ watch-providers
│  │  │     └─ route.ts
│  │  ├─ user
│  │  │  └─ username
│  │  │     ├─ check
│  │  │     │  └─ route.ts
│  │  │     └─ update
│  │  │        └─ route.ts
│  │  └─ watchlist
│  │     ├─ add
│  │     │  └─ route.ts
│  │     ├─ detail
│  │     │  └─ route.ts
│  │     ├─ like
│  │     │  └─ route.ts
│  │     ├─ list
│  │     │  └─ route.ts
│  │     ├─ remove
│  │     │  └─ route.ts
│  │     └─ toggle
│  │        └─ route.ts
│  ├─ auth
│  │  ├─ register
│  │  │  ├─ page.tsx
│  │  │  └─ page_client.tsx
│  │  ├─ signup
│  │  │  └─ page.tsx
│  │  └─ verify
│  │     ├─ client.tsx
│  │     ├─ page.tsx
│  │     ├─ sent
│  │     │  └─ page.tsx
│  │     └─ verify-client.tsx
│  ├─ components
│  │  ├─ auth
│  │  │  ├─ InlineLogin.tsx
│  │  │  ├─ LoginCard.tsx
│  │  │  └─ LogoutButton.tsx
│  │  ├─ client
│  │  │  └─ OverlayMount.tsx
│  │  ├─ landing
│  │  │  └─ HeroReel.tsx
│  │  ├─ layouts
│  │  │  └─ AppShell.tsx
│  │  ├─ lib
│  │  │  ├─ nav.ts
│  │  │  └─ notify.ts
│  │  ├─ navigation
│  │  │  ├─ BottomTabs.tsx
│  │  │  └─ Sidebar.tsx
│  │  ├─ onboarding
│  │  │  ├─ ProviderPicker.tsx
│  │  │  └─ TitleTypeahead.tsx
│  │  ├─ panels
│  │  │  └─ InfoPanel.tsx
│  │  ├─ ui
│  │  │  ├─ ActionDock.tsx
│  │  │  ├─ MatchOverlay.tsx
│  │  │  ├─ Modal.tsx
│  │  │  ├─ ProviderChip.tsx
│  │  │  └─ Toast.tsx
│  │  └─ watch
│  │     └─ WatchNowButton.tsx
│  ├─ discover
│  │  └─ page.tsx
│  ├─ favicon.ico
│  ├─ globals.css
│  ├─ group
│  │  ├─ components
│  │  │  └─ IncomingInvites.tsx
│  │  ├─ GroupClient.tsx
│  │  ├─ match
│  │  │  └─ page.tsx
│  │  ├─ page.tsx
│  │  ├─ recs-test
│  │  │  └─ page.tsx
│  │  └─ swipe
│  │     ├─ Client.tsx
│  │     ├─ GroupBar.tsx
│  │     ├─ loading.tsx
│  │     ├─ page.tsx
│  │     └─ _legacy.tsx
│  ├─ layout.tsx
│  ├─ onboarding
│  │  ├─ page.tsx
│  │  └─ page_client.tsx
│  ├─ page.tsx
│  ├─ premium
│  │  ├─ page.tsx
│  │  └─ success
│  │     └─ page.tsx
│  ├─ prisma
│  │  └─ lib
│  │     └─ prisma.ts
│  ├─ profile
│  │  ├─ page.tsx
│  │  ├─ page_client.tsx
│  │  └─ ProfileClient.tsx
│  ├─ recs
│  │  └─ useUnifiedRecs.ts
│  ├─ recs-test
│  │  └─ page.tsx
│  ├─ swipe
│  │  ├─ Client.tsx
│  │  ├─ MatchOverlayMount.tsx
│  │  ├─ page.tsx
│  │  ├─ page_client.tsx
│  │  └─ _legacy.tsx
│  └─ watchlist
│     ├─ page.tsx
│     └─ WatchlistClient.tsx
├─ eslint.config.mjs
├─ lib
│  ├─ auth.ts
│  ├─ email.ts
│  ├─ hash.ts
│  ├─ nav.ts
│  ├─ prisma.ts
│  ├─ providers.ts
│  ├─ tmdb.ts
│  ├─ useGroupInvites.ts
│  └─ useGroupMatch.ts
├─ middleware.ts
├─ next.config.ts
├─ package-lock.json
├─ package.json
├─ postcss.config.mjs
├─ prisma
│  └─ schema.prisma
├─ public
│  ├─ file.svg
│  ├─ globe.svg
│  ├─ next.svg
│  ├─ providers
│  │  ├─ apple-tv-plus.svg
│  │  ├─ disney-plus.svg
│  │  ├─ max.svg
│  │  ├─ netflix.svg
│  │  ├─ prime-video.svg
│  │  ├─ skyshowtime.svg
│  │  ├─ svt-play.svg
│  │  └─ viaplay.svg
│  ├─ vercel.svg
│  └─ window.svg
├─ README.md
└─ tsconfig.json

```