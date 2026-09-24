// app/vad-ska-vi-se/[tillfalle]/page.tsx
//
// Tillfällessidorna — planens prioritet 1. SERP:en för "vad ska vi se ikväll"
// ger idag en Spotify-podd och en Facebook-grupp; "vilken film ska vi se" ger
// ett forumarkiv från 2016. Ingen seriös aktör har byggt svarssidan.
//
// Innehållet är handskrivet per sida i lib/guides/content.ts. Bara renderingen
// delas — en generator som byter ut ett ord per sida är doorway pages.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GuideArticle from "@/app/components/guide/GuideArticle";
import { OCCASIONS } from "@/lib/guides/content";
import { fetchGuideTitles } from "@/lib/guides/titles";

// Katalogerna ändras inte per timme, och färskhet är vår differentiering mot
// konkurrenter vars listor är 9–15 månader gamla. Ett dygn träffar mitt emellan.
export const revalidate = 86400;

export function generateStaticParams() {
  return OCCASIONS.map((g) => ({ tillfalle: g.slug }));
}

function guideFor(slug: string) {
  return OCCASIONS.find((g) => g.slug === slug);
}

export async function generateMetadata(
  { params }: { params: Promise<{ tillfalle: string }> },
): Promise<Metadata> {
  const { tillfalle } = await params;
  const guide = guideFor(tillfalle);
  if (!guide) return {};
  const path = `/vad-ska-vi-se/${guide.slug}`;
  return {
    title: guide.title,
    description: guide.metaDescription,
    alternates: { canonical: path },
    openGraph: {
      type: "article",
      url: path,
      title: guide.title,
      description: guide.metaDescription,
    },
  };
}

export default async function OccasionPage(
  { params }: { params: Promise<{ tillfalle: string }> },
) {
  const { tillfalle } = await params;
  const guide = guideFor(tillfalle);
  if (!guide) notFound();

  const titles = await fetchGuideTitles(guide.query);

  return (
    <GuideArticle
      guide={guide}
      titles={titles}
      breadcrumb={[
        { name: "Start", path: "/" },
        { name: "Vilken film ska vi se", path: "/vilken-film-ska-vi-se" },
      ]}
    />
  );
}
