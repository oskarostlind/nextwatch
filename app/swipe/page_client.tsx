"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { ChevronUp, Eye, Heart, Send, Settings, X } from "lucide-react";
import { motion, useAnimation, useMotionValue, useTransform, type MotionValue } from "framer-motion";
import ActionDock from "@/app/components/ui/ActionDock";
import { Button } from "@/app/components/ui/kit";
import { useSoloSwipeDeck } from "@/app/recs/SwipeDeckProvider";
import type { SwipeCard, SwipeProviders, Trailer } from "@/lib/swipeDeck";
import { hideFor7Days, markSeen, unhide, unmarkSeen } from "@/lib/swipeDeck";
import { adsenseClientId, adsenseSlotId } from "@/lib/ads";
import { goPremium } from "@/lib/premiumPurchase";
import { reportSwipeLimitFrom } from "@/lib/swipeLimitEvent";
import DeckPosterPreload from "@/app/components/client/DeckPosterPreload";
import type { ShareItem } from "@/app/components/client/ShareTitleModal";
import { initAdMobIfEligible, registerSwipeForAds } from "@/lib/admobAds";
import { emitGroupVoted } from "@/lib/groupVoteEvent";
import { notify } from "@/app/components/lib/notify";
import {
  bestWatchUrl,
  isPaidOnly,
  providerGroupsFor,
  providerWatchUrl,
  PAID_ONLY_LABEL,
  type WatchProviders,
} from "@/lib/watchLinks";
import { useSwipeSettings } from "@/app/components/client/SwipeSettingsProvider";
import { saveSwipeSettings } from "@/lib/swipeSettingsStore";
import type { SwipeMediaFilter } from "@/lib/swipeMediaFilter";
import WatchNowButton from "@/app/components/watch/WatchNowButton";
import TrailerButton from "@/app/components/watch/TrailerButton";
import type { GroupMatchItem as MatchOverlayItem } from "@/app/components/ui/MatchOverlay";
import { maybeTriggerAdUpsell } from "@/lib/adUpsellEvent";
import { CardSkeleton } from "@/app/components/ui/Skeletons";
import { SWIPE_GUIDE_STEPS } from "@/lib/guideSteps";
import { hasSeenGuide, releaseGuide, tryAcquireGuide } from "@/lib/userGuide";

/* ---------- overlays som bara syns efter en interaktion ----------
   Allt här nedanför renderas bakom ett boolean-state och är osynligt vid
   första målningen. Med dynamic(..., { ssr: false }) laddas koden först när
   overlayn öppnas — den här filen är ~43 kB källkod och parsningen av den
   dominerar swipe-flikens första mount i WKWebView. */
const MatchOverlay = dynamic(() => import("@/app/components/ui/MatchOverlay"), { ssr: false });
const PremiumUpsellModal = dynamic(() => import("@/app/components/client/PremiumUpsellModal"), {
  ssr: false,
});
const RatingModal = dynamic(() => import("@/app/components/client/RatingModal"), { ssr: false });
const GuideOverlay = dynamic(() => import("@/app/components/client/GuideOverlay"), { ssr: false });
const ShareTitleModal = dynamic(() => import("@/app/components/client/ShareTitleModal"), {
  ssr: false,
});
const SwipeLimitWall = dynamic(() => import("@/app/components/client/SwipeLimitWall"), {
  ssr: false,
});

/* ---------- types ---------- */

type MediaType = "movie" | "tv";

export type Card = SwipeCard;

type MatchResp =
  | {
      ok: true;
      size: number; // antal medlemmar i aktiv grupp
      need: number; // tröskel för match
      count: number; // hur många som har röstat LIKE på aktuell titel (om frågan gällde en specifik)
      match: { tmdbId: number; tmdbType: MediaType } | null; // senaste färska matchen om någon
      matches: { tmdbId: number; tmdbType: MediaType }[];
    }
  | { ok: false; message?: string };

type SwipeAction = "like" | "dislike" | "seen";

type UndoEntry = {
  card: Card;
  action: SwipeAction;
  groupCode?: string;
};

const UNDO_MAX = 5;

function pushUndo(stack: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  return [entry, ...stack].slice(0, UNDO_MAX);
}

function saveRating(c: Card, decision: "like" | "dislike" | "seen") {
  void fetch("/api/rate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      tmdbId: c.tmdbId,
      mediaType: c.mediaType,
      decision,
    }),
  })
    .then((res) => {
      // 429 = daglig swipegräns nådd — visa väggen (SwipeLimitWall lyssnar).
      reportSwipeLimitFrom(res);
    })
    .catch(() => {
      /* best-effort */
    });
}

/* ---------- Details helpers (fallback sv → en) ---------- */

