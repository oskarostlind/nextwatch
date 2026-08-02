// app/legal/privacy/page.tsx — integritetspolicy. Publik (PUBLIC_ROUTES i
// AppShell): måste vara nåbar utan konto för App Store-review och AdMob.
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Integritetspolicy – NextWatch",
  description: "Så hanterar NextWatch dina personuppgifter.",
};

const UPDATED = "22 juli 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 text-neutral-200">
      <p className="text-xs uppercase tracking-widest text-cyan-400/80">NextWatch</p>
      <h1 className="mt-1 text-3xl font-bold text-white">Integritetspolicy</h1>
      <p className="mt-1 text-sm text-white/40">Senast uppdaterad: {UPDATED}</p>

      <div className="prose-invert mt-8 space-y-6 text-[15px] leading-relaxed">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">1. Vem är ansvarig?</h2>
          <p>
            NextWatch (”vi”) tillhandahåller appen och webbtjänsten NextWatch – en tjänst för att
            hitta filmer och serier, själv eller i grupp. Vi är personuppgiftsansvariga för den
            behandling som beskrivs här. Kontakt:{" "}
            <a className="text-cyan-300 underline" href="mailto:support@nextwatch.se">
              support@nextwatch.se
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">2. Vilka uppgifter samlar vi in?</h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <span className="font-medium text-white">Kontouppgifter:</span> e-postadress,
              lösenord (lagras alltid krypterat/hashat), visningsnamn, användarnamn, födelsedatum
              (används för åldersanpassade rekommendationer) och vald profilbild.
            </li>
            <li>
              <span className="font-medium text-white">Smak- och användningsdata:</span> dina
              swipes, betyg, watchlist, favoritgenrer/-titlar, valda streamingtjänster, grupper du
              deltar i, vänner och filmtips du skickar/tar emot.
            </li>
            <li>
              <span className="font-medium text-white">Tekniska uppgifter:</span> en anonym
              identifierare (cookie), region och språk, samt push-token om du tillåter notiser.
            </li>
            <li>
              <span className="font-medium text-white">Köpuppgifter:</span> vid premiumköp
              hanteras betalningen av Stripe (webb) eller Apple (appen). Vi ser aldrig dina
              kortuppgifter — bara att köpet genomförts.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">3. Varför behandlar vi uppgifterna?</h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Leverera tjänsten: rekommendationer, grupper, vänner, watchlist (avtal).</li>
            <li>Personliga rekommendationer utifrån din smakprofil (avtal/berättigat intresse).</li>
            <li>Notiser du valt att få — kan stängas av per typ i profilens inställningar (samtycke).</li>
            <li>
              Annonser i gratisversionen av appen via Google AdMob. Med ditt samtycke (via
              Apples spårningsdialog och Googles samtyckesformulär) kan annonser anpassas; nekar
              du visas endast icke-anpassade annonser (samtycke).
            </li>
            <li>Drift, felsökning och missbruksskydd (berättigat intresse).</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">4. Vilka delar vi uppgifter med?</h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <span className="font-medium text-white">TMDB</span> (The Movie Database) — film-
              och seriedata hämtas därifrån; dina sökningar skickas dit utan koppling till ditt konto.
            </li>
            <li><span className="font-medium text-white">Google AdMob</span> — annonser i appen (se ovan).</li>
            <li><span className="font-medium text-white">Stripe</span> — betalningar på webben.</li>
            <li><span className="font-medium text-white">Apple</span> — köp och push-notiser i iOS-appen.</li>
            <li>
              <span className="font-medium text-white">Driftleverantörer</span> — hosting (Vercel),
              databas (Neon) och e-postutskick. De behandlar uppgifter endast för vår räkning.
            </li>
            <li>
              <span className="font-medium text-white">Andra användare</span> — visningsnamn,
              användarnamn, profilbild, favoritgenrer och en topp-3 härledd ur dina likes visas för
              dina vänner; grupper ser gemensam aktivitet. Vi säljer aldrig dina uppgifter.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">5. Hur länge sparas uppgifterna?</h2>
          <p>
            Så länge du har ett konto. Raderar du kontot (Profil → Inställningar → Radera konto)
            tas alla dina uppgifter bort permanent: profil, betyg, watchlist, grupper, vänner,
            filmtips och push-tokens. Inaktiva grupper gallras automatiskt. Vissa köpunderlag kan
            behöva sparas längre enligt bokföringslag.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">6. Dina rättigheter (GDPR)</h2>
          <p>
            Du har rätt till tillgång, rättelse, radering, begränsning, dataportabilitet och att
            invända mot behandling. Du kan när som helst återkalla samtycken (notiser i appens
            inställningar, annonsspårning i iOS-inställningarna). Kontakta{" "}
            <a className="text-cyan-300 underline" href="mailto:support@nextwatch.se">
              support@nextwatch.se
            </a>{" "}
            — och du kan alltid klaga hos Integritetsskyddsmyndigheten (IMY).
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">7. Cookies</h2>
          <p>
            Vi använder ett fåtal nödvändiga cookies: en identifierare som håller dig inloggad
            (signerad, kan inte förfalskas) samt region/språk. Inga tredjeparts-spårningscookies
            på webben.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">8. Ändringar</h2>
          <p>
            Vid väsentliga ändringar uppdaterar vi denna sida och datumet ovan. Väsentliga
            förändringar meddelas i appen.
          </p>
        </section>
      </div>

      <div className="mt-10 flex flex-wrap gap-4 border-t border-white/10 pt-6 text-sm">
        <Link href="/legal/terms" className="text-cyan-300 underline">Användarvillkor</Link>
        <Link href="/support" className="text-cyan-300 underline">Support</Link>
        <Link href="/" className="text-white/50 underline">Till startsidan</Link>
      </div>
    </main>
  );
}
