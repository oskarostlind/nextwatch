// app/legal/terms/page.tsx — användarvillkor. Publik (PUBLIC_ROUTES i AppShell).
//
// Texten bor i messages/*.json (legalTerms). Den svenska versionen är den
// juridiskt gällande; den engelska är en översättning för läsbarhet, vilket
// står i noten längst ned.
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legalTerms");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

const SECTIONS = ["service", "account", "premium", "conduct", "thirdParty", "liability", "changes", "contact"] as const;

export default async function TermsPage() {
  const t = await getTranslations("legalTerms");

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 text-neutral-200">
      <p className="text-xs uppercase tracking-widest text-cyan-400/80">NextWatch</p>
      <h1 className="mt-1 text-3xl font-bold text-white">{t("title")}</h1>
      <p className="mt-1 text-sm text-white/40">{t("updated", { date: t("updatedDate") })}</p>

      <div className="mt-8 space-y-6 text-[15px] leading-relaxed">
        {SECTIONS.map((key) => (
          <section key={key}>
            <h2 className="mb-2 text-lg font-semibold text-white">{t(`sections.${key}.heading`)}</h2>
            <p>
              {key === "contact"
                ? t.rich("sections.contact.body", {
                    mail: (chunks) => (
                      <a className="text-cyan-300 underline" href="mailto:support@nextwatch.se">
                        {chunks}
                      </a>
                    ),
                  })
                : t(`sections.${key}.body`)}
            </p>
          </section>
        ))}
      </div>

      <p className="mt-8 text-xs leading-relaxed text-white/35">{t("translationNote")}</p>

      <div className="mt-10 flex flex-wrap gap-4 border-t border-white/10 pt-6 text-sm">
        <Link href="/legal/privacy" className="text-cyan-300 underline">{t("linkPrivacy")}</Link>
        <Link href="/support" className="text-cyan-300 underline">{t("linkSupport")}</Link>
        <Link href="/" className="text-white/50 underline">{t("linkHome")}</Link>
      </div>
    </main>
  );
}
