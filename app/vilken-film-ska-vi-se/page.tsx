// app/vilken-film-ska-vi-se/page.tsx
//
// Navet. Två jobb:
//   1. Ranka på "vilken film ska vi se" — en sökfras vars SERP idag består av
//      ett forumarkiv från alltforforaldrar.se och engelska Wikipedia-artiklar.
//   2. Hålla ihop den interna länkmatrisen. Filmtopp är starkast av
//      konkurrenterna på just interna länkar; utan ett nav blir våra sidor
//      isolerade och ärver ingen auktoritet av varandra.
import type { Metadata } from "next";
import Link from "next/link";
import { OCCASIONS, COMPANIONS, COMBINATIONS, guidePath } from "@/lib/guides/content";
import { appStoreUrl, SITE_URL } from "@/lib/seo";
import GuideShell from "@/app/components/guide/GuideShell";

export const revalidate = 86400;

const TITLE = "Vilken film ska vi se? Guider för varje kväll och sällskap";
const DESCRIPTION =
  "Fastnar ni i valet? Guider för olika kvällar, olika sällskap och olika streamingtjänster — med aktuella filmtips och en metod som faktiskt ger ett beslut.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/vilken-film-ska-vi-se" },
  openGraph: {
    type: "website",
    url: "/vilken-film-ska-vi-se",
    title: TITLE,
    description: DESCRIPTION,
  },
};

const GROUPS = [
  {
    heading: "Efter tillfälle",
    lead: "Kvällen sätter kraven. En fredag med tacos tål inte samma film som en lördag när alla är utvilade.",
    guides: OCCASIONS,
  },
  {
    heading: "Efter sällskap",
    lead: "Två personer förhandlar. Fem personer förhandlar inte — de fastnar. Olika storlekar kräver olika metod.",
    guides: COMPANIONS,
  },
  {
    heading: "Efter streamingtjänster",
    lead: "Ingen av tjänsterna kan visa varandras katalog. De här sidorna slår ihop dem.",
    guides: COMBINATIONS,
  },
];

export default function HubPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Start", item: SITE_URL },
          {
            "@type": "ListItem",
            position: 2,
            name: "Vilken film ska vi se",
            item: `${SITE_URL}/vilken-film-ska-vi-se`,
          },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "Vilken film ska vi se ikväll?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Bestäm först film eller serie, sedan hur mycket ni orkar, och låt därefter alla svara ja eller nej på samma titlar samtidigt. Det är turordningen — inte utbudet — som gör valet långsamt.",
            },
          },
          {
            "@type": "Question",
            name: "Hur väljer man film när man är flera?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Genom att rösta parallellt i stället för att föreslå i tur och ordning. I en förhandling är ett nej gratis och ett ja förpliktigande, vilket gör att folk slutar föreslå efter några avslag.",
            },
          },
        ],
      },
    ],
  };

  return (
    <GuideShell>
    <div lang="sv" className="mx-auto w-full max-w-3xl px-4 pb-20 pt-9 sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
        Vilken film ska vi se?
      </h1>

      <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-neutral-300">
        <p>
          Utbudet är inte problemet. Ni har fler titlar tillgängliga än ni hinner se på ett
          decennium. Problemet är att ni är flera, att förslag kommer i tur och ordning, och att
          den som föreslår tar en social risk som den som säger nej slipper.
        </p>
        <p>
          Efter tre avfärdade förslag slutar folk föreslå. Då återstår scrollande, och kvällen
          landar i något ni redan sett. Guiderna nedan är uppdelade efter det som faktiskt
          avgör valet: vilken kväll det är, hur många ni är, och vilka tjänster ni har.
        </p>
      </div>

      <div className="my-10 rounded-2xl border border-white/10 bg-white/[0.04] p-6">
        <p className="text-lg font-semibold text-white">Eller hoppa över förhandlingen</p>
        <p className="mt-2 text-sm leading-relaxed text-neutral-300">
          NextWatch låter alla i sällskapet swipa samtidigt, utan att se varandras svar. Appen
          visar bara titlar ni är överens om, filtrerat på era streamingtjänster. Gratis för iPhone.
        </p>
        <a
          href={appStoreUrl("web-hub")}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-200"
        >
          Ladda ner gratis i App Store
        </a>
      </div>

      {GROUPS.map((group) => (
        <section key={group.heading} className="mt-12">
          <h2 className="text-2xl font-bold tracking-tight text-white">{group.heading}</h2>
          <p className="mt-2 text-sm leading-relaxed text-neutral-400">{group.lead}</p>
          <ul className="mt-5 space-y-3">
            {group.guides.map((g) => (
              <li key={g.slug}>
                <Link
                  href={guidePath(g.slug)}
                  className="group block rounded-xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-white/25 hover:bg-white/[0.05]"
                >
                  <span className="font-semibold text-white group-hover:text-cyan-200">
                    {g.heading}
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed text-neutral-400">
                    {g.metaDescription}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
    </GuideShell>
  );
}
