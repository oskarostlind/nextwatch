// app/components/guide/GuideArticle.tsx
//
// Renderar en landningssida. Server component — ingen interaktivitet behövs,
// och det som ska indexeras måste finnas i serverns HTML.
//
// Tre val som är hela differentieringen mot konkurrenterna (se SEO-PLAN.md,
// avsnittet Formatkrav — byggt på granskning av Filmtopp, MovieZine, PlayPilot):
//   1. En riktig <table> med betyg, år och genre per titel. Ingen av dem har en.
//   2. JSON-LD (ItemList + FAQPage + BreadcrumbList). Ingen av dem hade det —
//      bara Open Graph.
//   3. Synligt "Uppdaterad <datum>" som faktiskt stämmer. TechRadar rankar med
//      listor från december 2025 och låter dem ruttna; färskhet är gratis
//      försprång så länge vi faktiskt uppdaterar.
import Link from "next/link";
import type { Guide } from "@/lib/guides/content";
import { guidePath } from "@/lib/guides/content";
import { findGuide } from "@/lib/guides/content";
import type { GuideTitle } from "@/lib/guides/titles";
import { appStoreUrl, SITE_URL } from "@/lib/seo";
import GuideShell from "./GuideShell";

const DATE_FMT = new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "long", day: "numeric" });

function AppStoreCta({ campaign, variant }: { campaign: string; variant: "inline" | "footer" }) {
  const href = appStoreUrl(campaign);
  if (variant === "inline") {
    return (
      <div className="my-10 rounded-2xl border border-white/10 bg-white/[0.04] p-6">
        <p className="text-lg font-semibold text-white">Slipp listan — swipa fram er egen</p>
        <p className="mt-2 text-sm leading-relaxed text-neutral-300">
          I NextWatch svarar alla i sällskapet ja eller nej på samma titlar samtidigt, utan att se
          varandras svar. Appen visar bara det ni är överens om, och bara på tjänsterna ni faktiskt
          har. Gratis, svensk, för iPhone.
        </p>
        <a
          href={href}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-200"
        >
          Ladda ner gratis i App Store
        </a>
      </div>
    );
  }
  return (
    <a
      href={href}
      className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-cyan-300"
    >
      Hämta NextWatch gratis
    </a>
  );
}

