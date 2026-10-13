"use client";

// Tillbaka-pil för sidor som inte är en flik i BottomTabs (t.ex. /profile sedan
// 2026-10-13, som nås via avataren på swipe-skärmen). Utan den fanns ingen väg
// ut ur sidan förutom att trycka på en annan flik.

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";

export default function BackButton({
  fallbackHref = "/swipe",
  className = "",
}: {
  /** Dit vi går när det inte finns någon historik (djuplänk, push, kallstart). */
  fallbackHref?: string;
  className?: string;
}) {
  const router = useRouter();
  const t = useTranslations("common");

  return (
    <button
      type="button"
      onClick={() => {
        // history.length är 1 när sidan öppnades direkt (djuplänk/push i iOS-
        // appen) — då finns inget att gå tillbaka till och router.back() vore
        // en död knapp.
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
      aria-label={t("back")}
      title={t("back")}
      className={`-ml-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/70 transition hover:bg-white/5 hover:text-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${className}`}
    >
      <ChevronLeft aria-hidden className="h-6 w-6" />
    </button>
  );
}
