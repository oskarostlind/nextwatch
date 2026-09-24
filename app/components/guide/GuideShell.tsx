// app/components/guide/GuideShell.tsx
//
// Ram runt landningssidorna. Lades till efter en granskning av de renderade
// sidorna 2026-09-24: de saknade header och footer helt (headerCount 0,
// footerCount 0 i DOM:en). En besökare som kom från Google såg en artikel utan
// avsändare, utan väg tillbaka till sajten och utan väg in i appen.
//
// Footern är dessutom inte valfri: sidorna visar TMDB-betyg, och TMDB:s villkor
// kräver attribution där deras data visas. Heron (HeroDeck) har den raden —
// guidesidorna hade den inte.
//
// AppShell räknar de här rutterna som publika, så ingen BottomTabs renderas.
// Headern nedan är därför den enda navigationen sidan har.
import Link from "next/link";
import AppStoreLink from "@/app/components/landing/AppStoreLink";

export default function GuideShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-neutral-950">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-neutral-950/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-white/90 transition hover:text-white"
          >
            NextWatch
          </Link>
          <Link
            href="/vilken-film-ska-vi-se"
            className="hidden text-[13px] text-neutral-400 transition hover:text-white sm:block"
          >
            Alla guider
          </Link>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-white/10">
        <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
          <p className="text-sm leading-relaxed text-neutral-400">
            <span className="font-semibold text-white">NextWatch</span> är en gratis svensk app för
            iPhone. Alla i sällskapet swipar samtidigt och appen visar bara det ni är överens om —
            på streamingtjänsterna ni faktiskt har.
          </p>
          <div className="mt-5">
            <AppStoreLink campaign="web-guide-footer" />
          </div>

          <nav className="mt-9 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-neutral-500">
            <Link href="/vilken-film-ska-vi-se" className="transition hover:text-neutral-300">Alla guider</Link>
            <Link href="/legal/privacy" className="transition hover:text-neutral-300">Integritetspolicy</Link>
            <Link href="/legal/terms" className="transition hover:text-neutral-300">Användarvillkor</Link>
            <Link href="/support" className="transition hover:text-neutral-300">Support</Link>
          </nav>

          {/* TMDB kräver den här raden där deras data visas. Samma formulering
              som legal-raden i HeroDeck. */}
          <p className="mt-6 text-[11px] leading-relaxed text-neutral-600">
            Filmdata och betyg kommer från{" "}
            <a
              href="https://www.themoviedb.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#01b4e4]/70 transition hover:text-[#01b4e4]"
            >
              TMDB
            </a>
            . NextWatch är inte godkänd eller certifierad av TMDB.
          </p>
        </div>
      </footer>
    </div>
  );
}
