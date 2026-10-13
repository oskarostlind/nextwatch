"use client";

// "Välj åt mig" — bottenarket. Öppnas av PickLauncher (✦ i swipens topprad).
//
// Tillstånd: ask → loading → result, plus paywall och error. Servern
// (/api/pick*) är källan till sanning för kvoten; arket läser den cachade
// kvoten direkt vid öppning och hämtar en färsk i bakgrunden.
//
// Ägarens prioritet: AI:n ska helst välja något användaren REDAN gillat men
// inte sett. Därför visas "Du gillade den för 3 veckor sedan" tydligt när valet
// kommer från de sparade — poängen är att få folk att faktiskt se det de
// swipat ja på.
//
// Monetisering (se PICK_SPEC):
//   - Gratis: 0 val utan vidare. Belöningsvideo (bara native iOS) → +N val.
//     Premium-CTA visas alltid för gratisanvändare (på webben är den enda vägen).
//   - Premium: 20 val/månad. Slut → belöningsvideo som påfyllnad (iOS), annars
//     bara beskedet att månaden nollställs.
// Premium-CTA:n leder till /premium (inte direkt till köpet) — där finns
// pris/period/förnyelse-texten som App Review kräver vid köptillfället (3.1.2c).

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import {
  ArrowUp,
  Bookmark,
  BookmarkCheck,
  Clock,
  Crown,
  Heart,
  Info,
  PlayCircle,
  RefreshCw,
  Shuffle,
  Smile,
  Sparkles,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { PickChipId, PickItem, PickQuota, PickRequestBody } from "@/lib/aiPick/types";
import { getPickStatus, requestPick, trackPickEvent } from "@/lib/aiPick/client";
import { watchRewardedForPicks } from "@/lib/admobAds";
import { isNativeIos } from "@/lib/premiumPurchase";
import { providerWatchUrl } from "@/lib/watchLinks";
import { useSwipeSettings } from "@/app/components/client/SwipeSettingsProvider";
import { notify } from "@/app/components/lib/notify";

type View = "ask" | "loading" | "result" | "paywall" | "error";
type ErrorKind = "no_candidates" | "unavailable" | "disabled";
type Query = { prompt?: string; chips?: PickChipId[]; mediaFilter: "both" | "movie" | "tv" };

const CHIPS: { id: PickChipId; icon: LucideIcon }[] = [
  { id: "light", icon: Smile },
  { id: "short", icon: Clock },
  { id: "thrilling", icon: Zap },
  { id: "surprise", icon: Shuffle },
];

const LOADING_KEYS = ["saved", "taste", "services", "almost"] as const;
const LOADING_STEP_MS = 1700;

/** Kritiskt dämpad spring (damping = 2·√stiffness vid mass 1) — ingen studs. */
const SHEET_SPRING = { type: "spring" as const, stiffness: 380, damping: 39 };
const VIEW_FADE = { duration: 0.16, ease: "easeOut" as const };

const TMDB_IMG = "https://image.tmdb.org/t/p";

/** TMDB-sökväg (/abc.jpg) eller färdig URL → URL. */
function imgUrl(src: string | null | undefined, size: "w92" | "w342"): string | null {
  if (!src) return null;
  if (src.startsWith("http")) return src;
  if (src.startsWith("/")) return `${TMDB_IMG}/${size}${src}`;
  return null;
}

const itemKey = (it: Pick<PickItem, "tmdbId" | "mediaType">) => `${it.mediaType}-${it.tmdbId}`;

/** Hela kalenderdagar mellan likedAt och idag, i användarens tidszon. */
function daysSince(iso: string): number | null {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const now = new Date();
  const a = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

type T = ReturnType<typeof useTranslations>;

function likedLine(item: PickItem, t: T): string {
  const d = item.likedAt ? daysSince(item.likedAt) : null;
  if (d === null) return t("liked.fromSaved");
  if (d === 0) return t("liked.today");
  if (d === 1) return t("liked.yesterday");
  if (d < 7) return t("liked.days", { count: d });
  if (d < 30) return t("liked.weeks", { count: Math.floor(d / 7) });
  if (d < 365) return t("liked.months", { count: Math.max(1, Math.floor(d / 30)) });
  return t("liked.years", { count: Math.floor(d / 365) });
}

function runtimeText(item: PickItem, t: T): string | null {
  const m = item.runtimeMin;
  if (!m || m <= 0) return null;
  if (item.mediaType === "tv") return t("runtimeEpisode", { min: m });
  if (m < 60) return t("runtime", { min: m });
  return t("runtimeHm", { h: Math.floor(m / 60), m: m % 60 });
}

function metaLine(item: PickItem, t: T, genres = 2): string {
  return [item.year ? String(item.year) : null, ...item.genres.slice(0, genres), runtimeText(item, t)]
    .filter(Boolean)
    .join(" · ");
}

/** Första tjänsten vi kan direktlänka till (samma hjälpare som kortets baksida). */
function bestService(item: PickItem): { name: string; logo: string | null; url: string } | null {
  for (const p of item.providers) {
    const url = providerWatchUrl(p.name, item.title);
    if (url) return { name: p.name, logo: p.logo, url };
  }
  return null;
}

/* ---------- små byggstenar ---------- */

function Poster({ src, title, className }: { src: string | null; title: string; className: string }) {
  const url = imgUrl(src, "w342");
  return (
    <div className={`relative shrink-0 overflow-hidden bg-white/[0.06] ring-1 ring-white/10 ${className}`}>
      {url ? (
        // Dekorativ: titeln står alltid i klartext bredvid postern.
        <Image src={url} alt="" fill sizes="120px" className="object-cover" draggable={false} />
      ) : (
        <div className="flex h-full w-full items-center justify-center p-1 text-center text-[10px] text-white/40">
          {title}
        </div>
      )}
    </div>
  );
}

function Pulse({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/10 ${className}`} />;
}

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60";

/* ---------- arket ---------- */

export default function PickSheet({
  open,
  onClose,
  initialQuota,
}: {
  open: boolean;
  onClose: () => void;
  initialQuota: PickQuota | null;
}) {
  const t = useTranslations("pick");
  const router = useRouter();
  const { mediaFilter } = useSwipeSettings();
  const dragControls = useDragControls();
  const panelRef = useRef<HTMLDivElement>(null);
  const native = isNativeIos();

  const [view, setView] = useState<View>("ask");
  const viewRef = useRef<View>("ask");
  const [quota, setQuota] = useState<PickQuota | null>(initialQuota);
  const [errorKind, setErrorKind] = useState<ErrorKind>("unavailable");
  const [text, setText] = useState("");

  // Resultat
  const [main, setMain] = useState<PickItem | null>(null);
  const [alts, setAlts] = useState<PickItem[]>([]);
  const [reason, setReason] = useState("");
  const [reasonFor, setReasonFor] = useState<string>("");
  const [savedKeys, setSavedKeys] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [nudge, setNudge] = useState(false);

  // Paywall
  const [adBusy, setAdBusy] = useState(false);
  const [adError, setAdError] = useState(false);
  const [unlocked, setUnlocked] = useState<number | null>(null);

  const [loadingStep, setLoadingStep] = useState(0);

  // Sessionstillstånd (nollställs vid varje öppning)
  const shownIds = useRef<number[]>([]);
  const lastQuery = useRef<Query | null>(null);
  const nudgeUsed = useRef(false);
  const requestSeq = useRef(0);

  const go = useCallback((v: View) => {
    viewRef.current = v;
    setView(v);
  }, []);

  const goPaywall = useCallback(
    (q: PickQuota | null) => {
      go("paywall");
      setAdError(false);
      trackPickEvent("paywall_view", { premium: Boolean(q?.premium), native });
      if (!q?.premium) trackPickEvent("upsell_view", { from: "paywall" });
    },
    [go, native]
  );

  /* ----- öppning: nollställ sessionen, välj startvy, hämta färsk kvot ----- */
  useEffect(() => {
    if (!open) return;
    requestSeq.current += 1;
    const seq = requestSeq.current;
    shownIds.current = [];
    lastQuery.current = null;
    nudgeUsed.current = false;
    setMain(null);
    setAlts([]);
    setReason("");
    setReasonFor("");
    setInfoOpen(false);
    setNudge(false);
    setUnlocked(null);
    setAdError(false);
    setText("");

    const q = initialQuota;
    setQuota(q);
    if (q && q.totalLeft <= 0) goPaywall(q);
    else go("ask");

    void getPickStatus({ fresh: true }).then((fresh) => {
      if (!fresh || seq !== requestSeq.current) return;
      setQuota(fresh);
      if (viewRef.current === "ask" && fresh.totalLeft <= 0) goPaywall(fresh);
      else if (viewRef.current === "paywall" && fresh.totalLeft > 0) go("ask");
    });
    // initialQuota läses bara vid öppningen — senare ändringar ägs av arket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* ----- scroll-lås, fokus, Esc ----- */
  const requestClose = useCallback(() => {
    trackPickEvent("close", { view: viewRef.current });
    requestSeq.current += 1; // svar som kommer efter stängning ignoreras
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => panelRef.current?.focus({ preventScroll: true }), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, requestClose]);

  /* ----- roterande statusrad under laddning ----- */
  useEffect(() => {
    if (view !== "loading") return;
    setLoadingStep(0);
    const id = window.setInterval(
      () => setLoadingStep((s) => Math.min(s + 1, LOADING_KEYS.length - 1)),
      LOADING_STEP_MS
    );
    return () => window.clearInterval(id);
  }, [view]);

  /* ----- förfrågan ----- */
  const run = useCallback(
    async (query: Query) => {
      if (quota && quota.totalLeft <= 0) {
        goPaywall(quota);
        return;
      }
      lastQuery.current = query;
      requestSeq.current += 1;
      const seq = requestSeq.current;
      setNudge(false);
      setUnlocked(null);
      setInfoOpen(false);
      go("loading");

      const body: PickRequestBody = { mediaFilter: query.mediaFilter };
      if (query.prompt) body.prompt = query.prompt;
      if (query.chips?.length) body.chips = query.chips;
      if (shownIds.current.length) body.exclude = [...shownIds.current];

      const res = await requestPick(body);
      if (seq !== requestSeq.current) return;
      if (res.quota) setQuota(res.quota);

      if (res.ok) {
        const ids = [res.pick, ...res.alternatives].map((x) => x.tmdbId);
        shownIds.current = Array.from(new Set([...shownIds.current, ...ids]));
        setMain(res.pick);
        setAlts(res.alternatives.slice(0, 2));
        setReason(res.reason);
        setReasonFor(itemKey(res.pick));
        // Premium-nudge: en gång per arksession, aldrig för premium.
        if (!res.quota.premium && !nudgeUsed.current) {
          nudgeUsed.current = true;
          setNudge(true);
          trackPickEvent("upsell_view", { from: "result" });
        }
        go("result");
        return;
      }

      switch (res.error) {
        case "no_quota":
          goPaywall(res.quota ?? quota);
          return;
        case "no_candidates":
          setErrorKind("no_candidates");
          break;
        case "disabled":
          setErrorKind("disabled");
          break;
        default:
          setErrorKind("unavailable");
      }
      go("error");
    },
    [go, goPaywall, quota]
  );

  const onChip = (id: PickChipId) => {
    trackPickEvent("chip", { chip: id });
    void run({ chips: [id], mediaFilter });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const prompt = text.trim().slice(0, 300);
    if (!prompt) return;
    trackPickEvent("submit", { len: prompt.length });
    void run({ prompt, mediaFilter });
  };

  const onAnother = () => {
    trackPickEvent("another", main ? { tmdbId: main.tmdbId } : undefined);
    void run(lastQuery.current ?? { mediaFilter });
  };

  const onAltSelect = (alt: PickItem) => {
    if (!main) return;
    trackPickEvent("alt_select", { tmdbId: alt.tmdbId, fromSaved: alt.fromSaved });
    const prev = main;
    setMain(alt);
    setAlts((list) => list.map((a) => (itemKey(a) === itemKey(alt) ? prev : a)));
    setInfoOpen(false);
  };

  const onSave = async () => {
    if (!main || saving) return;
    const key = itemKey(main);
    setSaving(true);
    try {
      const res = await fetch("/api/watchlist/like", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          tmdbId: main.tmdbId,
          mediaType: main.mediaType,
          title: main.title,
          year: main.year ? String(main.year) : null,
          poster: main.poster,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSavedKeys((s) => new Set(s).add(key));
      trackPickEvent("save", { tmdbId: main.tmdbId, fromSaved: main.fromSaved });
      notify(t("savedToast"));
    } catch {
      notify(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const onWatchAd = async () => {
    if (adBusy) return;
    setAdBusy(true);
    setAdError(false);
    trackPickEvent("ad_start", { premium: Boolean(quota?.premium) });
    const ok = await watchRewardedForPicks();
    const fresh = await getPickStatus({ fresh: true });
    if (fresh) setQuota(fresh);
    setAdBusy(false);
    if (ok) {
      trackPickEvent("ad_complete", { premium: Boolean(quota?.premium) });
      setUnlocked(fresh?.rewardPicks ?? quota?.rewardPicks ?? 3);
      go("ask");
    } else {
      trackPickEvent("ad_fail", { premium: Boolean(quota?.premium) });
      setAdError(true);
    }
  };

  const onPremium = (from: "paywall" | "result") => {
    trackPickEvent("upsell_click", { from });
    onClose();
    router.push("/premium");
  };

  /* ---------- rendering ---------- */

  if (typeof document === "undefined") return null;

  const premium = Boolean(quota?.premium);
  const monthly = quota?.premiumMonthly ?? 20;
  const rewardPicks = quota?.rewardPicks ?? 3;
  const showQuotaLine = quota !== null && quota.totalLeft <= 1;

  const quotaLine = showQuotaLine ? (
    <p className="text-center text-xs text-white/45">{t("quotaLeft", { count: Math.max(0, quota.totalLeft) })}</p>
  ) : null;

  const askView = (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-white/55">{t("subtitle")}</p>

      {unlocked !== null ? (
        <p role="status" className="rounded-xl bg-white/[0.06] px-3 py-2 text-sm text-white/85">
          {t("paywall.unlocked", { count: unlocked })}
        </p>
      ) : null}

      <div role="group" aria-label={t("chipsAria")} className="grid grid-cols-2 gap-2">
        {CHIPS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChip(id)}
            className={`flex min-h-12 items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm font-medium text-white/85 transition hover:border-white/20 hover:bg-white/[0.08] active:scale-[0.98] ${focusRing}`}
          >
            <Icon className="h-4 w-4 shrink-0 text-white/50" aria-hidden />
            {t(`chips.${id}`)}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          enterKeyHint="send"
          placeholder={t("inputPlaceholder")}
          aria-label={t("inputAria")}
          className="h-12 min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-white placeholder:text-white/35 focus:border-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label={t("send")}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cyan-400 text-neutral-950 transition hover:bg-cyan-300 active:scale-95 disabled:bg-white/10 disabled:text-white/35 disabled:active:scale-100 ${focusRing}`}
        >
          <ArrowUp className="h-5 w-5" strokeWidth={2.5} aria-hidden />
        </button>
      </form>

      {/* Välkomstval för nya konton: säg det rakt ut, så att första
          försöket känns gratis i stället för som en kostnad. Vid ≤1 kvar tar
          den vanliga kvotraden över. */}
      {quota && !premium && quota.welcomeLeft > 1 && quota.totalLeft > 1 ? (
        <p className="text-center text-xs text-white/55">{t("welcomeLeft", { count: quota.welcomeLeft })}</p>
      ) : null}
      {quota && quota.totalLeft > 0 ? quotaLine : null}
    </div>
  );

  const loadingView = (
    <div aria-busy="true" aria-label={t("loadingAria")} className="space-y-4">
      <div className="flex gap-4">
        <Pulse className="aspect-[2/3] w-[100px] shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2.5 pt-1">
          <Pulse className="h-4 w-28 rounded-full" />
          <Pulse className="h-6 w-4/5" />
          <Pulse className="h-3.5 w-3/5" />
          <div className="flex gap-1.5 pt-1">
            <Pulse className="h-7 w-7" />
            <Pulse className="h-7 w-7" />
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <Pulse className="h-3.5 w-full" />
        <Pulse className="h-3.5 w-11/12" />
      </div>
      <Pulse className="h-12 w-full rounded-2xl" />
      <div className="flex h-5 items-center justify-center gap-2 text-sm text-white/55" aria-live="polite">
        <Sparkles className="h-3.5 w-3.5 text-white/40" aria-hidden />
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={loadingStep}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={VIEW_FADE}
          >
            {t(`loading.${LOADING_KEYS[loadingStep]}`)}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );

  const resultView = main
    ? (() => {
        const key = itemKey(main);
        const service = bestService(main);
        const saved = main.inWatchlist || savedKeys.has(key);
        const isOriginal = key === reasonFor;
        const meta = metaLine(main, t);
        const logos = main.providers.filter((p) => imgUrl(p.logo, "w92")).slice(0, 4);
        return (
          <div className="space-y-4">
            <div className="flex gap-4">
              <Poster src={main.poster} title={main.title} className="aspect-[2/3] w-[100px] rounded-xl" />
              <div className="min-w-0 flex-1">
                {main.fromSaved ? (
                  <span className="mb-1.5 inline-flex max-w-full items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-400/25">
                    <Heart className="h-3 w-3 shrink-0 fill-current" aria-hidden />
                    <span className="truncate">{likedLine(main, t)}</span>
                  </span>
                ) : null}
                <h3 id="pick-result-title" className="text-xl font-bold leading-tight text-white">
                  {main.title}
                </h3>
                {meta ? <p className="mt-1 text-[13px] leading-snug text-white/50">{meta}</p> : null}
                {logos.length > 0 ? (
                  <ul aria-label={t("providersAria")} className="mt-2.5 flex flex-wrap gap-1.5">
                    {logos.map((p) => (
                      <li key={p.name} title={p.name} className="relative h-7 w-7 overflow-hidden rounded-lg ring-1 ring-white/10">
                        <Image src={imgUrl(p.logo, "w92")!} alt={p.name} fill sizes="28px" className="object-cover" />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>

            {isOriginal && reason ? (
              <p className="text-[15px] leading-relaxed text-white/80">{reason}</p>
            ) : main.overview ? (
              <p className="line-clamp-3 text-[15px] leading-relaxed text-white/70">{main.overview}</p>
            ) : null}

            {infoOpen && main.overview && isOriginal ? (
              <p className="text-sm leading-relaxed text-white/60">{main.overview}</p>
            ) : null}

            <div className="flex items-stretch gap-2">
              {service ? (
                <a
                  href={service.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    trackPickEvent("open_service", {
                      tmdbId: main.tmdbId,
                      provider: service.name,
                      fromSaved: main.fromSaved,
                    })
                  }
                  className={`flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 text-[15px] font-semibold text-black transition hover:bg-cyan-400 active:scale-[0.98] ${focusRing}`}
                >
                  {imgUrl(service.logo, "w92") ? (
                    <span className="relative h-5 w-5 shrink-0 overflow-hidden rounded">
                      <Image src={imgUrl(service.logo, "w92")!} alt="" fill sizes="20px" className="object-cover" />
                    </span>
                  ) : (
                    <PlayCircle className="h-5 w-5 shrink-0" aria-hidden />
                  )}
                  <span className="truncate">{t("openIn", { service: service.name })}</span>
                </a>
              ) : main.overview && isOriginal ? (
                <button
                  type="button"
                  onClick={() => setInfoOpen((v) => !v)}
                  aria-expanded={infoOpen}
                  className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-[15px] font-semibold text-white transition hover:bg-white/10 active:scale-[0.98] ${focusRing}`}
                >
                  <Info className="h-4 w-4" aria-hidden />
                  {infoOpen ? t("hideInfo") : t("showInfo")}
                </button>
              ) : (
                <div className="flex-1" />
              )}

              <button
                type="button"
                onClick={() => void onSave()}
                disabled={saved || saving}
                aria-label={saved ? t("saved") : t("save")}
                title={saved ? t("saved") : t("save")}
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border transition active:scale-95 disabled:active:scale-100 ${focusRing} ${
                  saved
                    ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                    : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10 disabled:opacity-60"
                }`}
              >
                {saved ? <BookmarkCheck className="h-5 w-5" aria-hidden /> : <Bookmark className="h-5 w-5" aria-hidden />}
              </button>
            </div>

            <button
              type="button"
              onClick={onAnother}
              className={`mx-auto flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-white/60 transition hover:text-white ${focusRing}`}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              {t("another")}
            </button>

            {alts.length > 0 ? (
              <div className="border-t border-white/[0.06] pt-3">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  {t("alternatives")}
                </p>
                <ul className="space-y-1">
                  {alts.map((alt) => (
                    <li key={itemKey(alt)}>
                      <button
                        type="button"
                        onClick={() => onAltSelect(alt)}
                        aria-label={t("altAria", { title: alt.title })}
                        className={`flex min-h-14 w-full items-center gap-3 rounded-xl p-1.5 text-left transition hover:bg-white/[0.05] active:scale-[0.99] ${focusRing}`}
                      >
                        <Poster src={alt.poster} title={alt.title} className="aspect-[2/3] w-10 rounded-md" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-white/90">{alt.title}</span>
                          <span className="block truncate text-xs text-white/45">{metaLine(alt, t, 1)}</span>
                        </span>
                        {alt.fromSaved ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-400/25">
                            <Heart className="h-2.5 w-2.5 fill-current" aria-hidden />
                            {t("likedMarker")}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {quotaLine}

            {nudge && !premium ? (
              <button
                type="button"
                onClick={() => onPremium("result")}
                className={`mx-auto flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-center text-xs text-white/45 transition hover:text-white/75 ${focusRing}`}
              >
                <Crown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("premiumNudge", { count: monthly })}
              </button>
            ) : null}
          </div>
        );
      })()
    : null;

  const canAd = native;
  const rewardsLeft = quota?.rewardsLeftToday ?? 1;
  const paywallView = (
    <div className="space-y-4 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-400/20">
        <Sparkles className="h-7 w-7" aria-hidden />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-white">{t("paywall.title")}</h3>
        <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-white/60">
          {premium ? t("paywall.bodyPremiumUsed", { count: monthly }) : t("paywall.bodyFree")}
        </p>
      </div>

      <div className="space-y-2.5">
        {canAd && rewardsLeft > 0 ? (
          <button
            type="button"
            onClick={() => void onWatchAd()}
            disabled={adBusy}
            className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-4 text-[15px] font-semibold text-neutral-950 transition hover:bg-cyan-300 active:scale-[0.98] disabled:opacity-60 ${focusRing}`}
          >
            <PlayCircle className="h-5 w-5" aria-hidden />
            {adBusy ? t("paywall.watchAdBusy") : t("paywall.watchAd", { count: rewardPicks })}
          </button>
        ) : null}

        {canAd && rewardsLeft <= 0 ? (
          <p className="rounded-xl bg-white/[0.05] px-3 py-2.5 text-sm text-white/60">{t("paywall.rewardLimit")}</p>
        ) : null}

        {adError && !(canAd && rewardsLeft <= 0) ? (
          <p role="alert" className="text-sm text-rose-300">
            {t("paywall.adFailed")}
          </p>
        ) : null}

        {!premium ? (
          <button
            type="button"
            onClick={() => onPremium("paywall")}
            className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold transition active:scale-[0.98] ${focusRing} ${
              canAd
                ? "border border-white/15 bg-white/5 text-white hover:bg-white/10"
                : "bg-cyan-400 text-neutral-950 hover:bg-cyan-300"
            }`}
          >
            <Crown className="h-4 w-4 shrink-0" aria-hidden />
            <span>{t("paywall.premiumCta", { count: monthly })}</span>
          </button>
        ) : (
          <p className="text-xs text-white/45">{t("paywall.resetNote")}</p>
        )}
      </div>
    </div>
  );

  const errorView = (
    <div className="space-y-4 text-center">
      {errorKind === "no_candidates" ? (
        <>
          <div>
            <h3 className="text-lg font-semibold text-white">{t("error.noCandidatesTitle")}</h3>
            <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-white/60">
              {t("error.noCandidatesBody")}
            </p>
          </div>
          <div className="space-y-2">
            {lastQuery.current && lastQuery.current.mediaFilter !== "both" ? (
              <button
                type="button"
                onClick={() => void run({ ...lastQuery.current!, mediaFilter: "both" })}
                className={`flex min-h-12 w-full items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 ${focusRing}`}
              >
                {t("error.tryBoth")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                onClose();
                router.push("/profile");
              }}
              className={`flex min-h-12 w-full items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 ${focusRing}`}
            >
              {t("error.editServices")}
            </button>
            <button
              type="button"
              onClick={() => go("ask")}
              className={`mx-auto flex min-h-11 items-center rounded-xl px-3 text-sm text-white/55 transition hover:text-white ${focusRing}`}
            >
              {t("error.back")}
            </button>
          </div>
        </>
      ) : (
        <>
          <div>
            <h3 className="text-lg font-semibold text-white">{t("error.unavailableTitle")}</h3>
            <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-white/60">
              {errorKind === "disabled" ? t("error.disabledBody") : t("error.unavailableBody")}
            </p>
          </div>
          <div className="space-y-2">
            {errorKind === "unavailable" ? (
              <button
                type="button"
                onClick={() => go("ask")}
                className={`flex min-h-12 w-full items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 ${focusRing}`}
              >
                {t("error.retry")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={requestClose}
              className={`mx-auto flex min-h-11 items-center rounded-xl px-3 text-sm text-white/55 transition hover:text-white ${focusRing}`}
            >
              {t("close")}
            </button>
          </div>
        </>
      )}
    </div>
  );

  const body =
    view === "ask"
      ? askView
      : view === "loading"
        ? loadingView
        : view === "result"
          ? resultView
          : view === "paywall"
            ? paywallView
            : errorView;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div key="pick-sheet" data-blocking-sheet className="fixed inset-0 z-[65] flex items-end justify-center">
          <motion.button
            type="button"
            tabIndex={-1}
            aria-label={t("close")}
            onClick={requestClose}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pick-sheet-title"
            tabIndex={-1}
            className="relative flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-[28px] border-t border-white/10 bg-neutral-900 shadow-[0_-18px_60px_rgba(0,0,0,0.6)] outline-none"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={SHEET_SPRING}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 600) requestClose();
            }}
          >
            {/* Draghandtag + rubrik: hela den här ytan drar arket (innehållet
                nedanför scrollar fritt och tar inte drag-gesten). */}
            <div
              className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div className="flex justify-center pb-1 pt-2.5">
                <span className="h-1 w-9 rounded-full bg-white/20" />
              </div>
              <div className="flex items-center gap-2 px-5 pb-2">
                <Sparkles className="h-5 w-5 text-cyan-300" aria-hidden />
                <h2 id="pick-sheet-title" className="flex-1 text-[17px] font-semibold text-white">
                  {t("title")}
                </h2>
                <button
                  type="button"
                  onClick={requestClose}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label={t("close")}
                  className={`-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white ${focusRing}`}
                >
                  <X className="h-5 w-5" aria-hidden />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-1">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={view === "result" && main ? `result-${itemKey(main)}` : view}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={VIEW_FADE}
                >
                  {body}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
