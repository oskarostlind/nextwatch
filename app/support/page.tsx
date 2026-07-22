// app/support/page.tsx — supportsida. Publik (PUBLIC_ROUTES i AppShell);
// URL:en används som support-URL i App Store Connect.
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support – NextWatch",
  description: "Hjälp och kontakt för NextWatch.",
};

const FAQ: { q: string; a: string }[] = [
  {
    q: "Jag ser inga rekommendationer / det står ”Slut på förslag”",
    a: "Kontrollera att du valt minst en streamingtjänst i Profil → Tjänster. Förslagen filtreras på tjänsterna du (eller din grupp) faktiskt har. Titlar du redan swipat återkommer efter din valda återvinningstid.",
  },
  {
    q: "Hur fungerar grupper?",
    a: "Skapa en grupp under Grupp-fliken och dela koden, eller bjud in vänner direkt. När tillräckligt många gillat samma titel får ni en matchning. Under gruppens sida ser ni också titlar som flera av er redan har i sina watchlists.",
  },
  {
    q: "Hur säger jag upp Premium?",
    a: "Köpt i iOS-appen: Inställningar → ditt Apple-ID → Prenumerationer, eller via ”Hantera i App Store” i profilen. Köpt på webben: ”Hantera prenumeration” i profilens inställningar.",
  },
  {
    q: "Hur raderar jag mitt konto?",
    a: "Profil → Inställningar → Radera konto. All din data tas bort permanent. Har du en aktiv App Store-prenumeration behöver den sägas upp separat hos Apple.",
  },
  {
    q: "Varför får jag inga notiser?",
    a: "Kontrollera dels iOS-inställningarna för NextWatch, dels vilka notistyper du slagit på under Profil → Inställningar → Notiser.",
  },
  {
    q: "Jag hittar en bugg!",
    a: "Underbart — mejla oss! Beskriv vad du gjorde, vad som hände och gärna en skärmdump.",
  },
];

export default function SupportPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 text-neutral-200">
      <p className="text-xs uppercase tracking-widest text-cyan-400/80">NextWatch</p>
      <h1 className="mt-1 text-3xl font-bold text-white">Support</h1>
      <p className="mt-2 text-white/60">
        Behöver du hjälp? Mejla{" "}
        <a className="font-medium text-cyan-300 underline" href="mailto:support@nextwatch.se">
          support@nextwatch.se
        </a>{" "}
        — vi svarar normalt inom 1–2 vardagar.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-white">Vanliga frågor</h2>
      <div className="mt-3 grid gap-2">
        {FAQ.map((f) => (
          <details
            key={f.q}
            className="group rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
          >
            <summary className="cursor-pointer list-none text-[15px] font-medium text-white/90 marker:content-none">
              {f.q}
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-white/65">{f.a}</p>
          </details>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap gap-4 border-t border-white/10 pt-6 text-sm">
        <Link href="/legal/privacy" className="text-cyan-300 underline">Integritetspolicy</Link>
        <Link href="/legal/terms" className="text-cyan-300 underline">Användarvillkor</Link>
        <Link href="/" className="text-white/50 underline">Till startsidan</Link>
      </div>
    </main>
  );
}
