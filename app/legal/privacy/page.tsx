// app/legal/privacy/page.tsx — integritetspolicy. Publik (PUBLIC_ROUTES i
// AppShell): måste vara nåbar utan konto för App Store-review och AdMob.
//
// Texten bor i messages/*.json (legalPrivacy). Den svenska versionen är den
// juridiskt gällande; den engelska är en översättning för läsbarhet, vilket
// står i noten längst ned.
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legalPrivacy");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

/**
 * Ordningen ÄR numreringen i policyn (1–8) och får inte kastas om. `items`
 * anger antalet punkter för de sektioner som är listor.
 */
const SECTIONS = [
  { key: "controller", rich: true },
  { key: "collected", items: 4 },
  { key: "purposes", items: 5 },
  { key: "sharing", items: 6 },
  { key: "retention" },
  { key: "rights", rich: true },
  { key: "cookies" },
  { key: "changes" },
] as const;

export default async function PrivacyPage() {
  const t = await getTranslations("legalPrivacy");

  const mail = (chunks: React.ReactNode) => (
    <a className="text-cyan-300 underline" href="mailto:support@nextwatch.se">
      {chunks}
    </a>
  );
  const strong = (chunks: React.ReactNode) => (
    <span className="font-medium text-white">{chunks}</span>
  );

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 text-neutral-200">
      <p className="text-xs uppercase tracking-widest text-cyan-400/80">NextWatch</p>
      <h1 className="mt-1 text-3xl font-bold text-white">{t("title")}</h1>
      <p className="mt-1 text-sm text-white/40">{t("updated", { date: t("updatedDate") })}</p>

      <div className="prose-invert mt-8 space-y-6 text-[15px] leading-relaxed">
        {SECTIONS.map((section) => (
          <section key={section.key}>
            <h2 className="mb-2 text-lg font-semibold text-white">
              {t(`sections.${section.key}.heading`)}
            </h2>
            {"items" in section ? (
              <ul className="list-disc space-y-1.5 pl-5">
                {Array.from({ length: section.items }, (_, i) => (
                  <li key={i}>{t.rich(`sections.${section.key}.items.i${i}`, { strong })}</li>
                ))}
              </ul>
            ) : "rich" in section ? (
              <p>{t.rich(`sections.${section.key}.body`, { mail })}</p>
            ) : (
              <p>{t(`sections.${section.key}.body`)}</p>
            )}
          </section>
        ))}
      </div>

      <p className="mt-8 text-xs leading-relaxed text-white/35">{t("translationNote")}</p>

      <div className="mt-10 flex flex-wrap gap-4 border-t border-white/10 pt-6 text-sm">
        <Link href="/legal/terms" className="text-cyan-300 underline">{t("linkTerms")}</Link>
        <Link href="/support" className="text-cyan-300 underline">{t("linkSupport")}</Link>
        <Link href="/" className="text-white/50 underline">{t("linkHome")}</Link>
      </div>
    </main>
  );
}
