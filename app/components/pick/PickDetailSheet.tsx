"use client";

// "Välj åt mig" — detaljarket för ett förslag. Varje kort och varje "Eller
// kanske"-rad i tråden och historiken öppnar det här (ägarönskan 2026-10-13:
// "varje rekommendation ska vara klickbar … skicka till en kompis, spara,
// ratea — likt swipe"). Samma handlingar som swipe-kortets baksida:
//   - Öppna i <tjänst> (providerWatchUrl, samma som kortets baksida)
//   - Spara i min lista (förälderns saveItem → /api/watchlist/like)
//   - Tipsa en vän (ShareTitleModal → /api/share/send)
//   - Betygsätt (RatingModal → /api/ratings/save, samma som "Sett" på swipe —
//     tar bort titeln ur watchlist och den kommer inte föreslås igen)
//   - Trailer (hämtas lat via /api/tmdb/details, visas bara om den finns)
// Inget här kostar ett val.
//
// Lagerordning: PickSheet ligger på z-[65] och dess panel är transformerad
// (framer-motion), så `fixed` inuti den hade blivit relativ till panelen.
// Därför portalas arket till body på z-[70]; RatingModal/TrailerModal (z-60)
// renderas inuti samma z-[70]-kontext och hamnar alltså ovanpå valarket.
// Escape fångas i capture-fasen så att bara detaljarket stängs, inte valarket.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, BookmarkCheck, Heart, PlayCircle, Send, Star, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PickItem } from "@/lib/aiPick/types";
import { trackPickEvent } from "@/lib/aiPick/client";
import type { Trailer } from "@/lib/tmdbVideos";
import { providerWatchUrl } from "@/lib/watchLinks";
import TrailerButton from "@/app/components/watch/TrailerButton";
import { notify } from "@/app/components/lib/notify";
import { focusRing, imgUrl, metaLine } from "@/app/components/pick/PickParts";

const RatingModal = dynamic(() => import("@/app/components/client/RatingModal"), { ssr: false });
const ShareTitleModal = dynamic(() => import("@/app/components/client/ShareTitleModal"), { ssr: false });

export type PickDetailFrom = "thread" | "history";

type Props = {
  item: PickItem | null;
  from: PickDetailFrom;
  onClose: () => void;
  saved: boolean;
  saving: boolean;
  onSave: (item: PickItem) => void;
  onOpenService: (item: PickItem, provider: string) => void;
};

/** Trailer per titel — hämtas en gång per sidladdning. */
const trailerCache = new Map<string, Trailer | null>();

