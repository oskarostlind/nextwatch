"use client";

// "Vilka tjänster har du?" — bottenark inne i solo-swipen för profiler utan
// streamingtjänster (i praktiken gäster som tog snabbvägen "Hoppa in som gäst"
// och därför aldrig såg onboardingens tjänstesteg). Utan tjänster finns inget
// providerfilter, så däcket fylls av titlar man inte kan se.
//
// UX-val (mobil först):
//   - Frågar först efter TRIGGER_AFTER_SWIPES swipes: användaren har kommit in
//     och fått smaka på appen innan vi ber om något — snabbvägen förblir snabb.
//   - Visas EN gång per enhet (markeras när arket öppnas, inte när det stängs,
//     så att en dödad app inte ger arket igen). Ändras sedan i Profil.
//   - Stora tryckytor (3 kolumner, ~100 px höga rutor), tumvänliga knappar
//     längst ner, dra-ned-för-att-stänga, safe-area i botten.
//   - Väntar om en genomgång (tour) håller låset — aldrig två lager samtidigt.
//
// Sparar via POST /api/profile/providers (bara tjänsterna) och bygger om
// solo-leken så nästa kort redan är filtrerat.

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { providerLogoUrl } from "@/lib/providerLogos";
import { retrySoloDeck } from "@/lib/swipeDeckStore";
import { tourLockHeldBy } from "@/lib/tours/lock";
import { notify } from "@/app/components/lib/notify";

/** Samma tjänster, i samma ordning, som onboardingens tjänstesteg. */
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

/** Event som solo-swipen skickar per genomförd swipe. */
export const SOLO_SWIPED_EVENT = "nw:solo-swiped";

const TRIGGER_AFTER_SWIPES = 5;
const SEEN_KEY = "nw_provider_prompt_seen";

function alreadySeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* privat läge — arket kan då komma igen nästa session, acceptabelt */
  }
}

export default function ProviderPromptSheet() {
  const t = useTranslations("providerPrompt");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const swipes = useRef(0);
  const done = useRef(false);

  useEffect(() => {
    if (alreadySeen()) {
      done.current = true;
      return;
    }
    const onSwipe = () => {
      if (done.current) return;
      swipes.current += 1;
      if (swipes.current < TRIGGER_AFTER_SWIPES) return;
      // En genomgång kör — försök igen vid nästa swipe.
      if (tourLockHeldBy()) return;
      // Låt swipe-animationen landa innan arket glider upp.
      done.current = true;
      markSeen();
      window.setTimeout(() => setOpen(true), 350);
    };
    window.addEventListener(SOLO_SWIPED_EVENT, onSwipe);
    return () => window.removeEventListener(SOLO_SWIPED_EVENT, onSwipe);
  }, []);

  function toggle(p: string) {
    setError(false);
    setSelected((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
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
        return;
      }
      setOpen(false);
      notify(t("saved"));
      // Den cachade leken byggdes utan providerfilter — bygg om den.
      void retrySoloDeck();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  const close = () => {
    if (!saving) setOpen(false);
  };

  return (
    <AnimatePresence>
      {open ? (
        <div
          key="provider-prompt"
          className="fixed inset-0 z-[66] flex items-end justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="provider-prompt-title"
        >
          <motion.button
            type="button"
            aria-label={t("skip")}
            onClick={close}
            className="absolute inset-0 h-full w-full cursor-default bg-black/65 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
          <motion.div
            className="relative w-full max-w-md"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34, mass: 0.9 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 600) close();
            }}
          >
            <div className="flex max-h-[88dvh] flex-col overflow-hidden rounded-t-3xl border border-b-0 border-white/10 bg-neutral-900/95 shadow-[0_-18px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl">
              {/* Draghandtag — hela raden är greppbar. */}
              <div className="flex shrink-0 cursor-grab justify-center pb-1 pt-2.5 active:cursor-grabbing">
                <span className="h-1 w-9 rounded-full bg-white/20" />
              </div>

              <div className="shrink-0 px-5 pb-3 pt-1.5">
                <h2 id="provider-prompt-title" className="text-xl font-bold leading-snug text-white">
                  {t("title")}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-neutral-400">{t("body")}</p>
              </div>

              {/* Rutnätet scrollar själv på små skärmar; knapparna ligger kvar. */}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2">
                <div className="grid grid-cols-3 gap-2.5">
                  {PROVIDERS.map((p, i) => {
                    const on = selected.includes(p);
                    const src = providerLogoUrl(p);
                    return (
                      <motion.button
                        key={p}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(p)}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.03 * i + 0.08, duration: 0.22 }}
                        whileTap={{ scale: 0.94 }}
                        className={[
                          "relative flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-2xl border px-1.5 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50",
                          on
                            ? "border-cyan-400 bg-cyan-400/10 shadow-[0_0_14px_rgba(34,211,238,0.18)]"
                            : "border-white/10 bg-white/[0.04]",
                        ].join(" ")}
                      >
                        {src ? (
                          <span className="relative inline-flex h-11 w-11 overflow-hidden rounded-xl">
                            <Image src={src} alt="" width={44} height={44} className="h-full w-full object-cover" unoptimized />
                          </span>
                        ) : (
                          <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/15 text-base font-bold text-white">
                            {p.slice(0, 1)}
                          </span>
                        )}
                        <span className="line-clamp-1 text-center text-[12px] font-medium leading-tight text-neutral-200">
                          {p}
                        </span>
                        <AnimatePresence>
                          {on ? (
                            <motion.span
                              key="check"
                              initial={{ scale: 0.4, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0.4, opacity: 0 }}
                              transition={{ type: "spring", stiffness: 500, damping: 26 }}
                              className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-cyan-400 text-neutral-950"
                            >
                              <Check className="h-3 w-3" strokeWidth={3.5} />
                            </motion.span>
                          ) : null}
                        </AnimatePresence>
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              <div className="shrink-0 border-t border-white/5 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3">
                {error ? <p className="mb-2 text-center text-xs text-red-400">{t("error")}</p> : null}
                <button
                  type="button"
                  disabled={selected.length === 0 || saving}
                  onClick={() => void save()}
                  className="flex h-12 w-full items-center justify-center rounded-2xl bg-cyan-500 text-[15px] font-semibold text-neutral-950 transition hover:bg-cyan-400 active:scale-[0.98] disabled:bg-white/10 disabled:text-neutral-500"
                >
                  {saving
                    ? t("saving")
                    : selected.length === 0
                      ? t("pickOne")
                      : t("cta", { count: selected.length })}
                </button>
                <button
                  type="button"
                  onClick={close}
                  disabled={saving}
                  className="mt-1 h-11 w-full text-center text-sm text-neutral-500 transition hover:text-neutral-300"
                >
                  {t("skip")}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