type DetailsDTO = {
  id: number;
  type?: MediaType;
  title?: string;
  overview?: string | null;
  poster?: string | null;
  posterUrl?: string | null;
  poster_path?: string | null;
  posterPath?: string | null;
  year?: number | string | null;
  releaseYear?: number | null;
  vote_average?: number | null;
  voteAverage?: number | null;
  rating?: number | null;
  name?: string;
  genres?: string[];
  backdropUrl?: string | null;
  backdropPath?: string | null;
  trailer?: Trailer | null;
};
function parseDetails(d: unknown) {
  if (typeof d !== "object" || !d) return null;
  const o = d as DetailsDTO;
  const title =
    (typeof o.title === "string" && o.title) ||
    (typeof o.name === "string" && o.name) ||
    "Untitled";
  const overview =
    typeof o.overview === "string" && o.overview.trim().length > 0
      ? o.overview
      : null;
  const rating =
    typeof o.rating === "number"
      ? o.rating
      : typeof o.voteAverage === "number"
      ? o.voteAverage
      : typeof o.vote_average === "number"
      ? o.vote_average
      : null;
  const posterPath =
    typeof o.posterUrl === "string"
      ? o.posterUrl
      : typeof o.poster === "string"
      ? o.poster
      : typeof o.posterPath === "string"
      ? o.posterPath
      : typeof o.poster_path === "string"
      ? o.poster_path
      : null;
  const poster = posterPath
    ? posterPath.startsWith("http")
      ? posterPath
      : `https://image.tmdb.org/t/p/w780${posterPath}`
    : null;
  const y =
    typeof o.year === "string"
      ? o.year
      : typeof o.year === "number"
      ? String(o.year)
      : typeof o.releaseYear === "number"
      ? String(o.releaseYear)
      : null;
  const genres = Array.isArray(o.genres)
    ? o.genres.filter((g): g is string => typeof g === "string" && g.length > 0)
    : [];
  const backdropRaw =
    typeof o.backdropUrl === "string"
      ? o.backdropUrl
      : typeof o.backdropPath === "string"
      ? o.backdropPath.startsWith("http")
        ? o.backdropPath
        : `https://image.tmdb.org/t/p/w780${o.backdropPath}`
      : null;
  const backdrop = backdropRaw && backdropRaw.length > 0 ? backdropRaw : null;
  return { overview, rating, poster, title, year: y, genres, backdrop, trailer: o.trailer ?? null };
}
/* ---------- Streamingproviders för kortets baksida ---------- */

type ProvidersResp = {
  ok: boolean;
  providers: WatchProviders | null;
};