export default function PickDetailSheet({ item, from, onClose, saved, saving, onSave, onOpenService }: Props) {
  const t = useTranslations("pick");
  const ts = useTranslations("swipe");
  const [trailer, setTrailer] = useState<Trailer | null | undefined>(undefined);
  const [shareOpen, setShareOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [rateSaving, setRateSaving] = useState(false);
  // Betyg satta i den här sidladdningen (nyckel = mediaType-tmdbId).
  const [rated, setRated] = useState<Record<string, number>>({});
  const open = item !== null;
  const key = item ? `${item.mediaType}-${item.tmdbId}` : "";

  // Lat trailer-hämtning.
  useEffect(() => {
    if (!item) return;
    const k = `${item.mediaType}-${item.tmdbId}`;
    if (trailerCache.has(k)) {
      setTrailer(trailerCache.get(k));
      return;
    }
    setTrailer(undefined);
    let alive = true;
    void fetch(`/api/tmdb/details?type=${item.mediaType}&id=${item.tmdbId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; trailer?: Trailer | null } | null) => {
        const tr = j?.ok ? (j.trailer ?? null) : null;
        trailerCache.set(k, tr);
        if (alive) setTrailer(tr);
      })
      .catch(() => {
        if (alive) setTrailer(null);
      });
    return () => {
      alive = false;
    };
  }, [item]);

  // Escape stänger bara det översta lagret.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (shareOpen) setShareOpen(false);
      else if (rateOpen) setRateOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, shareOpen, rateOpen, onClose]);

  useEffect(() => {
    if (!open) {
      setShareOpen(false);
      setRateOpen(false);
    }
  }, [open]);

  const submitRating = (rating: number) => {
    if (!item) return;
    const it = item;
    setRateSaving(true);
    void fetch("/api/ratings/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ tmdbId: it.tmdbId, mediaType: it.mediaType, rating }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        setRated((r) => ({ ...r, [`${it.mediaType}-${it.tmdbId}`]: rating }));
        trackPickEvent("rate", { tmdbId: it.tmdbId, rating, fromSaved: it.fromSaved, from });
        notify(t("detail.rated", { rating }));
      })
      .catch(() => notify(t("detail.rateFailed")))
      .finally(() => {
        setRateSaving(false);
        setRateOpen(false);
      });
  };

  if (typeof document === "undefined") return null;

  const myRating = item ? rated[key] : undefined;
  const hero = item ? (item.backdrop ?? item.poster) : null;
  const heroUrl = hero?.startsWith("/") ? `https://image.tmdb.org/t/p/w780${hero}` : hero?.startsWith("http") ? hero : null;
  const services = item
    ? item.providers
        .map((p) => ({ ...p, url: providerWatchUrl(p.name, item.title) }))
        .filter((p) => p.url || p.logo)
        .slice(0, 6)
    : [];
  const primary = services.find((p) => p.url) ?? null;
  const meta = item ? metaLine(item, t, 3) : "";

  const actionCls = `flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl border px-1 text-[12px] font-medium transition active:scale-[0.97] disabled:active:scale-100 ${focusRing}`;
  const idle = "border-white/10 bg-white/[0.05] text-white/85 hover:bg-white/10";

  return createPortal(
    <div className="relative z-[70]">
      <AnimatePresence>
        {item ? (
          <div key="pick-detail" data-blocking-sheet className="fixed inset-0 z-[70] flex items-end justify-center">
            <motion.button
              type="button"
              aria-label={t("close")}
              onClick={onClose}
              className="absolute inset-0 h-full w-full cursor-default bg-black/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="pick-detail-title"
              className="relative flex max-h-[86dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-neutral-950 shadow-2xl"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
            >
              <div className="relative h-40 shrink-0 overflow-hidden">
                {heroUrl ? (
                  <Image src={heroUrl} alt="" fill sizes="448px" className="object-cover object-top" draggable={false} />
                ) : (
                  <div className="h-full w-full bg-neutral-900" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/50 to-transparent" />
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t("close")}
                  className={`absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white/85 ring-1 ring-white/15 transition hover:bg-black/75 ${focusRing}`}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
                <div className="absolute inset-x-0 bottom-0 px-4 pb-2">
                  {item.fromSaved ? (
                    <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-400/25">
                      <Heart className="h-3 w-3 fill-current" aria-hidden />
                      {t("likedMarker")}
                    </span>
                  ) : null}
                  <h3 id="pick-detail-title" className="text-xl font-bold leading-tight text-white">
                    {item.title}
                  </h3>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  {typeof item.rating === "number" && item.rating > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-400/40">
                      ★ {item.rating.toFixed(1)}
                    </span>
                  ) : null}
                  {meta ? <span className="text-[13px] text-white/55">{meta}</span> : null}
                </div>

                <p className="mt-3 text-sm leading-relaxed text-white/75">
                  {item.overview || ts("noDescription")}
                </p>

                {services.length > 0 ? (
                  <ul aria-label={t("providersAria")} className="mt-3 flex flex-wrap gap-1.5">
                    {services.map((p) => {
                      const logo = imgUrl(p.logo, "w92");
                      const inner = (
                        <>
                          {logo ? (
                            <span className="relative inline-block h-4 w-4 overflow-hidden rounded">
                              <Image src={logo} alt="" fill sizes="16px" className="object-contain" />
                            </span>
                          ) : null}
                          <span className="text-[11px]">{p.name}</span>
                        </>
                      );
                      const cls =
                        "inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-neutral-200";
                      return (
                        <li key={p.name}>
                          {p.url ? (
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => onOpenService(item, p.name)}
                              className={`${cls} transition hover:border-cyan-400/40 hover:bg-cyan-400/10`}
                            >
                              {inner}
                            </a>
                          ) : (
                            <span className={cls}>{inner}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>

              <div className="shrink-0 space-y-2.5 px-4 pt-3">
                {primary?.url ? (
                  <a
                    href={primary.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => onOpenService(item, primary.name)}
                    className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 text-[15px] font-semibold text-black transition hover:bg-cyan-400 active:scale-[0.98] ${focusRing}`}
                  >
                    <PlayCircle className="h-5 w-5 shrink-0" aria-hidden />
                    <span className="truncate">{t("openIn", { service: primary.name })}</span>
                  </a>
                ) : null}

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => onSave(item)}
                    disabled={saved || saving}
                    className={`${actionCls} ${
                      saved ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : `${idle} disabled:opacity-60`
                    }`}
                  >
                    {saved ? <BookmarkCheck className="h-5 w-5" aria-hidden /> : <Bookmark className="h-5 w-5" aria-hidden />}
                    {saved ? t("detail.saved") : t("detail.save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      trackPickEvent("share_open", { tmdbId: item.tmdbId, fromSaved: item.fromSaved, from });
                      setShareOpen(true);
                    }}
                    className={`${actionCls} ${idle}`}
                  >
                    <Send className="h-5 w-5" aria-hidden />
                    {t("detail.share")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRateOpen(true)}
                    className={`${actionCls} ${
                      myRating ? "border-amber-300/25 bg-amber-300/10 text-amber-200" : idle
                    }`}
                  >
                    <Star className={`h-5 w-5 ${myRating ? "fill-current" : ""}`} aria-hidden />
                    {myRating ? t("detail.yourRating", { rating: myRating }) : t("detail.rate")}
                  </button>
                </div>

                {trailer ? (
                  <div
                    className="flex justify-center [&>button]:w-full [&>button]:min-h-11 [&>button]:rounded-2xl"
                    onClickCapture={() => trackPickEvent("trailer", { tmdbId: item.tmdbId, from })}
                  >
                    <TrailerButton trailer={trailer} title={item.title} variant="ghost" />
                  </div>
                ) : null}
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      <ShareTitleModal
        open={shareOpen && item !== null}
        item={
          item
            ? {
                tmdbId: item.tmdbId,
                mediaType: item.mediaType,
                title: item.title,
                year: item.year ? String(item.year) : null,
                poster: item.poster,
              }
            : null
        }
        onClose={() => setShareOpen(false)}
      />
      <RatingModal
        open={rateOpen && item !== null}
        item={
          item
            ? {
                tmdbId: item.tmdbId,
                mediaType: item.mediaType,
                title: item.title,
                year: item.year ? String(item.year) : null,
                poster: item.poster,
              }
            : null
        }
        heading={t("detail.rateHeading")}
        initialRating={myRating}
        saving={rateSaving}
        onRate={submitRating}
        onSkip={() => setRateOpen(false)}
      />
    </div>,
    document.body
  );
}
