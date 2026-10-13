"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Image from "next/image";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { CalendarClock, ChevronUp, Eye, Heart, Send, X } from "lucide-react";
import {
  animate,
  motion,
  motionValue,
  useAnimation,
  useMotionValue,
  useTransform,
  type AnimationPlaybackControls,
  type LegacyAnimationControls,
  type MotionValue,
} from "framer-motion";
import ActionDock from "@/app/components/ui/ActionDock";
import ProfileAvatarButton, { type AvatarButtonUser } from "@/app/components/navigation/ProfileAvatarButton";
import { Button } from "@/app/components/ui/kit";
import { useSoloSwipeDeck } from "@/app/recs/SwipeDeckProvider";
import type { SwipeCard, SwipeProviders, Trailer } from "@/lib/swipeDeck";
import { hideFor7Days, markSeen, unhide, unmarkSeen } from "@/lib/swipeDeck";
import { adsenseClientId, adsenseSlotId } from "@/lib/ads";
import { goPremium } from "@/lib/premiumPurchase";
import { trackSwipeForNudge } from "@/lib/signupNudge";
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
import { useLocale, useTranslations } from "next-intl";
import { funnel, funnelSwipe } from "@/lib/funnel";
import { recordLike } from "@/lib/engagement";
import FirstCardHint, { markFirstCardHintDone, shouldShowFirstCardHint } from "@/app/components/client/FirstCardHint";
import PickLauncher from "@/app/components/pick/PickLauncher";

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
const ShareTitleModal = dynamic(() => import("@/app/components/client/ShareTitleModal"), {
  ssr: false,
});
// Laddas bara för profiler utan tjänster — alla andra betalar inget för den.
const ProviderPromptSheet = dynamic(() => import("@/app/components/client/ProviderPromptSheet"), {
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

/**
 * Kortleken rapporterar felkoder (se lib/swipeDeckStore). Är strängen ingen
 * känd kod är den ett färdigt meddelande från servern och visas som den är.
 */
function deckErrorText(code: string | null, t: (k: string) => string): string {
  if (!code) return "";
  const known = ["deck_fetch_failed_retry", "deck_fetch_failed", "network_check_connection", "group_deck_fetch_failed", "network_error"];
  return known.includes(code) ? t(`deckError.${code}`) : code;
}

function pushUndo(stack: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  return [entry, ...stack].slice(0, UNDO_MAX);
}

/**
 * Premiärdatum på användarens språk. Faller tillbaka på ISO-strängen om datumet
 * är skräp — ett kort ska aldrig rendera "Invalid Date".
 */
function formatPremiereDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/**
 * Kör `fn` direkt efter nästa ritade bildruta. Nätverksanropen för en swipe
 * (betyg, watchlist, gruppröst) startades förr i samma synkrona block som
 * själva kortbytet — att bara STARTA fetch kostar märkbart på en telefon, och
 * det sköt upp bildrutan där nästa kort tar över. Nu ritas kortbytet först.
 */
function afterPaint(fn: () => void): void {
  if (typeof window === "undefined") return fn();
  window.requestAnimationFrame(() => window.setTimeout(fn, 0));
}

function saveRating(c: Card, decision: "like" | "dislike" | "seen") {
  afterPaint(() => postRating(c, decision));
}

function postRating(c: Card, decision: "like" | "dislike" | "seen") {
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
/**
 * Kör `fn` när huvudtråden är ledig (efter pågående swipe-animation), med
 * tak så att det aldrig dröjer mer än ~600 ms. iOS WKWebView saknar
 * requestIdleCallback — där räcker en kort timeout förbi ut-animationen.
 */
function whenIdle(fn: () => void): void {
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(fn, { timeout: 600 });
  else window.setTimeout(fn, 320);
}

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
  const t = useTranslations("swipe");
  const options: { id: SwipeMediaFilter; label: string }[] = [
    { id: "both", label: t("filterBoth") },
    { id: "movie", label: t("filterMovie") },
    { id: "tv", label: t("filterTv") },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={t("filterAria")}
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

export default function SwipePageClient({
  needsProviders = false,
  me = null,
}: { needsProviders?: boolean; me?: AvatarButtonUser | null } = {}) {
  const t = useTranslations("swipe");
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

  // Tratt (lib/funnel.ts): kom fram till swipen → första kortet syns (och hur
  // lång tid det tog) / leken tom / fel. Bara solo — grupp har egen klient.
  const swipeMountAt = useRef(Date.now());
  useEffect(() => funnel("swipe_view"), []);
  const hasCards = cards.length > 0;
  useEffect(() => {
    if (hasCards) funnel("deck_ready", { ms: Date.now() - swipeMountAt.current });
  }, [hasCards]);
  useEffect(() => {
    if (feedError) funnel("deck_error");
    else if (!hasCards && ready && !loading) funnel("deck_empty");
  }, [feedError, hasCards, ready, loading]);

  const undoStackRef = useRef<UndoEntry[]>([]);

  const [flippedId, setFlippedId] = useState<string | null>(null);
  // Gesttipset på första riktiga kortet (ersätter den automatiska guiden).
  const [firstHint, setFirstHint] = useState(false);
  useEffect(() => {
    setFirstHint(shouldShowFirstCardHint());
  }, []);

  // Betygs-popup efter swipe upp ("Sett"). Kortet är redan sparat som "seen"
  // — popupen är valfri och lägger bara till ett 1–10-betyg ovanpå.
  const [ratePrompt, setRatePrompt] = useState<Card | null>(null);
  const [ratingSaving, setRatingSaving] = useState(false);

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
    // Starta hämtningen först när kortbytet är ritat (se afterPaint): effekten
    // körs annars synkront i samma block som swipen.
    let cancelled = false;
    afterPaint(() => {
      if (cancelled) return;
      toFetch.forEach((t) => fetched.current.add(t.id));
      // Details + providers hämtas parallellt men skrivs in i leken i EN
      // uppdatering, och först när huvudtråden är ledig. Förr kom upp till sex
      // separata uppdateringar per swipe (två per kort), ofta mitt i ut-
      // animationen — varje uppdatering renderade om hela swipevyn och gav ett
      // hack. Korten det gäller ligger bakom toppkortet, så det är ingen brådska.
      void Promise.all(
        toFetch.map((t) =>
          Promise.all([
            fetchDetailsWithFallback(t.mediaType, t.tmdbId),
            fetchWatchProviders(t.mediaType, t.tmdbId),
          ]).then(([det, providers]) => ({ id: t.id, det, providers }))
        )
      ).then((results) => {
        const byId = new Map(results.map((r) => [r.id, r]));
        whenIdle(() =>
          updateSoloCards((prev) =>
            prev.map((c) => {
              const r = byId.get(c.id);
              if (!r) return c;
              const det = r.det;
              const next = det
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
                : { ...c };
              if (next.providers === undefined) next.providers = r.providers;
              return next;
            })
          )
        );
      });
    });
    return () => {
      cancelled = true;
    };
  }, [cards, updateSoloCards]);

  // Den passiva swipe-guiden som låg här togs bort 2026-08-21: den förklarade
  // samma sak som SwipeGestureTour (app/swipe/page.tsx), fast utan att man fick
  // göra något — två genomgångar av samma gester som kunde tända efter varandra.

  // AdMob måste initieras innan registerSwipeForAds() gör något — utan det här
  // anropet returnerade den direkt (initialized=false) och iOS-appen visade
  // aldrig en enda annons, trots att hela AdMob-lagret fanns färdigt.
  // Idempotent och no-op på webben. För en NY enhet gör anropet ingenting:
  // samtycke + ATT frågas först strax före första annonsen (registerSwipeForAds
  // startar init då, se lib/admobAds.ts). För enheter som redan swipat förbi
  // startsträckan initieras allt här som förut.
  useEffect(() => {
    void initAdMobIfEligible();
  }, []);

  useEffect(() => {
    if (mode === "group" && group?.code && !groupRefreshAttempted) {
      groupRefreshAttempted = true;
      router.refresh();
    }
  }, [mode, group?.code, router]);

  // Premium-CTA:n efter annonsen triggas när annonskortet LÄMNAR däcket
  // (dismissAdCard nedan), inte när det blir överst. Poängen är att erbjudandet
  // ska komma när användaren precis suttit av en annons — inte mitt i den.
  const countedAds = useRef<Set<string>>(new Set());

  /** Annonskortet är avklarat: räkna visningen och låt frekvensspärren avgöra. */
  function dismissAdCard(c: Card): void {
    funnel("ad_card");
    if (!countedAds.current.has(c.id)) {
      countedAds.current.add(c.id);
      // Utan AdSense-klient ÄR annonskortet redan en premium-CTA — ett
      // CTA-ark direkt efter vore samma erbjudande två gånger i rad.
      if (adsenseClientId()) maybeTriggerAdUpsell();
    }
    popTop();
  }

  function popTop() {
    setFlippedId(null);
    popSoloCard();
  }

  /* ---------- group helpers (fire-and-forget; blockerar inte UI) ---------- */

  function sendGroupVoteBackground(c: Card, vote: "LIKE" | "DISLIKE") {
    if (mode !== "group" || !group?.code) return;
    const code = group.code;
    afterPaint(() => sendGroupVote(c, vote, code));
  }

  function sendGroupVote(c: Card, vote: "LIKE" | "DISLIKE", code: string) {
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
    if (c.kind === "ad") { dismissAdCard(c); return; }
    funnelSwipe("dislike");
    recordUndo(c, "dislike");
    markSeen(c.id);
    hideFor7Days(c.tmdbId);
    saveRating(c, "dislike");
    popTop();
    sendGroupVoteBackground(c, "DISLIKE");
    // Gäst-konverteringen räknar bara solo — en gruppkväll ska inte avbrytas.
    if (mode !== "group") trackSwipeForNudge("dislike");
  }

  function handleLike(c: Card): void {
    if (c.kind === "ad") { dismissAdCard(c); return; }
    funnelSwipe("like");
    recordLike();
    recordUndo(c, "like");
    markSeen(c.id);
    saveRating(c, "like");
    popTop();
    afterPaint(() => void fetch("/api/watchlist/like", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        tmdbId: c.tmdbId,
        mediaType: c.mediaType,
        title: c.title,
        year: c.year,
        poster: c.poster,
        // "Kommer snart"-kort: liken är både en sparning OCH en bevakning.
        // Servern lägger en ReleaseFollow och cronen pushar när titeln släppts
        // (se lib/upcomingTitles.ts och app/api/cron/daily-recs).
        ...(c.kind === "upcoming"
          ? { followRelease: true, releaseDate: c.releaseDate ?? null }
          : {}),
      }),
    }).catch(() => {
      /* best-effort */
    }));
    sendGroupVoteBackground(c, "LIKE");
    // Gäst-konverteringen räknar bara solo — en gruppkväll ska inte avbrytas.
    if (mode !== "group") trackSwipeForNudge("like");

    // Toppmatch firas bara i solo — i grupp äger gruppmatchen den rutan.
    if (c.topMatch && mode !== "group") setSoloMatch(c);
  }

  function handleSeen(c: Card): void {
    if (c.kind === "ad") { dismissAdCard(c); return; }
    funnelSwipe("seen");
    recordUndo(c, "seen");
    markSeen(c.id);
    hideFor7Days(c.tmdbId);
    saveRating(c, "seen");
    popTop();
    sendGroupVoteBackground(c, "DISLIKE");
    // Gäst-konverteringen räknar bara solo — en gruppkväll ska inte avbrytas.
    if (mode !== "group") trackSwipeForNudge("seen");
    // Betygsfrågan hoppas över för osläppta titlar — "Vad tyckte du?" om en film
    // som inte finns än är bara förvirrande.
    if (c.kind !== "upcoming") setRatePrompt(c);
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
        if (!res.ok) notify(t("ratingSaveFailed"));
      })
      .catch(() => {
        notify(t("ratingSaveFailed"));
      })
      .finally(() => {
        setRatingSaving(false);
        setRatePrompt(null);
      });
  }

  function handleUndo(): void {
    const entry = undoStackRef.current[0];
    if (!entry) {
      notify(t("nothingToUndo"));
      return;
    }
    undoStackRef.current = undoStackRef.current.slice(1);
    setRatePrompt(null);
    // Ångrat medan kortet fortfarande flyger ut: ta tillbaka det direkt.
    setLeaving((prev) => prev.filter((l) => l.card.id !== entry.card.id));
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
      notify(t("undoFailed"));
    });
  }

  /* ---------- render ---------- */

  // Höjd från 110 eftersom kortet numera följer fingret 1:1 —
  // kortet följer fingret hela vägen, så samma fysiska rörelse ger längre
  // offset än förut. 130 håller släppkänslan kalibrerad.
  const DIST_THRESHOLD = 130;
  const VELOCITY_THRESHOLD = 700;

  /**
   * Kastar ut toppkortet. `releaseVelocity` är fingrets hastighet vid släpp —
   * fjädern ärver den, så en snabb flick lämnar skärmen fortare än ett
   * knapptryck. Kortet känns kastat i stället för uppspelat.
   */
  // Kort som är på väg ut. Fram till 2026-10-12 väntade swipeOut på att
  // utfjädern landat (~0,5 s, längre på en långsam telefon) INNAN leken gick
  // vidare: under tiden gick nästa kort inte att swipa, och sedan monterades
  // hela kortstacken om på en gång — det var hacket mitt i varje swipe. Nu
  // flyger det utswipade kortet ut i ett eget lager medan leken går vidare
  // direkt, och korten behåller sina DOM-noder (samma nyckel och elementtyp)
  // när de flyttar upp i stacken.
  const [leaving, setLeaving] = useState<LeavingCard[]>([]);

  /**
   * Kastar ut toppkortet. `releaseVelocity` är fingrets hastighet vid släpp —
   * fjädern ärver den, så en snabb flick lämnar skärmen fortare än ett
   * knapptryck. Kortet känns kastat i stället för uppspelat.
   */
  function swipeOut(dir: "left" | "right" | "up", releaseVelocity = 0) {
    if (firstHint) {
      setFirstHint(false);
      markFirstCardHintDone();
    }
    const c = cards[0];
    if (!c) return;

    // Kortets egna rörelsevärden, startade där fingret släppte. Skapas FÖRE
    // renderingen så att kortet aldrig ritas en bildruta i mitten.
    const leave: LeavingCard = {
      card: c,
      dir,
      x: motionValue(x.get()),
      y: motionValue(y.get()),
      rotate: motionValue(rotate.get()),
      opacity: motionValue(1),
      like: motionValue(dir === "right" ? 1 : 0),
      nope: motionValue(dir === "left" ? 1 : 0),
      seen: motionValue(dir === "up" ? 1 : 0),
    };
    // Toppkortets delade värden nollas innan nästa kort tar över dem.
    x.set(0);
    y.set(0);
    controls.set({ x: 0, y: 0, opacity: 1 });

    // Synkront: leken går vidare och kortet byter lager i SAMMA commit, så
    // ingenting hinner ritas emellan (onDragEnd körs i framers postRender).
    flushSync(() => {
      setLeaving((prev) => [...prev.filter((l) => l.card.id !== c.id).slice(-2), leave]);
      if (dir === "right") handleLike(c);
      else if (dir === "left") handleDislike(c);
      else handleSeen(c);
    });

    const spring = {
      type: "spring" as const,
      stiffness: 200,
      damping: 26,
      velocity: releaseVelocity,
      restDelta: 1,
      restSpeed: 10,
    };
    const anims: AnimationPlaybackControls[] = [];
    if (dir === "up") {
      anims.push(animate(leave.y, -760, spring));
    } else {
      anims.push(
        animate(leave.x, dir === "right" ? 560 : -560, {
          ...spring,
          onUpdate: (v) => leave.rotate.set(Math.max(-16, Math.min(16, (v / 260) * 16))),
        })
      );
    }
    anims.push(animate(leave.opacity, 0, { duration: 0.18, ease: "easeOut" }));
    // Osynligt efter 0,18 s — ta bort lagret strax efter i stället för att
    // låta fjädern rinna ut i en halv sekund till.
    window.setTimeout(() => {
      anims.forEach((a) => a.stop());
      setLeaving((prev) => prev.filter((l) => l !== leave));
    }, 240);

    // AdMob-interstitial (endast native iOS + gratis, no-op annars).
    registerSwipeForAds();
    // ProviderPromptSheet räknar swipes via det här eventet (sträng i stället
    // för import av SOLO_SWIPED_EVENT — importen hade dragit in arket i
    // förstaladdningens bundle).
    if (needsProviders) window.dispatchEvent(new Event("nw:solo-swiped"));
  }

  const stackIndices: number[] = [];
  if (cards.length > 0) {
    for (let i = Math.min(2, cards.length - 1); i >= 0; i--) stackIndices.push(i);
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <SwipeLimitWall />
      <PremiumUpsellModal />
      {needsProviders ? <ProviderPromptSheet /> : null}
      {/* Stacken renderar kort 0–2; värm posters för 3..7 så nästa kort aldrig
          poppar in halvladdat. Samma sizes som Fronts <Image> — annars värms
          fel bildvariant. */}
      <DeckPosterPreload
        posters={cards.slice(3, 8).map((c) => c.poster)}
        sizes="(max-width: 768px) 100vw, 600px"
      />

      {/* Toppraden: [Välj åt mig] · Båda/Film/Serier (centrerad) · avatar.
          Film/serie-filtret bor här (flyttat från profilen — valet hör hemma där
          man ser effekten). Avataren leder till profilen, där resten av det som
          styr förslagen (tjänster, genrer) finns — och sedan 2026-10-13 är den
          vägen dit på mobilen, eftersom Profil inte längre är en flik. I gruppläge
          styr gruppens egna inställningar, så pillen visas bara solo.
          Pillen är absolut centrerad, så sidornas bredd påverkar inte den. */}
      <div className="relative flex shrink-0 items-center px-3 pt-2">
        {/* 40×40-platsen till vänster: tom ruta reserverar bredden även när
            knappen inte renderas (utrullningen avstängd), så raden inte hoppar. */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center">
          <PickLauncher />
        </div>
        {mode === "individual" && (
          <MediaFilterPill
            value={mediaFilter}
            onChange={(next) => void saveSwipeSettings({ mediaFilter: next })}
          />
        )}
        <div className="ml-auto">
          <ProfileAvatarButton me={me} />
        </div>
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
        heading={t("ratePrompt")}
        saving={ratingSaving}
        onRate={submitSeenRating}
        onSkip={() => setRatePrompt(null)}
      />
      {mode === "group" && group?.code && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2 rounded-full border border-emerald-500/40 bg-emerald-950/85 px-3 py-1 text-xs font-medium text-emerald-200">
          {t("groupLabel")} <span className="font-mono tracking-wider">{group.code}</span>
        </div>
      )}

      {/* Kort + knappar ("två lager, inte tre", 2026-10-13): kortet växer ända ner
          och knapparna grenslar dess underkant i stället för att ha en egen rad.
          Ytterytan: flex-1 + min-h-0 => flexbox styr höjden. Den har bara absoluta
          barn, så innehållet kan aldrig trycka upp den.
          Inre ytan (overflow-hidden) slutar 38 px ovanför ytterytans botten =
          knapparnas halva höjd (30) + luft mot tabbraden (8). Kortet går ända ner
          till den inre ytans botten, så dess underkant hamnar exakt mitt i
          knapparna, och kortet kan aldrig växa förbi ytan och klippas bakom dem.
          overflow-hidden sitter på den inre ytan och inte den yttre, så
          knapparnas skugga inte klipps.
          OBS: kort-wrappern är absolut positionerad (inte h-full) eftersom procenthöjder
          kollapsar till 0 när förfäderna bara har min-h + flex-1 (indefinit höjd). */}
      <div className="relative min-h-0 flex-1">
      <div className="absolute inset-x-0 top-0 bottom-[38px] overflow-hidden">
      {feedLoading ? (
        <div className="absolute inset-0 flex items-center justify-center">
          {/* Samma geometri som kortet (2/3, max 420 px, rounded-2xl) — övergången
              skelett → poster blir en ren korsning utan hopp i layouten. */}
          <CardSkeleton />
        </div>
      ) : feedError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-rose-300">{deckErrorText(feedError, t)}</p>
          <Button variant="secondary" onClick={() => void retrySoloDeck()}>
            {t("retry")}
          </Button>
        </div>
      ) : cards[0] || leaving.length > 0 ? (
          <div
            className="absolute inset-x-1 top-2 bottom-0 isolate mx-auto max-w-[min(100%,420px)] overflow-hidden"
          >
          {/* Bakifrån och fram: kort 3, 2, toppkortet, och överst de som är på
              väg ut. ALLA ritas av DeckCard med kortets id som nyckel, så ett
              kort som flyttar upp (eller kastas ut) behåller sin DOM-nod och
              sin redan avkodade bild i stället för att monteras om. */}
          {stackIndices.map((idx) => {
            const card = cards[idx];
            if (!card || leaving.some((l) => l.card.id === card.id)) return null;
            const isTop = idx === 0;
            return (
              <DeckCard
                key={card.id}
                card={card}
                depth={idx}
                top={
                  isTop
                    ? {
                        x,
                        y,
                        rotate,
                        controls,
                        likeOpacity,
                        nopeOpacity,
                        seenOpacity,
                        seenScale,
                        seenRotate,
                        flipped: flippedId === card.id,
                        onFlip: () => setFlippedId((p) => (p === card.id ? null : card.id)),
                        onShare: shareCard,
                        onRelease: (offsetX, offsetY, vx, vy) => {
                          const up =
                            (offsetY < -DIST_THRESHOLD || vy < -VELOCITY_THRESHOLD) &&
                            Math.abs(offsetY) > Math.abs(offsetX);
                          if (up) return swipeOut("up", vy);
                          if (offsetX > DIST_THRESHOLD || vx > VELOCITY_THRESHOLD) return swipeOut("right", vx);
                          if (offsetX < -DIST_THRESHOLD || vx < -VELOCITY_THRESHOLD) return swipeOut("left", vx);
                          void controls.start({
                            x: 0,
                            y: 0,
                            transition: { type: "spring", stiffness: 320, damping: 28 },
                          });
                        },
                        hint: firstHint && mode === "individual" && flippedId !== card.id,
                      }
                    : undefined
                }
              />
            );
          })}
          {leaving.map((l) => (
            <DeckCard key={l.card.id} card={l.card} depth={0} leaving={l} />
          ))}
          </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center opacity-70">
          Slut på förslag nu.
        </div>
      )}
      </div>

      {/* Knapparna: 60 px hög rad vars mitt ligger på kortets underkant (se
          ovan). pointer-events-none på raden — ett drag som börjar bredvid
          knapparna hamnar på kortet under; bara knapparna själva tar tryck.
          Info-knappen är borta: ett tryck på kortet vänder det redan. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-2 z-30 flex h-[60px] items-center justify-center">
        <ActionDock
          disabled={!cards[0] || feedLoading}
          // Knapptryck har ingen fingerhastighet — ge fjädern en syntetisk knuff
          // så knappen känns som ett bestämt kast i stället för en avspelning.
          onNope={() => swipeOut("left", -900)}
          onUndo={handleUndo}
          onLike={() => swipeOut("right", 900)}
        />
      </div>
      </div>

      <ShareTitleModal open={shareItem !== null} item={shareItem} onClose={() => setShareItem(null)} />

    </div>
  );
}


/* ---------- Kortstacken ---------- */

/** Ett kort på väg ut ur leken, med egna rörelsevärden (se swipeOut). */
type LeavingCard = {
  card: Card;
  dir: "left" | "right" | "up";
  x: MotionValue<number>;
  y: MotionValue<number>;
  rotate: MotionValue<number>;
  opacity: MotionValue<number>;
  like: MotionValue<number>;
  nope: MotionValue<number>;
  seen: MotionValue<number>;
};

type TopCardProps = {
  x: MotionValue<number>;
  y: MotionValue<number>;
  rotate: MotionValue<number>;
  controls: LegacyAnimationControls;
  likeOpacity: MotionValue<number>;
  nopeOpacity: MotionValue<number>;
  seenOpacity: MotionValue<number>;
  seenScale: MotionValue<number>;
  seenRotate: MotionValue<number>;
  flipped: boolean;
  onFlip: () => void;
  onShare: (card: Card) => void;
  onRelease: (offsetX: number, offsetY: number, velocityX: number, velocityY: number) => void;
  hint: boolean;
};

// Konstanta värden för "sett"-stämpeln på ett kort som redan är på väg ut.
const STAMP_SCALE_DONE = motionValue(1);
const STAMP_ROTATE_DONE = motionValue(0);
const noop = () => {};

/**
 * Ett kort i stacken — bakom, överst eller på väg ut. SAMMA komponent och
 * samma elementträd i alla tre lägen, med kortets id som nyckel, så React
 * flyttar DOM-noden i stället för att montera om kortet (och dess bild) när
 * det byter läge. Djupet (skala/förskjutning) animeras på ett inre lager.
 *
 * Inga filter, ingen backdrop-blur: bakomliggande kort mörkas med ett
 * svart lager i stället för filter: brightness(), som tvingade WKWebView att
 * rita om hela kortet varje bildruta medan toppkortet drogs.
 */
const DeckCard = memo(function DeckCard({
  card,
  depth,
  top,
  leaving,
}: {
  card: Card;
  depth: number;
  top?: TopCardProps;
  leaving?: LeavingCard;
}) {
  const d = leaving || top ? 0 : depth;
  const scale = d === 0 ? 1 : d === 1 ? 0.95 : 0.9;
  const shiftY = d === 0 ? 0 : d === 1 ? 10 : 20;
  const z = leaving ? 20 : d === 0 ? 10 : d === 1 ? 9 : 8;
  const style = top
    ? { x: top.x, y: top.y, rotate: top.rotate, zIndex: z }
    : leaving
    ? { x: leaving.x, y: leaving.y, rotate: leaving.rotate, opacity: leaving.opacity, zIndex: z }
    : { zIndex: z };

  return (
    <motion.div
      className={`absolute inset-0 flex items-center justify-center p-0.5 ${top ? "z-10 touch-none" : "pointer-events-none"}`}
      style={style}
      animate={top ? top.controls : undefined}
      drag={Boolean(top)}
      // INGA dragConstraints och ingen momentum. Med nollstora constraints startade
      // framer-motion en EGEN inertia-animation mot (0,0) i samma ögonblick fingret
      // släpptes, medan vårt onDragEnd körs en bildruta senare (frame.postRender) —
      // de två skrev till samma motion values och kortet ryckte tillbaka innan
      // utkastet tog över. Utan constraints och momentum äger onDragEnd hela släppet.
      dragMomentum={false}
      onDragEnd={
        top
          ? (_, info) => top.onRelease(info.offset.x, info.offset.y, info.velocity.x, info.velocity.y)
          : undefined
      }
    >
      <motion.div
        className="relative h-full max-h-full w-full min-h-0"
        initial={false}
        animate={{ scale, y: shiftY }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
      >
        <StaticCard
          card={card}
          flipped={top?.flipped ?? false}
          interactive={Boolean(top)}
          onFlip={top?.onFlip ?? noop}
          onShare={top?.onShare}
          dockInset
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl bg-black transition-opacity duration-200"
          style={{ opacity: d === 0 ? 0 : 0.12 }}
        />
      </motion.div>
      {top ? (
        <SwipeStampOverlays
          likeOpacity={top.likeOpacity}
          nopeOpacity={top.nopeOpacity}
          seenOpacity={top.seenOpacity}
          seenScale={top.seenScale}
          seenRotate={top.seenRotate}
        />
      ) : leaving ? (
        <SwipeStampOverlays
          likeOpacity={leaving.like}
          nopeOpacity={leaving.nope}
          seenOpacity={leaving.seen}
          seenScale={STAMP_SCALE_DONE}
          seenRotate={STAMP_ROTATE_DONE}
        />
      ) : null}
      {top ? <FirstCardHint visible={top.hint} /> : null}
    </motion.div>
  );
});

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
  dockInset = false,
}: {
  card: Card;
  flipped: boolean;
  interactive?: boolean;
  onFlip: () => void;
  /** Öppnar "Tipsa en vän" för kortet. Bara meningsfullt på toppkortet. */
  onShare?: (card: Card) => void;
  /**
   * Swipe-knapparna (ActionDock) grenslar kortets underkant och täcker de
   * nedersta ~30 px. Lyfter titel, betyg och baksidans knapprad ovanför dem.
   * Av som standard — swipe-guiden återanvänder kortet utan knappar.
   */
  dockInset?: boolean;
}) {
  // Baksidan (backdrop-bild, tjänster, knappar) byggs bara för toppkortet, och
  // först när det legat still en stund — eller direkt om kortet vänds. Förr
  // renderades den för alla tre korten i stacken vid varje swipe, med en
  // extra bild att avkoda per kort.
  const [backReady, setBackReady] = useState(false);
  useEffect(() => {
    if (!interactive || backReady) return;
    const t = window.setTimeout(() => setBackReady(true), 450);
    return () => window.clearTimeout(t);
  }, [interactive, backReady]);
  const showBack = backReady || flipped;

  // Annonskort: ingen flip, ingen poster – renderar AdCard (AdSense/AdMob).
  if (card.kind === "ad") {
    return (
      <div className="relative h-full max-h-full w-full min-h-0">
        <AdCard adId={card.id} dockInset={dockInset} />
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
        className={`relative h-full max-h-full w-full min-h-0 rounded-2xl border border-white/15 bg-black shadow-xl transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] [transform-style:preserve-3d] ${interactive ? "will-change-transform" : ""}`}
        style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
      >
        <div className="absolute inset-0 [backface-visibility:hidden]">
          <Front card={card} flipped={flipped} dockInset={dockInset} />
        </div>
        {showBack ? (
          <div className="absolute inset-0 rotate-y-180 [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <Back card={card} onShare={onShare} dockInset={dockInset} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Annonskort (AdSense på webb, AdMob på iOS i Fas 2) ---------- */

function AdCard({ adId, dockInset = false }: { adId: string; dockInset?: boolean }) {
  const t = useTranslations("swipe");
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
    // dockInset: annonsytan slutar ovanför swipe-knapparna — en annons under en
    // knapp ger felklick (och bryter mot AdSense-reglerna om placering).
    <div
      className={`relative flex h-full w-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/15 bg-neutral-950 ${dockInset ? "pb-12" : ""}`}
    >
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
          <div className="text-sm text-white/70">{t("adSlot")}</div>
          <p className="max-w-[16rem] text-xs leading-relaxed text-white/40">
            {t("adSlotHint")}
          </p>
          <span className="mt-1 rounded-full bg-amber-400/15 px-4 py-1.5 text-xs font-semibold text-amber-300 ring-1 ring-amber-400/40">
            {t("upgradeCta")}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * "Kommer snart"-märket. Egen komponent eftersom både fram- och baksidan visar
 * det, i samma visuella språk som kortets övriga märken (rundad ruta, blur,
 * versal mikrotext) fast i bärnsten i stället för cyan/smaragd.
 */
function UpcomingBadge({ className = "" }: { className?: string }) {
  const t = useTranslations("swipe");
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-black/75 px-2 py-1 ${className}`}
    >
      <CalendarClock className="h-3.5 w-3.5 text-amber-300" />
      <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-300">
        {t("upcoming.badge")}
      </span>
    </div>
  );
}

function Front({ card, flipped, dockInset = false }: { card: Card; flipped: boolean; dockInset?: boolean }) {
  const t = useTranslations("swipe");
  const locale = useLocale();
  const isUpcoming = card.kind === "upcoming";
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
      {/* Samma dölj-vid-flip-regel som matchremsan nedan: backdrop-blur får
          WKWebView att ibland rita elementet spegelvänt trots backface-visibility. */}
      {!flipped && isUpcoming ? (
        <div className="pointer-events-none absolute left-3 top-3 z-10">
          <UpcomingBadge />
        </div>
      ) : null}

      {!flipped && card.reasons && card.reasons.length > 0 ? (
        <div className="pointer-events-none absolute left-3 right-3 top-3 z-10">
          <div className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-cyan-400/30 bg-black/75 px-2 py-1">
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

      {/* Med dockInset ligger knapparna över de nedersta ~30 px: titeln lyfts
          44 px (pb 16 → 60) och skrimmet blir högre och mörkare, så texten
          läses lika bra en bit upp på postern. */}
      <div className={`pointer-events-none absolute inset-x-0 bottom-0 p-4 ${dockInset ? "pb-[3.75rem]" : ""}`}>
        <div
          className={`bg-gradient-to-t to-transparent ${
            dockInset ? "h-40 from-black/95 via-black/70" : "h-28 from-black/90"
          }`}
        />
        <div className="-mt-24 px-1">
          <div className="text-lg font-semibold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
            {card.title}
            {card.year ? <span className="ml-2 opacity-80">({card.year})</span> : null}
          </div>
          {isUpcoming && card.releaseDate ? (
            <div className="mt-0.5 text-xs font-medium text-amber-300/90 [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
              {t("upcoming.premiere", { date: formatPremiereDate(card.releaseDate, locale) })}
            </div>
          ) : null}
        </div>
      </div>

      {/* Betyget döljs på osläppta titlar: TMDB rapporterar 0 (eller ett snitt
          byggt på en handfull förhandsröster) innan premiären, och "★ 0.0" ser
          ut som ett underkännande. Premiärdatumet är kortets siffra i stället. */}
      {!isUpcoming && typeof card.rating === "number" ? (
        <div
          className={`absolute right-2 rounded-md bg-black/70 px-2 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-400/40 ${
            dockInset ? "bottom-[3.25rem]" : "bottom-2"
          }`}
        >
          ★ {card.rating.toFixed(1)}
        </div>
      ) : null}
    </div>
  );
}

function Back({
  card,
  onShare,
  dockInset = false,
}: {
  card: Card;
  onShare?: (card: Card) => void;
  dockInset?: boolean;
}) {
  const t = useTranslations("swipe");
  const tw = useTranslations("watch");
  const locale = useLocale();
  const heroSrc = card.backdrop ?? card.poster;
  const { showPaidOptions } = useSwipeSettings();
  // Osläppt titel: allt som handlar om ATT SE den nu (providerchips, "Kolla nu",
  // hyr/köp-raden) är meningslöst — TMDB har inga watch-providers före premiär,
  // och knappen hade renderats som en grå "Inte tillgänglig". Trailern behålls,
  // den är ofta hela poängen med kortet.
  const isUpcoming = card.kind === "upcoming";
  const providerGroups = isUpcoming ? [] : providerGroupsFor(card.providers, showPaidOptions);
  const paidOnly = !isUpcoming && isPaidOnly(card.providers, showPaidOptions);
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
          {isUpcoming ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <UpcomingBadge />
              {card.releaseDate ? (
                <span className="text-xs font-medium text-amber-300/90">
                  {t("upcoming.premiere", { date: formatPremiereDate(card.releaseDate, locale) })}
                </span>
              ) : null}
            </div>
          ) : typeof card.rating === "number" ? (
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
            {t("whyThis")}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-white/65">
            {card.reasons.join(" · ")}
          </p>
        </div>
      ) : null}

      {/* overscroll-contain: iOS studs-scroll ska stanna i beskrivningen och inte
          kedjas vidare till body när texten tar slut. */}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-3 py-2 text-sm leading-relaxed text-neutral-200/90">
        {card.overview || t("noDescription")}
      </div>

      {card.providers !== undefined && providerGroups.length > 0 ? (
        <div className="shrink-0 space-y-2 border-t border-white/5 px-3 py-2" onClick={(e) => e.stopPropagation()}>
          {providerGroups.map(({ labelKey, list }) => (
            <div key={labelKey}>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-cyan-400/70">
                {tw(`group.${labelKey}`)}
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
        <div className="shrink-0 px-3 pb-1 pt-1 text-[11px] text-white/40">{tw("paidOnly")}</div>
      ) : null}

      {isUpcoming ? (
        <div className="shrink-0 px-3 pb-1 pt-1 text-[11px] leading-relaxed text-amber-300/70">
          {t("upcoming.followHint")}
        </div>
      ) : null}

      {/* pb-14 med dockInset: "Kolla nu"/trailer/tipsa får inte hamna under
          swipe-knapparna, som grenslar kortets underkant. */}
      <div
        className={`flex shrink-0 flex-wrap gap-2 px-3 pt-1 ${dockInset ? "pb-14" : "pb-3"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {!isUpcoming && card.providers !== undefined && !paidOnly ? (
          <WatchNowButton url={watchUrl} />
        ) : null}
        <TrailerButton trailer={card.trailer} title={card.title} variant="ghost" />
        {onShare ? (
          <button
            type="button"
            onClick={() => onShare(card)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:border-white/25 hover:bg-white/10"
          >
            <Send className="h-4 w-4" />
            {t("shareTip")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