/** Hämtar providers för titeln. Länken byggs vid rendering, se lib/watchLinks.ts. */
export async function fetchWatchProviders(
  type: MediaType,
  id: number
): Promise<SwipeProviders | null> {
  try {
    const res = await fetch(`/api/tmdb/watch-providers?id=${id}&type=${type}`, {
      cache: "force-cache",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as ProvidersResp;
    if (!j.ok || !j.providers) return null;
    return {
      link: j.providers.link,
      flatrate: j.providers.flatrate,
      rent: j.providers.rent,
      buy: j.providers.buy,
    };
  } catch {
    return null;
  }
}

export async function fetchDetailsWithFallback(type: MediaType, id: number) {
  // Båda språken skjuts iväg direkt. Tidigare inväntades sv-SE innan en-US ens
  // startade — två seriella turer på mobilnät för varje titel som saknar svensk
  // beskrivning. Nu ligger reservsvaret redan i luften när vi behöver det, och
  // med Cache-Control på /api/tmdb/details kostar den extra förfrågan i princip
  // ingenting vid återbesök.
  const p1 = fetch(`/api/tmdb/details?type=${type}&id=${id}`, {
    cache: "force-cache",
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const p2 = fetch(`/api/tmdb/details?type=${type}&id=${id}&language=en-US`, {
    cache: "force-cache",
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  const d1 = await p1;
  let parsed = parseDetails(d1);
  if (parsed && parsed.overview) return parsed;

  const d2 = await p2;
  parsed = parseDetails(d2) ?? parsed;
  return parsed;
}

/* ---------- component ---------- */

/**
 * Swipekort → matchrutans format. Bara streamingtjänster tas med (och bara de vi
 * kan direktlänka till) — matchrutan ska inte bli ännu en yta som skickar folk
 * till en hyrsida, se lib/watchLinks.ts.
 */
function toMatchItem(card: Card, showPaidOptions: boolean): MatchOverlayItem {
  const groups = providerGroupsFor(card.providers, showPaidOptions);
  const providers: { name: string; url: string }[] = [];
  for (const g of groups) {
    for (const p of g.list) {
      const url = providerWatchUrl(p.provider_name, card.title);
      if (url && !providers.some((x) => x.name === p.provider_name)) {
        providers.push({ name: p.provider_name, url });
      }
    }
  }

  const yearNum = card.year ? Number(card.year) : NaN;

  return {
    tmdbId: card.tmdbId,
    tmdbType: card.mediaType,
    title: card.title,
    ...(Number.isFinite(yearNum) ? { year: yearNum } : {}),
    ...(card.poster ? { poster: card.poster } : {}),
    ...(typeof card.rating === "number" ? { rating: card.rating } : {}),
    ...(card.overview ? { overview: card.overview } : {}),
    providers,
    trailer: card.trailer ?? null,
  };
}

/**
 * Minimal film/serie-väljare, centrerad i toppraden. Skriver till samma
 * profilinställning som förut (saveSwipeSettings → /api/profile/swipe-settings),
 * så valet överlever mellan sessioner och kortleken hämtas om av storen.
 */
function MediaFilterPill({
  value,
  onChange,
}: {
  value: SwipeMediaFilter;
  onChange: (next: SwipeMediaFilter) => void;
}) {
  const options: { id: SwipeMediaFilter; label: string }[] = [
    { id: "both", label: "Båda" },
    { id: "movie", label: "Film" },
    { id: "tv", label: "Serier" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Visa i swipen"
      className="absolute left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.06] p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => value !== o.id && onChange(o.id)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
            value === o.id ? "bg-white/15 text-white" : "text-white/45 hover:text-white/75"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Skydd mot refresh-loop om servern av någon anledning fortsätter rendera solo-vyn.
let groupRefreshAttempted = false;

export default function SwipePageClient() {
  const router = useRouter();
  const { showPaidOptions, mediaFilter } = useSwipeSettings();
  const [shareItem, setShareItem] = useState<ShareItem | null>(null);
  const shareCard = useCallback((c: Card) => {
    setShareItem({
      tmdbId: c.tmdbId,
      mediaType: c.mediaType,
      title: c.title,
      year: c.year,
      poster: c.poster,
    });
  }, []);
  const { solo, popSoloCard, updateSoloCards, retrySoloDeck, unshiftSoloCard } =
    useSoloSwipeDeck();
  const { cards, mode, group, loading, error, ready } = solo;
  const feedLoading = cards.length === 0 && (loading || !ready);
  const feedError = cards.length === 0 ? error : null;

  const undoStackRef = useRef<UndoEntry[]>([]);

  const [flippedId, setFlippedId] = useState<string | null>(null);

  // Betygs-popup efter swipe upp ("Sett"). Kortet är redan sparat som "seen"
  // — popupen är valfri och lägger bara till ett 1–10-betyg ovanpå.
  const [ratePrompt, setRatePrompt] = useState<Card | null>(null);
  const [ratingSaving, setRatingSaving] = useState(false);
  const [swipeGuideOpen, setSwipeGuideOpen] = useState(false);

  // Kortet som utlöste en toppmatch. Behålls efter popTop() så rutan kan visa
  // titeln även när den lämnat kortleken.
  const [soloMatch, setSoloMatch] = useState<Card | null>(null);

  const controls = useAnimation();

  // Tinder-stil: kortet följer fingret, overlays togglas av drag-riktningen.
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-260, 260], [-16, 16]);
  const likeOpacity = useTransform(x, [48, 150], [0, 1]);
  const nopeOpacity = useTransform(x, [-150, -48], [1, 0]);
  const seenOpacity = useTransform(y, [-120, -36], [1, 0]);
  const seenScale = useTransform(y, [-120, -36], [0.88, 1.06]);
  const seenRotate = useTransform(y, [-120, -36], [-6, 0]);

  // lazy hydrering av details på topp- och nästa korten i stacken (parallellt)
  const fetched = useRef<Set<string>>(new Set());
  useEffect(() => {
    const cur = cards[0];
    const nxt = cards[1];
    const third = cards[2];
    const toFetch: { id: string; mediaType: MediaType; tmdbId: number }[] = [];
    // Annonskort (kind === "ad") har ingen riktig tmdbId – hoppa över hämtning.
    if (cur && cur.kind !== "ad" && !fetched.current.has(cur.id)) toFetch.push({ id: cur.id, mediaType: cur.mediaType, tmdbId: cur.tmdbId });
    if (nxt && nxt.kind !== "ad" && !fetched.current.has(nxt.id)) toFetch.push({ id: nxt.id, mediaType: nxt.mediaType, tmdbId: nxt.tmdbId });
    if (third && third.kind !== "ad" && !fetched.current.has(third.id))
      toFetch.push({ id: third.id, mediaType: third.mediaType, tmdbId: third.tmdbId });
    if (toFetch.length === 0) return;

    toFetch.forEach((t) => fetched.current.add(t.id));
    Promise.all(
      toFetch.map((t) => fetchDetailsWithFallback(t.mediaType, t.tmdbId).then((det) => ({ id: t.id, det })))
    ).then((results) => {
      results.forEach(({ id, det }) => {
        if (!det) return;
        updateSoloCards((prev) =>
          prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  overview: c.overview ?? det.overview,
                  rating: typeof c.rating === "number" ? c.rating : det.rating ?? null,
                  poster: c.poster ?? det.poster,
                  title: c.title || det.title,
                  year: c.year ?? det.year,
                  genres: c.genres?.length ? c.genres : det.genres,
                  backdrop: c.backdrop ?? det.backdrop,
                  trailer: c.trailer ?? det.trailer,
                }
              : c
          )
        );
      });
    });
    // Providers hämtas parallellt med details (separat endpoint).
    toFetch.forEach((t) => {
      void fetchWatchProviders(t.mediaType, t.tmdbId).then((providers) => {
        updateSoloCards((prev) =>
          prev.map((c) =>
            c.id === t.id && c.providers === undefined ? { ...c, providers } : c
          )
        );
      });
    });
  }, [cards, updateSoloCards]);

  useEffect(() => {
    if (feedLoading || ratePrompt) return;
    const top = cards[0];
    if (!top || top.kind === "ad") return;
    if (hasSeenGuide("swipe")) return;
    const t = window.setTimeout(() => {
      // Omkolla: den nya forcerade swipe-genomgången (SwipeGestureTour, mountad
      // i app/swipe/page.tsx) kan ha markerat den här som sedd medan vi väntade.
      if (hasSeenGuide("swipe")) return;
      if (tryAcquireGuide("swipe")) setSwipeGuideOpen(true);
    }, 700);
    return () => window.clearTimeout(t);
  }, [feedLoading, cards, ratePrompt]);

  // Släpp låset om sidan lämnas medan guiden är öppen (egen unmount-effekt, inte
  // kopplad till öppna-villkorets täta deps).
  useEffect(() => () => releaseGuide("swipe"), []);

  // AdMob måste initieras innan registerSwipeForAds() gör något — utan det här
  // anropet returnerade den direkt (initialized=false) och iOS-appen visade
  // aldrig en enda annons, trots att hela AdMob-lagret fanns färdigt.
  // Idempotent och no-op på webben; init (UMP-samtycke + ATT-prompt) sker här
  // på swipe-sidan i stället för vid appstart så första prompten kommer i ett
  // sammanhang användaren förstår.
  useEffect(() => {
    void initAdMobIfEligible();
  }, []);

  useEffect(() => {
    if (mode === "group" && group?.code && !groupRefreshAttempted) {
      groupRefreshAttempted = true;
      router.refresh();
    }
  }, [mode, group?.code, router]);

  // Upsell-popup: räkna annonsvisningar (när ett annonskort blir överst) och
  // trigga popupen var 3:e annons — en gång per session (se PremiumUpsellModal).
  const countedAds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const top = cards[0];
    if (!top || top.kind !== "ad" || countedAds.current.has(top.id)) return;
    countedAds.current.add(top.id);
    maybeTriggerAdUpsell();
  }, [cards]);

  function popTop() {
    setFlippedId(null);
    popSoloCard();
  }

  /* ---------- group helpers (fire-and-forget; blockerar inte UI) ---------- */

  function sendGroupVoteBackground(c: Card, vote: "LIKE" | "DISLIKE") {
    if (mode !== "group" || !group?.code) return;
    const code = group.code;
    void fetch("/api/group/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        groupCode: code,
        tmdbId: c.tmdbId,
        tmdbType: c.mediaType,
        vote,
      }),
    })
      .then((res) => {
        if (!res.ok) return null;
        emitGroupVoted(); // OverlayMount snabb-pollar matchen (ersatte fetch-patchen)
        return fetch(`/api/group/match?code=${encodeURIComponent(code)}`, { cache: "no-store" });
      })
      .then((matchRes) => {
        if (!matchRes || !matchRes.ok) return null;
        return matchRes.json() as Promise<unknown>;
      })
      .then((m: unknown) => {
        const parsed = m as MatchResp | null;
        if (parsed && "ok" in parsed && parsed.ok && parsed.match) {
          window.dispatchEvent(
            new CustomEvent("nw:group-match", {
              detail: {
                code,
                tmdbId: parsed.match.tmdbId,
                tmdbType: parsed.match.tmdbType,
              },
            })
          );
        }
      })
      .catch(() => {
        /* best-effort */
      });
  }

  /* ---------- actions (optimistic: popTop direkt; API i bakgrunden) ---------- */

  function recordUndo(c: Card, action: SwipeAction) {
    if (c.kind === "ad") return;
    const groupCode = mode === "group" && group?.code ? group.code : undefined;
    undoStackRef.current = pushUndo(undoStackRef.current, { card: c, action, groupCode });
  }

  function handleDislike(c: Card): void {
    if (c.kind === "ad") { popTop(); return; }
    recordUndo(c, "dislike");
    markSeen(c.id);
    hideFor7Days(c.tmdbId);
    saveRating(c, "dislike");
    popTop();
    sendGroupVoteBackground(c, "DISLIKE");
  }

  function handleLike(c: Card): void {
    if (c.kind === "ad") { popTop(); return; }
    recordUndo(c, "like");
    markSeen(c.id);
    saveRating(c, "like");
    popTop();
    void fetch("/api/watchlist/like", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        tmdbId: c.tmdbId,
        mediaType: c.mediaType,
        title: c.title,
        year: c.year,
        poster: c.poster,
      }),
    }).catch(() => {
      /* best-effort */
    });
    sendGroupVoteBackground(c, "LIKE");

    // Toppmatch firas bara i solo — i grupp äger gruppmatchen den rutan.
    if (c.topMatch && mode !== "group") setSoloMatch(c);
  }

  function handleSeen(c: Card): void {
    if (c.kind === "ad") { popTop(); return; }
    recordUndo(c, "seen");
    markSeen(c.id);
    hideFor7Days(c.tmdbId);
    saveRating(c, "seen");
    popTop();
    sendGroupVoteBackground(c, "DISLIKE");
    setRatePrompt(c);
  }

  function submitSeenRating(rating: number): void {
    const c = ratePrompt;
    if (!c) return;
    setRatingSaving(true);
    void fetch("/api/ratings/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ tmdbId: c.tmdbId, mediaType: c.mediaType, rating }),
    })
      .then((res) => {
        if (!res.ok) notify("Kunde inte spara betyget");
      })
      .catch(() => {
        notify("Kunde inte spara betyget");
      })
      .finally(() => {
        setRatingSaving(false);
        setRatePrompt(null);
      });
  }

  function handleUndo(): void {
    const entry = undoStackRef.current[0];
    if (!entry) {
      notify("Inget att ångra");
      return;
    }
    undoStackRef.current = undoStackRef.current.slice(1);
    setRatePrompt(null);
    unmarkSeen(entry.card.id);
    if (entry.action === "dislike" || entry.action === "seen") {
      unhide(entry.card.tmdbId);
    }
    unshiftSoloCard(entry.card);
    void fetch("/api/swipe/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        tmdbId: entry.card.tmdbId,
        mediaType: entry.card.mediaType,
        action: entry.action,
        groupCode: entry.groupCode,
      }),
    }).catch(() => {
      notify("Kunde inte ångra på servern");
    });
  }

  /* ---------- render ---------- */

  // Höjd från 110 eftersom dragElastic numera är 1:1 i de tre riktningarna —
  // kortet följer fingret hela vägen, så samma fysiska rörelse ger längre
  // offset än förut. 130 håller släppkänslan kalibrerad.
  const DIST_THRESHOLD = 130;
  const VELOCITY_THRESHOLD = 700;

  /**
   * Kastar ut toppkortet. `releaseVelocity` är fingrets hastighet vid släpp —
   * fjädern ärver den, så en snabb flick lämnar skärmen fortare än ett
   * knapptryck. Kortet känns kastat i stället för uppspelat.
   */
  async function swipeOut(dir: "left" | "right" | "up", releaseVelocity = 0) {
    const c = cards[0];
    if (!c) return;
    const target =
      dir === "right"
        ? { x: 560, opacity: 0 }
        : dir === "left"
        ? { x: -560, opacity: 0 }
        : { y: -760, opacity: 0 };
    await controls.start({
      ...target,
      transition: {
        x: {
          type: "spring",
          stiffness: 200,
          damping: 26,
          velocity: releaseVelocity,
          restDelta: 1,
          restSpeed: 10,
        },
        y: {
          type: "spring",
          stiffness: 200,
          damping: 26,
          velocity: releaseVelocity,
          restDelta: 1,
          restSpeed: 10,
        },
        opacity: { duration: 0.18, ease: "easeOut" },
      },
    });
    if (dir === "right") handleLike(c);
    else if (dir === "left") handleDislike(c);
    else handleSeen(c);
    // AdMob-interstitial var 15:e swipe (endast native iOS + gratis, no-op annars).
    registerSwipeForAds();
    // Återställ direkt (utan animation) så nästa kort inte glider in från sidan.
    x.set(0);
    y.set(0);
    controls.set({ x: 0, y: 0, opacity: 1 });
  }

  const stackIndices: number[] = [];
  if (cards.length > 0) {
    for (let i = Math.min(2, cards.length - 1); i >= 0; i--) stackIndices.push(i);
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <SwipeLimitWall />
      <PremiumUpsellModal />
      {/* Stacken renderar kort 0–2; värm posters för 3..7 så nästa kort aldrig
          poppar in halvladdat. Samma sizes som Fronts <Image> — annars värms
          fel bildvariant. */}
      <DeckPosterPreload
        posters={cards.slice(3, 8).map((c) => c.poster)}
        sizes="(max-width: 768px) 100vw, 600px"
      />

      {/* Toppraden: film/serie-filtret bor här (flyttat från profilen — valet
          hör hemma där man ser effekten), resten av det som styr förslagen
          (tjänster, genrer) nås via kugghjulet. I gruppläge styr gruppens egna
          inställningar, så pillen visas bara solo. */}
      <div className="relative flex shrink-0 items-center justify-end px-3 pt-2">
        {mode === "individual" && (
          <MediaFilterPill
            value={mediaFilter}
            onChange={(next) => void saveSwipeSettings({ mediaFilter: next })}
          />
        )}
        <button
          type="button"
          onClick={() => router.push("/profile")}
          aria-label="Inställningar för förslag"
          className="rounded-full p-2 text-white/50 transition hover:bg-white/5 hover:text-white/80"
        >
          <Settings className="h-5 w-5" />
        </button>
      </div>

      <MatchOverlay
        open={soloMatch !== null}
        variant="solo"
        item={soloMatch ? toMatchItem(soloMatch, showPaidOptions) : null}
        evidence={soloMatch?.topMatch?.evidence}
        onClose={() => setSoloMatch(null)}
      />

      <RatingModal
        open={ratePrompt !== null}
        item={
          ratePrompt
            ? {
                tmdbId: ratePrompt.tmdbId,
                mediaType: ratePrompt.mediaType,
                title: ratePrompt.title,
                year: ratePrompt.year,
                poster: ratePrompt.poster,
              }
            : null
        }
        heading="Vad tyckte du?"
        saving={ratingSaving}
        onRate={submitSeenRating}
        onSkip={() => setRatePrompt(null)}
      />
      {mode === "group" && group?.code && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2 rounded-full border border-emerald-500/40 bg-emerald-600/15 px-3 py-1 text-xs font-medium text-emerald-200 backdrop-blur">
          Grupp: <span className="font-mono tracking-wider">{group.code}</span>
        </div>
      )}

      {/* Kort-yta: flex-1 + min-h-0 + overflow-hidden => flexbox styr höjden och kortet kan aldrig växa förbi ytan och klippas bakom ikon-raden.
          OBS: kort-wrappern är absolut positionerad (inte h-full) eftersom procenthöjder
          kollapsar till 0 när förfäderna bara har min-h + flex-1 (indefinit höjd). */}
      <div className="relative min-h-0 flex-1 overflow-hidden pb-1">
      {feedLoading ? (
        <div className="absolute inset-0 flex items-center justify-center">
          {/* Samma geometri som kortet (2/3, max 420 px, rounded-2xl) — övergången
              skelett → poster blir en ren korsning utan hopp i layouten. */}
          <CardSkeleton />
        </div>
      ) : feedError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-rose-300">{feedError}</p>
          <Button variant="secondary" onClick={() => void retrySoloDeck()}>
            Försök igen
          </Button>
        </div>
      ) : cards[0] ? (
          <div
            className="absolute inset-x-1 inset-y-2 isolate mx-auto max-w-[min(100%,420px)] overflow-hidden"
          >
          {stackIndices.map((idx) => {
            const card = cards[idx];
            if (!card) return null;
            const isTop = idx === 0;
            if (isTop) {
              return (
                <motion.div
                  key={card.id}
                  data-guide="swipe-card"
                  className="absolute inset-0 z-10 flex touch-none items-center justify-center p-0.5"
                  style={{ x, y, rotate }}
                  animate={controls}
                  drag
                  dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
                  // 1:1-följning i de tre riktningar som har en handling. Med 0.8
                  // tolkade nollstora dragConstraints all rörelse som översläng och
                  // kortet följde bara 80 % av fingret. Nedåt finns ingen handling —
                  // där får det studsa som gummiband.
                  dragElastic={{ left: 1, right: 1, top: 1, bottom: 0.4 }}
                  onDragEnd={(_, info) => {
                    const { offset, velocity } = info;
                    const up =
                      (offset.y < -DIST_THRESHOLD || velocity.y < -VELOCITY_THRESHOLD) &&
                      Math.abs(offset.y) > Math.abs(offset.x);
                    if (up) {
                      void swipeOut("up", velocity.y);
                      return;
                    }
                    if (offset.x > DIST_THRESHOLD || velocity.x > VELOCITY_THRESHOLD) {
                      void swipeOut("right", velocity.x);
                      return;
                    }
                    if (offset.x < -DIST_THRESHOLD || velocity.x < -VELOCITY_THRESHOLD) {
                      void swipeOut("left", velocity.x);
                      return;
                    }
                    void controls.start({
                      x: 0,
                      y: 0,
                      transition: { type: "spring", stiffness: 320, damping: 28 },
                    });
                  }}
                >
                  {/* Nya toppkortet växer från exakt den skala/position det hade
                      som kort #2 i stacken, i stället för att snäppa till full
                      storlek på en bildruta. Bara transform — ingen layoutkostnad. */}
                  <motion.div
                    className="h-full max-h-full w-full min-h-0"
                    initial={{ scale: 0.95, y: 10 }}
                    animate={{ scale: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  >
                    <StaticCard
                      card={card}
                      flipped={flippedId === card.id}
                      interactive
                      onFlip={() => setFlippedId((p) => (p === card.id ? null : card.id))}
                      onShare={shareCard}
                    />
                  </motion.div>

                  <SwipeStampOverlays
                    likeOpacity={likeOpacity}
                    nopeOpacity={nopeOpacity}
                    seenOpacity={seenOpacity}
                    seenScale={seenScale}
                    seenRotate={seenRotate}
                  />
                </motion.div>
              );
            }
            const depth = idx;
            const scale = depth === 1 ? 0.95 : 0.9;
            const translateY = depth === 1 ? 10 : 20;
            const z = depth === 1 ? 9 : 8;
            return (
              <div
                key={card.id}
                // transition-transform: när toppkortet försvinner flyttas #3 upp
                // till #2:s plats — utan detta hoppar den ett steg på en bildruta.
                className="pointer-events-none absolute inset-0 flex items-center justify-center p-0.5 opacity-[0.92] transition-transform duration-200 ease-out"
                style={{
                  zIndex: z,
                  transform: `translateY(${translateY}px) scale(${scale})`,
                  filter: "brightness(0.88)",
                }}
              >
                <StaticCard card={card} flipped={false} interactive={false} onFlip={() => {}} />
              </div>
            );
          })}
          </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center opacity-70">
          Slut på förslag nu.
        </div>
      )}
      </div>

      <div data-guide="action-dock">
        <ActionDock
          disabled={!cards[0] || feedLoading}
          // Knapptryck har ingen fingerhastighet — ge fjädern en syntetisk knuff
          // så knappen känns som ett bestämt kast i stället för en avspelning.
          onNope={() => void swipeOut("left", -900)}
          onInfo={() => {
            const c = cards[0];
            if (c) setFlippedId((p) => (p === c.id ? null : c.id));
          }}
          onUndo={handleUndo}
          onLike={() => void swipeOut("right", 900)}
        />
      </div>

      <ShareTitleModal open={shareItem !== null} item={shareItem} onClose={() => setShareItem(null)} />

      <GuideOverlay
        guideId="swipe"
        steps={SWIPE_GUIDE_STEPS}
        open={swipeGuideOpen}
        onClose={() => {
          setSwipeGuideOpen(false);
          releaseGuide("swipe");
        }}
      />
    </div>
  );
}

