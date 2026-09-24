// app/vad-kan-vi-se/[kombination]/page.tsx
//
// Tjänstkombinationerna — planens strategiskt viktigaste sidtyp.
//
// Ingen konkurrent adresserar tvärtjänstfrågan, och streamingtjänsterna kan
// definitionsmässigt inte göra det: Netflix känner bara Netflix katalog. Frågan
// "vi har Netflix och Viaplay, vad kan vi se?" är dessutom exakt vad appen gör,
// vilket gör sidan till en naturlig konverteringspunkt i stället för en
// påklistrad annons.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GuideArticle from "@/app/components/guide/GuideArticle";
import { COMBINATIONS } from "@/lib/guides/content";
import { fetchGuideTitles } from "@/lib/guides/titles";

export const revalidate = 86400;

export function generateStaticParams() {
  return COMBINATIONS.map((g) => ({ kombination: g.slug }));
}

function guideFor(slug: string) {
  return COMBINATIONS.find((g) => g.slug === slug);
}

export async function generateMetadata(
  { params }: { params: Promise<{ kombination: string }> },
): Promise<Metadata> {
  const { kombination } = await params;
  const guide = guideFor(kombination);
  if (!guide) return {};
  const path = `/vad-kan-vi-se/${guide.slug}`;
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

export default async function CombinationPage(
  { params }: { params: Promise<{ kombination: string }> },
) {
  const { kombination } = await params;
  const guide = guideFor(kombination);
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
