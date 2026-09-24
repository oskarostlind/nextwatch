// app/film-for/[sallskap]/page.tsx
//
// Sällskapssidorna. Samma resonemang som tillfällessidorna: låg konkurrens,
// hög intent, och frågan är exakt den appen löser. Se lib/guides/content.ts.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GuideArticle from "@/app/components/guide/GuideArticle";
import { COMPANIONS } from "@/lib/guides/content";
import { fetchGuideTitles } from "@/lib/guides/titles";

export const revalidate = 86400;

export function generateStaticParams() {
  return COMPANIONS.map((g) => ({ sallskap: g.slug }));
}

function guideFor(slug: string) {
  return COMPANIONS.find((g) => g.slug === slug);
}

export async function generateMetadata(
  { params }: { params: Promise<{ sallskap: string }> },
): Promise<Metadata> {
  const { sallskap } = await params;
  const guide = guideFor(sallskap);
  if (!guide) return {};
  const path = `/film-for/${guide.slug}`;
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

export default async function CompanionPage(
  { params }: { params: Promise<{ sallskap: string }> },
) {
  const { sallskap } = await params;
  const guide = guideFor(sallskap);
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
