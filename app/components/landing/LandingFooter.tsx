// app/components/landing/LandingFooter.tsx
//
// Startsidan bestod fram till 2026-09-24 av HeroDeck — en klientkomponent med
// swipebara kort. För en crawler betydde det en sida utan rubriker, utan
// brödtext och utan en enda intern länk. Hela sajten hade dessutom noll länkar
// till App Store (verifierat med grep på apps.apple.com), vilket är en trolig
// förklaring till att Web Referrer visar 0 installationer: även den som hittade
// hit hade ingen väg vidare till appen.
//
// Den här foten ligger under heron och är serverrenderad, så den finns i HTML:en
// från första byte. Den gör tre saker: förklarar produkten i text, länkar till
// guidesidorna (utan den vore de föräldralösa och skulle ärva noll auktoritet),
// och ger en väg till App Store med kampanjkod.
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { OCCASIONS, COMPANIONS, COMBINATIONS, guidePath } from "@/lib/guides/content";
import AppStoreLink from "./AppStoreLink";

const LINKS = [...OCCASIONS.slice(0, 3), ...COMPANIONS.slice(0, 2), ...COMBINATIONS.slice(0, 2)];

export default async function LandingFooter() {
  const t = await getTranslations("landing");
  return (
    <footer lang="sv" className="border-t border-white/10 bg-neutral-950">
      <div className="mx-auto w-full max-w-3xl px-5 py-14">
        <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Sluta bråka. Börja titta.
        </h2>
        <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-neutral-300">
          <p>
            NextWatch löser en sak: att välja film när ni är flera. Alla i sällskapet swipar
            samtidigt på samma titlar, utan att se varandras svar. När tillräckligt många sagt ja
            på samma film dyker den upp som en matchning — och eftersom ingen vet vem som sa nej
            till vad blir det ingen förhandling att förlora.
          </p>
          <p>
            Appen filtrerar på de streamingtjänster ni faktiskt har — Netflix, Viaplay, Disney+,
            Max, Prime Video, SkyShowtime, Apple TV+, SVT Play och TV4 Play — så ni slipper enas om
            något ingen kommer åt. Den fungerar lika bra solo. Filmdata kommer från TMDB.
          </p>
        </div>

        <div className="mt-8">
          <AppStoreLink campaign="web-hero" />
        </div>

        <nav aria-label="Guider" className="mt-14">
          <h2 className="text-lg font-bold tracking-tight text-white">Vilken film ska vi se?</h2>
          <p className="mt-2 text-sm text-neutral-400">
            Guider för olika kvällar, olika sällskap och olika tjänster — med aktuella filmtips.
          </p>
          <ul className="mt-5 grid gap-2 sm:grid-cols-2">
            {LINKS.map((g) => (
              <li key={g.slug}>
                <Link
                  href={guidePath(g.slug)}
                  className="block rounded-lg px-3 py-2 text-sm text-neutral-300 transition hover:bg-white/5 hover:text-white"
                >
                  {g.heading}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/vilken-film-ska-vi-se"
                className="block rounded-lg px-3 py-2 text-sm font-medium text-cyan-300 transition hover:bg-white/5"
              >
                Alla guider
              </Link>
            </li>
          </ul>
        </nav>

        <div className="mt-12 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/10 pt-6 text-xs text-neutral-500">
          <Link href="/legal/privacy" className="transition hover:text-neutral-300">{t("privacy")}</Link>
          <Link href="/legal/terms" className="transition hover:text-neutral-300">{t("terms")}</Link>
          <Link href="/support" className="transition hover:text-neutral-300">{t("support")}</Link>
        </div>
      </div>
    </footer>
  );
}