/* ---------- Tinder-stil swipe-stämplar ---------- */

export function SwipeStampOverlays({
  likeOpacity,
  nopeOpacity,
  seenOpacity,
  seenScale,
  seenRotate,
}: {
  likeOpacity: MotionValue<number>;
  nopeOpacity: MotionValue<number>;
  seenOpacity: MotionValue<number>;
  seenScale: MotionValue<number>;
  seenRotate: MotionValue<number>;
}) {
  return (
    <>
      <motion.div
        style={{ opacity: likeOpacity }}
        className="pointer-events-none absolute left-5 top-8 z-20 flex -rotate-12 items-center gap-2 rounded-lg border-4 border-emerald-400 px-3 py-1.5 text-2xl font-black uppercase tracking-widest text-emerald-400"
      >
        <Heart className="h-7 w-7 fill-current" strokeWidth={2.5} />
        Gilla
      </motion.div>
      <motion.div
        style={{ opacity: nopeOpacity }}
        className="pointer-events-none absolute right-5 top-8 z-20 flex rotate-12 items-center gap-2 rounded-lg border-4 border-rose-400 px-3 py-1.5 text-2xl font-black uppercase tracking-widest text-rose-400"
      >
        <X className="h-7 w-7" strokeWidth={3} />
        Nope
      </motion.div>
      <motion.div
        style={{ opacity: seenOpacity, scale: seenScale, rotate: seenRotate }}
        className="pointer-events-none absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
      >
        {/* Ingen egen opacity här — föräldern driver redan seenOpacity. Med en
            extra wrapper blev det opacity² och riktningspilen var nästan osynlig
            tills gesten redan var färdig. */}
        <ChevronUp className="h-8 w-8 text-sky-400" strokeWidth={3} />
        <div className="flex items-center gap-2 rounded-lg border-4 border-sky-400 px-4 py-2 text-xl font-black uppercase tracking-widest text-sky-400">
          <Eye className="h-7 w-7" strokeWidth={2.5} />
          Sett
        </div>
      </motion.div>
    </>
  );
}

