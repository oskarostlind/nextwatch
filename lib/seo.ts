// lib/seo.ts
//
// Delade SEO-konstanter. Medvetet import-fri (samma skäl som lib/cookies.ts och
// lib/i18nConfig.ts): filen läses av app/robots.ts, app/sitemap.ts, layouten och
// kommande landningssidor, och ska inte dra in next/server i något av dem.
//
// Bakgrund: fram till 2026-09-24 hade sajten varken robots.txt, sitemap eller
// svensk metadata — <title> var "NextWatch" och beskrivningen "Swipe your next
// watch" på engelska för en svensk app. App Store Connect visade noll
// installationer från Web Referrer, vilket inte var konstigt: det fanns
// ingenting för Google att indexera.

/**
 * Kanonisk bas-URL.
 *
 * I produktion är den hårdkodad med flit: apex-domänen nextwatch.se svarar 307
 * och pekar på www.nextwatch.se, så www ÄR kanoniskt. NEXT_PUBLIC_SITE_URL
 * används på andra håll (lib/auth.ts bygger verifieringslänkar av den) och
 * NEXTAUTH_URL i .env står på apex — läste vi någon av dem här skulle canonical
 * och sitemap peka på en URL som omedelbart redirectar, vilket späder ut
 * signalen. Preview-deployer använder sin egen VERCEL_URL.
 */
export const SITE_URL = (
  process.env.VERCEL_ENV === "production"
    ? "https://www.nextwatch.se"
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000")
).replace(/\/$/, "");

export const APP_STORE_ID = "6778179190";

/**
 * App Store-länk med kampanjkod. `ct` dyker upp i App Store Connect under
 * Analytics → Acquisition → Campaigns, så varje sidtyp kan mätas för sig.
 * Utan den syns webbtrafiken bara som en klump i "Web Referrer".
 */
export function appStoreUrl(campaign: string): string {
  return `https://apps.apple.com/se/app/nextwatch/id${APP_STORE_ID}?ct=${encodeURIComponent(campaign)}&pt=&mt=8`;
}

/** Sidor som är privata appytor — de ska aldrig indexeras. */
export const PRIVATE_PATHS = [
  "/api/",
  "/admin",
  "/auth/",
  "/onboarding",
  "/swipe",
  "/group",
  "/discover",
  "/watchlist",
  "/profile",
  "/recs",
  "/coming-soon",
] as const;

/**
 * Publika sidor som redan finns och ska ligga i sitemap:en.
 * Landningssidorna (kluster D/B i SEO-PLAN.md) läggs till här efterhand.
 */
export const PUBLIC_ROUTES: { path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" | "yearly" }[] = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/vilken-film-ska-vi-se", priority: 0.9, changeFrequency: "weekly" },
  { path: "/premium", priority: 0.6, changeFrequency: "monthly" },
  { path: "/support", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/privacy", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/terms", priority: 0.2, changeFrequency: "yearly" },
];

/** De streamingtjänster appen filtrerar på, i den form URL-sluggar använder. */
export const SERVICES = [
  { slug: "netflix", name: "Netflix" },
  { slug: "disney-plus", name: "Disney+" },
  { slug: "prime-video", name: "Prime Video" },
  { slug: "max", name: "Max" },
  { slug: "viaplay", name: "Viaplay" },
  { slug: "apple-tv-plus", name: "Apple TV+" },
  { slug: "skyshowtime", name: "SkyShowtime" },
  { slug: "svt-play", name: "SVT Play" },
  { slug: "tv4-play", name: "TV4 Play" },
] as const;
