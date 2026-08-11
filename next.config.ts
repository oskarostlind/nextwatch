// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Tab-tillbaka-navigering serveras ur klientens router-cache i 60s i stället
  // för en ny serverrendering (Next 15 defaultar staleTimes.dynamic till 0, så
  // varje flik-tryck gick till servern). Varje flik re-hämtar ändå sin data
  // klient-side via modul-stores, så innehållet blir aldrig gammalt.
  experimental: { staleTimes: { dynamic: 60, static: 300 } },
  images: {
    // Ingen Vercel-bildoptimering. Mätt på produktion 2026-07-22 svarade
    // /_next/image 402 OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED — kvoten är
    // slut, så VARJE poster via next/image var en trasig bild. (De fyra ställen
    // som redan hade `unoptimized` fortsatte fungera, vilket stämde med att
    // bilder saknades på just /swipe, /watchlist och Betyg.)
    //
    // Optimeringen tillförde ändå nästan ingenting här: TMDB serverar redan
    // färdiga storlekar (w92…w780, original) från egen CDN, och koden väljer
    // storlek per yta. Optimizern gav dessutom `max-age=0, must-revalidate`
    // medan TMDB:s egna URL:er ger `max-age=31919000` — dvs. posters cachas nu
    // i praktiken permanent i klienten i stället för att hämtas om varje besök.
    //
    // Priset: ingen automatisk nedskalning eller WebP/AVIF. Första besöket drar
    // fler bytes (w500 ≈ 40–70 kB/poster). Vill vi ner i bandbredd är rätt
    // åtgärd att välja mindre TMDB-storlek per yta i koden, inte att slå på
    // optimizern igen.
    unoptimized: true,
    // Tillåt TMDB-posters och loggor
    remotePatterns: [
      {
        protocol: "https",
        hostname: "image.tmdb.org",
        port: "",
        pathname: "/t/p/**",
      },
    ],
    // Om du vill tillåta data-URI som fallback (vi använder det ibland i söklistor):
    // dangerouslyAllowSVG: false,
    // contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  // Behåll lint/type checks i CI/Prod (vi vill INTE skippa dem)
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
