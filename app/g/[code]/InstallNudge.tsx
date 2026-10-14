"use client";

// Lugn, stängbar ruta för vännen på webben: "Ladda ner NextWatch så sparas er
// grupp". Ingen spärr, ingen modal — en låg rad ovanför leken som dyker upp
// först efter första swipen (då har hen fått prova). Visas aldrig i våra appar
// och aldrig på Android (Google Play är inte live än). Stängd = borta i 14 dagar.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { funnel } from "@/lib/funnel";
import { canShowAppStore } from "./AppStoreLink";

const DISMISS_KEY = "nw_g_install_dismissed_until";
const DISMISS_DAYS = 14;

function dismissedNow(): boolean {
  try {
    return Number(localStorage.getItem(DISMISS_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

export default function InstallNudge({ visible, href }: { visible: boolean; href: string }) {
  const t = useTranslations("invite");
  const [eligible, setEligible] = useState(false);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    setEligible(canShowAppStore() && !dismissedNow());
  }, []);

  if (!visible || !eligible || closed) return null;

  function close() {
    setClosed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86400_000));
    } catch {
      /* privat läge */
    }
  }

  return (
    <div className="mx-4 mb-2 flex items-center gap-2.5 rounded-[14px] border border-white/10 bg-[#141416] py-2 pl-3.5 pr-1.5">
      <span className="flex-1 text-[13px] leading-snug text-neutral-300">{t("install.text")}</span>
      <a
        href={href}
        rel="noopener"
        onClick={() => funnel("web_to_install", { from: "link" })}
        className="inline-flex h-9 items-center rounded-[10px] border border-white/15 px-3 text-[13px] font-semibold text-neutral-100"
      >
        {t("install.cta")}
      </a>
      <button
        type="button"
        onClick={close}
        aria-label={t("install.close")}
        className="grid h-9 w-9 place-items-center rounded-full text-neutral-500"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
