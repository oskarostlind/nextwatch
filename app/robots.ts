// app/robots.ts
//
// Fram till 2026-09-24 svarade /robots.txt 404. Det stoppar inte crawling i sig,
// men utan sitemap-hänvisning hittar Google bara det som råkar vara länkat, och
// appytorna (/swipe, /profile, /watchlist …) låg öppna för indexering trots att
// de kräver session och bara renderar ett tomt skal för en crawler — tunna
// sidor som drar ner hela domänen.
//
// Filändelsen .txt är redan undantagen i middleware.ts matcher, så det här
// svaret får ingen session-cookie påklistrad.
import type { MetadataRoute } from "next";
import { SITE_URL, PRIVATE_PATHS } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  // Preview-deployer får aldrig indexeras — annars konkurrerar de med
  // produktionsdomänen om samma innehåll.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...PRIVATE_PATHS],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
