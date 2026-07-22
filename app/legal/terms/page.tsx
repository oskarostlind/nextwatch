// app/legal/terms/page.tsx — användarvillkor. Publik (PUBLIC_ROUTES i AppShell).
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Användarvillkor – NextWatch",
  description: "Villkor för att använda NextWatch.",
};

const UPDATED = "22 juli 2026";

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 text-neutral-200">
      <p className="text-xs uppercase tracking-widest text-cyan-400/80">NextWatch</p>
      <h1 className="mt-1 text-3xl font-bold text-white">Användarvillkor</h1>
      <p className="mt-1 text-sm text-white/40">Senast uppdaterade: {UPDATED}</p>

      <div className="mt-8 space-y-6 text-[15px] leading-relaxed">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">1. Tjänsten</h2>
          <p>
            NextWatch hjälper dig hitta filmer och serier — själv eller i grupp — utifrån din smak
            och de streamingtjänster du har. NextWatch är inte en streamingtjänst: vi visar var
            titlar finns och länkar dit, men tillhandahåller inget innehåll själva.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">2. Konto och ålder</h2>
          <p>
            Du kan använda tjänsten som gäst eller med konto. Du ansvarar för att uppgifterna du
            lämnar stämmer och för att hålla dina inloggningsuppgifter hemliga. Rekommendationer
            åldersanpassas utifrån ditt födelsedatum. Tjänsten riktar sig inte till barn under 13 år.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">3. Premium och betalning</h2>
          <p>
            Gratisversionen finansieras med annonser. Premium (annonsfritt och obegränsat med
            swipes) köps via App Store i iOS-appen eller via Stripe på webben. Prenumerationer
            förnyas tills de sägs upp — i App Store-inställningarna respektive via
            ”Hantera prenumeration” i profilen. Ångerrätt och återbetalningar för App Store-köp
            hanteras av Apple enligt deras villkor.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">4. Uppförande</h2>
          <p>
            Använd tjänsten som en schysst människa: inga intrångsförsök, ingen spam via
            filmtips/vänförfrågningar, inget missbruk av API:er. Vi kan stänga av konton som
            missbrukar tjänsten.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">5. Innehåll och tredje part</h2>
          <p>
            Film- och seriedata (titlar, bilder, beskrivningar, betyg) kommer från The Movie
            Database (TMDB). Denna produkt använder TMDB:s API men är inte godkänd eller
            certifierad av TMDB. Streamingtillgänglighet kan ändras utan förvarning och vi
            garanterar inte att uppgifterna alltid är korrekta.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">6. Ansvarsbegränsning</h2>
          <p>
            Tjänsten tillhandahålls i befintligt skick. Vi ansvarar inte för indirekta skador eller
            för innehåll hos tredje part (streamingtjänster, TMDB, annonsörer). Inget i dessa
            villkor begränsar rättigheter du har enligt tvingande konsumentlagstiftning.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">7. Ändringar och upphörande</h2>
          <p>
            Vi kan uppdatera tjänsten och dessa villkor; väsentliga ändringar meddelas i appen. Du
            kan när som helst radera ditt konto i profilens inställningar. Svensk lag gäller.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">8. Kontakt</h2>
          <p>
            Frågor? Mejla{" "}
            <a className="text-cyan-300 underline" href="mailto:support@nextwatch.se">
              support@nextwatch.se
            </a>
            .
          </p>
        </section>
      </div>

      <div className="mt-10 flex flex-wrap gap-4 border-t border-white/10 pt-6 text-sm">
        <Link href="/legal/privacy" className="text-cyan-300 underline">Integritetspolicy</Link>
        <Link href="/support" className="text-cyan-300 underline">Support</Link>
        <Link href="/" className="text-white/50 underline">Till startsidan</Link>
      </div>
    </main>
  );
}