/* ---------- Card components (oförändrat utseende) ---------- */

export function StaticCard({
  card,
  flipped,
  onFlip,
  interactive = true,
  onShare,
}: {
  card: Card;
  flipped: boolean;
  interactive?: boolean;
  onFlip: () => void;
  /** Öppnar "Tipsa en vän" för kortet. Bara meningsfullt på toppkortet. */
  onShare?: (card: Card) => void;
}) {
  // Annonskort: ingen flip, ingen poster – renderar AdCard (AdSense/AdMob).
  if (card.kind === "ad") {
    return (
      <div className="relative h-full max-h-full w-full min-h-0">
        <AdCard adId={card.id} />
      </div>
    );
  }
  return (
    <div
      className={`relative h-full max-h-full w-full min-h-0 [perspective:1000px] ${interactive ? "cursor-pointer" : "cursor-default"}`}
      onClick={interactive ? onFlip : undefined}
    >
      <div
        // Egen easing + will-change: rotateY:n ska ligga kvar på kompositören hela
        // 3D-rotationen (se WKWebView-kommentaren om preserve-3d längre ned).
        className="relative h-full max-h-full w-full min-h-0 rounded-2xl border border-white/15 bg-black shadow-xl transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] will-change-transform [transform-style:preserve-3d]"
        style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
      >
        <div className="absolute inset-0 [backface-visibility:hidden]">
          <Front card={card} flipped={flipped} />
        </div>
        <div className="absolute inset-0 rotate-y-180 [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <Back card={card} onShare={onShare} />
        </div>
      </div>
    </div>
  );
}

