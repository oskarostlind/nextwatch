// app/support/page.tsx — supportsida. Publik (PUBLIC_ROUTES i AppShell);
// URL:en används som support-URL i App Store Connect.
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("support");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

/** Bara ordningen; frågorna och svaren bor i messages/*.json (support.faq). */
const FAQ_KEYS = ["noRecs", "groups", "cancelPremium", "deleteAccount", "notifications", "bug"] as const;

export default async function SupportPage() {
  const t = await getTranslations("support");

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 text-neutral-200">
      <p className="text-xs uppercase tracking-widest text-cyan-400/80">NextWatch</p>
      <h1 className="mt-1 text-3xl font-bold text-white">{t("title")}</h1>
      <p className="mt-2 text-white/60">
        {t.rich("intro", {
          mail: (chunks) => (
            <a className="font-medium text-cyan-300 underline" href="mailto:support@nextwatch.se">
              {chunks}
            </a>
          ),
        })}
      </p>

      <h2 className="mt-8 text-lg font-semibold text-white">{t("faqHeading")}</h2>
      <div className="mt-3 grid gap-2">
        {FAQ_KEYS.map((key) => (
          <details
            key={key}
            className="group rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
          >
            <summary className="cursor-pointer list-none text-[15px] font-medium text-white/90 marker:content-none">
              {t(`faq.${key}.q`)}
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-white/65">{t(`faq.${key}.a`)}</p>
          </details>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap gap-4 border-t border-white/10 pt-6 text-sm">
        <Link href="/legal/privacy" className="text-cyan-300 underline">{t("linkPrivacy")}</Link>
        <Link href="/legal/terms" className="text-cyan-300 underline">{t("linkTerms")}</Link>
        <Link href="/" className="text-white/50 underline">{t("linkHome")}</Link>
      </div>
    </main>
  );
}
