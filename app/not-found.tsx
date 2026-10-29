// app/not-found.tsx
//
// Egen 404. Innan fanns ingen, så okända adresser gav Nexts generiska
// "404 | This page could not be found." på engelska. Renderas inuti
// root-layouten (AppShell), så navigeringen finns kvar runt vyn.
import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import ErrorScene from "./components/ui/ErrorScene";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notFound");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <div className="mx-auto flex min-h-[70dvh] w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
      <ErrorScene label="404" />
      <h1 className="text-xl font-semibold text-white">{t("title")}</h1>
      <p className="max-w-xs text-sm leading-relaxed text-neutral-400">{t("body")}</p>
      <div className="mt-2 flex w-full max-w-xs flex-col gap-3">
        <Link
          href="/swipe"
          className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-black active:scale-[0.98]"
        >
          {t("swipe")}
        </Link>
        <Link
          href="/"
          className="rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-neutral-200 active:scale-[0.98]"
        >
          {t("home")}
        </Link>
      </div>
    </div>
  );
}