function TitleTable({ titles }: { titles: GuideTitle[] }) {
  if (!titles.length) {
    return (
      <p className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-neutral-400">
        Listan kunde inte hämtas just nu. Prova att ladda om sidan om en stund.
      </p>
    );
  }
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[38rem] border-collapse text-left text-sm">
        <caption className="sr-only">
          Titlar sorterade på betyg från TMDB
        </caption>
        <thead>
          <tr className="border-b border-white/15 text-xs uppercase tracking-wide text-neutral-400">
            <th scope="col" className="py-3 pr-3 font-semibold" colSpan={2}>Titel</th>
            <th scope="col" className="py-3 pr-3 font-semibold">År</th>
            <th scope="col" className="py-3 pr-3 font-semibold">Betyg</th>
            <th scope="col" className="py-3 font-semibold">Genre</th>
          </tr>
        </thead>
        <tbody>
          {titles.map((t) => (
            <tr key={t.id} className="border-b border-white/5 align-top">
              {/* Affischen gör tabellen skannbar. Utan den blev sidan en vägg av
                  text — och konkurrenterna visar åtminstone en affischgrid. */}
              <td className="w-[58px] py-2.5 pr-3">
                {t.posterPath ? (
                  // next/image är avstängt i projektet (se next.config.ts:
                  // Vercels bildkvot är slut), så vanlig img är rätt här.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`https://image.tmdb.org/t/p/w92${t.posterPath}`}
                    alt=""
                    width={46}
                    height={69}
                    loading="lazy"
                    className="h-[69px] w-[46px] min-w-[46px] rounded object-cover"
                  />
                ) : (
                  <div className="h-[69px] w-[46px] min-w-[46px] rounded bg-white/5" />
                )}
              </td>
              <th scope="row" className="py-3 pr-3 font-medium text-white">{t.title}</th>
              <td className="py-3 pr-3 tabular-nums text-neutral-400">{t.year ?? "–"}</td>
              <td className="py-3 pr-3 tabular-nums">
                <span className="font-semibold text-amber-300">{t.rating.toFixed(1)}</span>
                <span className="ml-1 text-xs text-neutral-500">({t.votes.toLocaleString("sv-SE")})</span>
              </td>
              <td className="py-3 text-neutral-400">{t.genres.join(", ") || "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function GuideArticle({
  guide,
  titles,
  breadcrumb,
}: {
  guide: Guide;
  titles: GuideTitle[];
  /** [{namn, sökväg}] från startsidan och ned, exklusive sidan själv. */
  breadcrumb: { name: string; path: string }[];
}) {
  const updated = new Date();
  const path = guidePath(guide.slug);
  const url = `${SITE_URL}${path}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          ...breadcrumb.map((b, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: b.name,
            item: `${SITE_URL}${b.path}`,
          })),
          {
            "@type": "ListItem",
            position: breadcrumb.length + 1,
            name: guide.heading,
            item: url,
          },
        ],
      },
      {
        "@type": "ItemList",
        name: guide.listHeading,
        itemListOrder: "https://schema.org/ItemListOrderDescending",
        numberOfItems: titles.length,
        itemListElement: titles.map((t, i) => ({
          "@type": "ListItem",
          position: i + 1,
          item: {
            "@type": "Movie",
            name: t.title,
            ...(t.year ? { datePublished: String(t.year) } : {}),
            ...(t.posterPath ? { image: `https://image.tmdb.org/t/p/w500${t.posterPath}` } : {}),
            ...(t.votes > 0
              ? {
                  aggregateRating: {
                    "@type": "AggregateRating",
                    ratingValue: t.rating,
                    bestRating: 10,
                    ratingCount: t.votes,
                  },
                }
              : {}),
          },
        })),
      },
      {
        "@type": "FAQPage",
        mainEntity: guide.faq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return (
    // lang="sv" sätts här eftersom <html lang> följer nw_lang-cookien (se
    // app/layout.tsx). En besökare med engelskt gränssnitt ska ändå få den här
    // artikeln korrekt språktaggad — innehållet är och förblir svenskt.
    <GuideShell>
    <article lang="sv" className="mx-auto w-full max-w-3xl px-4 pb-20 pt-9 sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav aria-label="Brödsmulor" className="mb-6 text-xs text-neutral-500">
        {breadcrumb.map((b) => (
          <span key={b.path}>
            <Link href={b.path} className="transition hover:text-neutral-300">{b.name}</Link>
            <span className="mx-1.5">/</span>
          </span>
        ))}
        <span className="text-neutral-400">{guide.heading}</span>
      </nav>

      <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
        {guide.heading}
      </h1>
      <p className="mt-3 text-xs text-neutral-500">
        Uppdaterad <time dateTime={updated.toISOString().slice(0, 10)}>{DATE_FMT.format(updated)}</time>
      </p>

      <div className="mt-7 space-y-4 text-[15px] leading-relaxed text-neutral-300">
        {guide.intro.map((p, i) => <p key={i}>{p}</p>)}
      </div>

      <AppStoreCta campaign={guide.campaign} variant="inline" />

      <h2 className="mt-12 text-2xl font-bold tracking-tight text-white">{guide.listHeading}</h2>
      <p className="mt-2 text-sm text-neutral-400">{guide.listNote}</p>
      <div className="mt-5">
        <TitleTable titles={titles} />
      </div>

      {guide.sections.map((s) => (
        <section key={s.heading} className="mt-12">
          <h2 className="text-2xl font-bold tracking-tight text-white">{s.heading}</h2>
          <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-neutral-300">
            {s.body.map((p, i) => <p key={i}>{p}</p>)}
          </div>
        </section>
      ))}

      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-white">Vanliga frågor</h2>
        <dl className="mt-5 divide-y divide-white/10 border-y border-white/10">
          {guide.faq.map((f) => (
            <div key={f.q} className="py-5">
              <dt className="font-semibold text-white">{f.q}</dt>
              <dd className="mt-2 text-[15px] leading-relaxed text-neutral-300">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {guide.related.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-bold tracking-tight text-white">Läs vidare</h2>
          <ul className="mt-4 space-y-2">
            {guide.related.map((slug) => {
              const g = findGuide(slug);
              if (!g) return null;
              return (
                <li key={slug}>
                  <Link
                    href={guidePath(slug)}
                    className="text-cyan-300 underline-offset-4 transition hover:underline"
                  >
                    {g.heading}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="mt-14 border-t border-white/10 pt-8">
        <p className="text-sm text-neutral-400">
          NextWatch är en gratis svensk app för iPhone. Alla swipar samtidigt, appen visar bara det
          ni är överens om — på tjänsterna ni har.
        </p>
        <div className="mt-4">
          <AppStoreCta campaign={guide.campaign} variant="footer" />
        </div>
      </div>
    </article>
    </GuideShell>
  );
}
