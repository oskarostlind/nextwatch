// app/sitemap.ts
//
// Ny 2026-09-24. Sajten hade ingen sitemap alls.
//
// Landningssidorna läggs till i vågor (se SEO-PLAN.md) — att dumpa hundratals
// genererade URL:er på en domän utan historik ser ut som doorway pages. Våg 1
// är de handskrivna guiderna i lib/guides/content.ts.
import type { MetadataRoute } from "next";
import { SITE_URL, PUBLIC_ROUTES } from "@/lib/seo";
import { ALL_GUIDES, guidePath } from "@/lib/guides/content";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes = PUBLIC_ROUTES.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  const guideRoutes = ALL_GUIDES.map((g) => ({
    url: `${SITE_URL}${guidePath(g.slug)}`,
    lastModified: now,
    // Listorna revalideras dagligen, så innehållet ändras faktiskt dagligen.
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));

  return [...staticRoutes, ...guideRoutes];
}