/* ---------- Annonskort (AdSense på webb, AdMob på iOS i Fas 2) ---------- */

function AdCard({ adId }: { adId: string }) {
  const client = adsenseClientId();
  const slot = adsenseSlotId();

  useEffect(() => {
    if (!client || !slot) return;
    try {
      const w = window as unknown as { adsbygoogle?: unknown[] };
      w.adsbygoogle = w.adsbygoogle || [];
      w.adsbygoogle.push({});
    } catch {
      /* AdSense-scriptet kanske inte laddat än – no-op */
    }
  }, [client, slot, adId]);

  return (
    <div className="relative flex h-full w-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/15 bg-neutral-950">
      <div className="absolute left-3 top-3 z-10 rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white/60">
        Annons
      </div>
      {client && slot ? (
        <ins
          className="adsbygoogle"
          style={{ display: "block", width: "100%", height: "100%" }}
          data-ad-client={client}
          data-ad-slot={slot}
          data-ad-format="fluid"
          data-full-width-responsive="true"
        />
      ) : (
        // Platshållaren är en premium-CTA: tap -> köpflöde (iOS) / /premium (webb).
        <div
          role="button"
          tabIndex={0}
          onClick={() => void goPremium()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") void goPremium();
          }}
          className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-3 p-6 text-center"
        >
          <div className="text-2xl">🎬</div>
          <div className="text-sm text-white/70">Reklamplats</div>
          <p className="max-w-[16rem] text-xs leading-relaxed text-white/40">
            Swipa vidare som vanligt — eller slipp annonserna helt.
          </p>
          <span className="mt-1 rounded-full bg-amber-400/15 px-4 py-1.5 text-xs font-semibold text-amber-300 ring-1 ring-amber-400/40">
            Uppgradera till Premium
          </span>
        </div>
      )}
    </div>
  );
}

