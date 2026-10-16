"use client";

// Tjänster + ålder som ETT KORT i leken ("nya flödet", prototypens steg 3).
// Visas efter FS_SERVICES_AT swipes för en ny enhet utan tjänster, i stället
// för ProviderPromptSheet (bottenarket) och lika stort som filmkortet — det är
// nästa kort i leken, inte en modal ovanpå den.
//
// - Tjänster: samma nio, i samma ordning, som ProviderPromptSheet/onboardingen,
//   och samma API (POST /api/profile/providers).
// - Ålder: valfri, ett tryck. Sparas direkt via POST /api/profile/age som ett
//   representativt födelsedatum (se den routen för värdena och varför).
// - Leken byggs om när något sparats (retrySoloDeck i föräldern).
//
// Mätning: fs_services_card (visat), fs_age_set (ålder vald) + de gamla stegen
// provider_prompt / provider_saved / provider_dismissed med props.as = "card",
// så kort mot modal går att jämföra i /admin → Tratt.

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { providerLogoUrl } from "@/lib/providerLogos";
import { funnel } from "@/lib/funnel";
import { notify } from "@/app/components/lib/notify";
import { markServicesCardDone } from "./fsDeck";

/** Samma tjänster, i samma ordning, som ProviderPromptSheet och onboardingen. */
const PROVIDERS = [
  "Netflix",
  "Disney+",
  "Prime Video",
  "Max",
  "Viaplay",
  "Apple TV+",
  "SkyShowtime",
  "SVT Play",
  "TV4 Play",
] as const;

type AgeBand = "u15" | "15_17" | "18p";
const AGE_BANDS: AgeBand[] = ["u15", "15_17", "18p"];

export default function ServicesAgeCard({ onDone }: { onDone: (reloadDeck: boolean, providers?: string[]) => void }) {
  const t = useTranslations("fsDeck");
  const [selected, setSelected] = useState<string[]>([]);
  const [age, setAge] = useState<AgeBand | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  // Åldern sparas direkt vid trycket; kedjan gör att ett snabbt "Hoppa över"
  // efteråt väntar in svaret innan leken byggs om.
  const ageChain = useRef<Promise<void>>(Promise.resolve());
  const ageChanged = useRef(false);

  useEffect(() => {
    funnel("fs_services_card");
    funnel("provider_prompt", { as: "card" });
  }, []);

  function toggle(p: string) {
    setError(false);
    setSelected((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  function pickAge(band: AgeBand) {
    if (age === band) return;
    setAge(band);
    ageChain.current = ageChain.current.then(async () => {
      try {
        const res = await fetch("/api/profile/age", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ band }),
        });
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; changed?: boolean };
        if (res.ok && j.ok) {
          if (j.changed) ageChanged.current = true;
          funnel("fs_age_set", { band });
        }
      } catch {
        /* best effort — åldern är valfri */
      }
    });
  }

  async function save() {
    if (selected.length === 0 || saving) return;
    setSaving(true);
    setError(false);
    try {
      const res = await fetch("/api/profile/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ providers: selected }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (!res.ok || !j.ok) {
        setError(true);
        setSaving(false);
        return;
      }
      await ageChain.current;
      funnel("provider_saved", { count: selected.length, as: "card" });
      notify(t("svcSaved", { count: selected.length }));
      markServicesCardDone();
      onDone(true, selected);
    } catch {
      setError(true);
      setSaving(false);
    }
  }

  async function skip() {
    if (saving) return;
    setSaving(true);
    await ageChain.current;
    funnel("provider_dismissed", { as: "card" });
    markServicesCardDone();
    onDone(ageChanged.current);
  }

  const n = selected.length;
  const ageLabel: Record<AgeBand, string> = {
    u15: t("ageUnder15"),
    "15_17": t("age15to17"),
    "18p": t("age18plus"),
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: [0.2, 0.8, 0.2, 1] }}
      className="absolute inset-0 z-[30] flex flex-col overflow-hidden rounded-2xl bg-[#141416] shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_20px_50px_rgba(0,0,0,0.55)]"
      role="group"
      aria-labelledby="fs-services-title"
    >
      {/* Innehållet scrollar på låga skärmar; knapparna ligger kvar längst ned. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-5 pb-2 pt-5">
        <span className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#22d3ee]">{t("svcEyebrow")}</span>
        <h2 id="fs-services-title" className="text-[24px] font-extrabold leading-[1.1] tracking-[-0.02em] text-white">
          {t("svcTitle")}
        </h2>
        <p className="text-[14px] leading-[1.45] text-neutral-400 [@media(max-height:700px)]:hidden">{t("svcBody")}</p>

        <div className="grid grid-cols-3 gap-2">
          {PROVIDERS.map((p) => {
            const on = selected.includes(p);
            const src = providerLogoUrl(p);
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(p)}
                className={[
                  "relative flex h-[52px] items-center justify-center gap-1 rounded-[14px] border px-1 text-[12px] font-semibold tracking-[-0.01em] text-neutral-100 transition-colors active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60",
                  on ? "border-[#22d3ee] bg-[rgba(34,211,238,0.14)]" : "border-white/10 bg-[#1b1b1e]",
                ].join(" ")}
              >
                {src ? (
                  <span className="relative inline-flex h-5 w-5 shrink-0 overflow-hidden rounded-md">
                    <Image src={src} alt="" width={20} height={20} className="h-full w-full object-cover" unoptimized />
                  </span>
                ) : null}
                {/* 390 px bred skärm: "SkyShowtime" och "Prime Video" klipptes med
                    line-clamp-1 — två rader får plats i 52 px. */}
                <span className="line-clamp-2 min-w-0 text-left leading-[1.15]">{p}</span>
                {on ? (
                  <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-[#22d3ee] text-neutral-950">
                    <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mt-1 flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[14px] font-semibold text-white">{t("ageTitle")}</span>
            <span className="text-[11.5px] text-neutral-500">{t("ageHint")}</span>
          </div>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("ageTitle")}>
            {AGE_BANDS.map((b) => {
              const on = age === b;
              return (
                <button
                  key={b}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => pickAge(b)}
                  className={[
                    "h-10 rounded-xl border text-[13.5px] font-semibold transition-colors active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60",
                    on
                      ? "border-[#a78bfa] bg-[rgba(167,139,250,0.16)] text-[#e9e5ff]"
                      : "border-white/10 bg-[#1b1b1e] text-neutral-300",
                  ].join(" ")}
                >
                  {ageLabel[b]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="shrink-0 px-5 pb-3 pt-2">
        {error ? <p className="mb-2 text-center text-xs text-red-400">{t("svcError")}</p> : null}
        <button
          type="button"
          disabled={n === 0 || saving}
          onClick={() => void save()}
          className={[
            "flex h-[50px] w-full items-center justify-center rounded-[14px] text-[15.5px] font-bold transition active:scale-[0.98]",
            n > 0 ? "bg-[#22d3ee] text-[#0a0a0a]" : "bg-[#262629] text-[#8a8a8a]",
          ].join(" ")}
        >
          {saving && n > 0 ? t("svcSaving") : n > 0 ? t("svcCta", { count: n }) : t("svcPickOne")}
        </button>
        <button
          type="button"
          onClick={() => void skip()}
          disabled={saving}
          className="mt-0.5 h-10 w-full text-center text-[14px] text-neutral-400 transition hover:text-neutral-200"
        >
          {t("svcSkip")}
        </button>
      </div>
    </motion.div>
  );
}