function Front({ card, flipped }: { card: Card; flipped: boolean }) {
  return (
    <div className="relative h-full w-full min-h-0 overflow-hidden rounded-2xl">
      {card.poster ? (
        <div className="relative h-full w-full min-h-0">
          <Image
            src={card.poster}
            alt={card.title}
            fill
            sizes="(max-width: 768px) 100vw, 600px"
            className="object-cover object-center"
            priority={false}
            draggable={false}
          />
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-neutral-800">{card.title}</div>
      )}

      {/* [backface-visibility:hidden] på förälderdiven ska räcka för att dölja
          den här remsan när kortet är vänt — men backdrop-blur skapar ett eget
          kompositeringslager som WebKit (iOS-appens WKWebView) ibland fortsätter
          rita trots det, spegelvänt. Döljs explicit i stället för att lita på
          backface-visibility för det här elementet. */}
      {!flipped && card.reasons && card.reasons.length > 0 ? (
        <div className="pointer-events-none absolute left-3 right-3 top-3 z-10">
          <div className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-cyan-400/30 bg-black/55 px-2 py-1 backdrop-blur-sm">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-cyan-300/90">
              Matchar
            </span>
            {card.reasons.slice(0, 3).map((r) => (
              <span
                key={r}
                className="rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-[10px] text-cyan-100"
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4">
        <div className="h-28 bg-gradient-to-t from-black/90 to-transparent" />
        <div className="-mt-24 px-1">
          <div className="text-lg font-semibold text-white drop-shadow">
            {card.title}
            {card.year ? <span className="ml-2 opacity-80">({card.year})</span> : null}
          </div>
        </div>
      </div>

      {typeof card.rating === "number" ? (
        <div className="absolute bottom-2 right-2 rounded-md bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-400/40 backdrop-blur">
          ★ {card.rating.toFixed(1)}
        </div>
      ) : null}
    </div>
  );
}

function Back({ card, onShare }: { card: Card; onShare?: (card: Card) => void }) {
  const heroSrc = card.backdrop ?? card.poster;
  const { showPaidOptions } = useSwipeSettings();
  const providerGroups = providerGroupsFor(card.providers, showPaidOptions);
  const paidOnly = isPaidOnly(card.providers, showPaidOptions);
  const watchUrl = bestWatchUrl(card.providers, card.title, showPaidOptions);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl bg-neutral-950">
      <div className="relative h-32 shrink-0 overflow-hidden">
        {heroSrc ? (
          <Image
            src={heroSrc}
            alt=""
            fill
            sizes="420px"
            className="object-cover object-top"
            draggable={false}
          />
        ) : (
          <div className="h-full w-full bg-neutral-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/60 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className="text-base font-semibold leading-tight text-white">
            {card.title}
            {card.year ? <span className="ml-1.5 font-normal opacity-70">({card.year})</span> : null}
          </div>
          {typeof card.rating === "number" ? (
            <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-400/40">
              ★ {card.rating.toFixed(1)} / 10
            </div>
          ) : null}
        </div>
      </div>

      {card.genres && card.genres.length > 0 ? (
        <div className="flex shrink-0 flex-wrap gap-1.5 px-3 pt-2">
          {card.genres.slice(0, 5).map((g) => (
            <span
              key={g}
              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] text-neutral-300"
            >
              {g}
            </span>
          ))}
        </div>
      ) : null}

      {card.reasons && card.reasons.length > 0 ? (
        <div className="mx-3 mt-2 shrink-0 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-cyan-300/80">
            Varför det här?
          </div>
          <p className="mt-1 text-xs leading-relaxed text-white/65">
            {card.reasons.join(" · ")}
          </p>
        </div>
      ) : null}

      {/* overscroll-contain: iOS studs-scroll ska stanna i beskrivningen och inte
          kedjas vidare till body när texten tar slut. */}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-3 py-2 text-sm leading-relaxed text-neutral-200/90">
        {card.overview || "Ingen beskrivning tillgänglig."}
      </div>

      {card.providers !== undefined && providerGroups.length > 0 ? (
        <div className="shrink-0 space-y-2 border-t border-white/5 px-3 py-2" onClick={(e) => e.stopPropagation()}>
          {providerGroups.map(({ label, list }) => (
            <div key={label}>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-cyan-400/70">
                {label}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {list.map((p) => {
                  const href = providerWatchUrl(p.provider_name, card.title);
                  const inner = (
                    <>
                      {p.logo_path ? (
                        <span className="relative inline-block h-4 w-4 overflow-hidden rounded">
                          <Image
                            src={`https://image.tmdb.org/t/p/w92${p.logo_path}`}
                            alt=""
                            fill
                            sizes="16px"
                            className="object-contain"
                          />
                        </span>
                      ) : null}
                      <span className="text-[11px]">{p.provider_name}</span>
                    </>
                  );
                  const cls =
                    "inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-neutral-200";
                  return href ? (
                    <a
                      key={p.provider_name}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${cls} transition hover:border-cyan-400/40 hover:bg-cyan-400/10`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {inner}
                    </a>
                  ) : (
                    <span key={p.provider_name} className={cls}>
                      {inner}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {paidOnly ? (
        <div className="shrink-0 px-3 pb-1 pt-1 text-[11px] text-white/40">{PAID_ONLY_LABEL}</div>
      ) : null}

      <div
        className="flex shrink-0 flex-wrap gap-2 px-3 pb-3 pt-1"
        onClick={(e) => e.stopPropagation()}
      >
        {card.providers !== undefined && !paidOnly ? <WatchNowButton url={watchUrl} /> : null}
        <TrailerButton trailer={card.trailer} title={card.title} variant="ghost" />
        {onShare ? (
          <button
            type="button"
            onClick={() => onShare(card)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:border-white/25 hover:bg-white/10"
          >
            <Send className="h-4 w-4" />
            Tipsa
          </button>
        ) : null}
      </div>
    </div>
  );
}
