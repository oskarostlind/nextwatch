"use client";

// Grupp-swipe med exakt samma kortlek-UI som solo-swipen (app/swipe/page_client.tsx):
// framer-motion-drag, like/nope/sett-overlays, tap = info-flip, hint-rad istället
// för fysiska knappar. Skillnaden mot solo är bara dataflödet: feed från
// /api/recs/unified?group=CODE (via lib/swipeDeckStore.ts ensureGroupDeck) och
// röster till /api/group/vote (+ /api/rate, watchlist på like).

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useAnimation, useMotionValue, useTransform } from "framer-motion";
import {
  StaticCard,
  fetchDetailsWithFallback,
  fetchWatchProviders,
  SwipeStampOverlays,
  type Card,
} from "../../swipe/page_client";
import ActionDock from "@/app/components/ui/ActionDock";
import { useGroupSwipeDeck } from "@/app/recs/SwipeDeckProvider";
import SwipeLimitWall from "@/app/components/client/SwipeLimitWall";
import PremiumUpsellModal from "@/app/components/client/PremiumUpsellModal";
import { reportSwipeLimitFrom } from "@/lib/swipeLimitEvent";
import RatingModal from "@/app/components/client/RatingModal";
import { emitGroupVoted } from "@/lib/groupVoteEvent";
import { notify } from "@/app/components/lib/notify";
import { hideFor7Days, markSeen, unhide, unmarkSeen } from "@/lib/swipeDeck";
import { initAdMobIfEligible, registerSwipeForAds } from "@/lib/admobAds";
import { CardSkeleton } from "@/app/components/ui/Skeletons";
import { useTranslations } from "next-intl";

type MediaType = "movie" | "tv";

type SwipeAction = "like" | "dislike" | "seen";

type UndoEntry = {
  card: Card;
  action: SwipeAction;
};

const UNDO_MAX = 5;

type MatchResp =
  | { ok: true; match: { tmdbId: number; tmdbType: MediaType } | null }
  | { ok: false };

/** Hur få kort som får finnas kvar innan användaren varnas att leken snart tar slut. */
const LOW_DECK_WARNING_CARDS = 4;

export default function GroupSwipePage({ code }: { code: string }) {
  const t = useTranslations("groupSwipe");
  const { deck, popCard, updateCards, unshiftCard, retry } = useGroupSwipeDeck(code);
  const { cards, loading, ready, hasMore, broadened } = deck;
  const showLoading = cards.length === 0 && (loading || !ready);

  const undoStackRef = useRef<UndoEntry[]>([]);

  // Varna INNAN leken tar slut, så det inte kommer som en överraskning att
  // sökningen vidgas eller att förslagen snart sinar. Återställs så fort en
  // påfyllning (lib/swipeDeckStore.ts maybePrefetchGroupPages) gett fler kort,
  // så varningen kan visas igen nästa gång leken blir tunn.
  // Starta AdMob även här — annars visas interstitials bara för den som
  // passerat solo-swipen den här appstarten. Idempotent och no-op på webben.
  useEffect(() => {
    void initAdMobIfEligible();
  }, []);

  const warnedLowRef = useRef(false);
  useEffect(() => {
    if (!ready || cards.length === 0) return;
    if (hasMore && cards.length <= LOW_DECK_WARNING_CARDS) {
      if (!warnedLowRef.current) {
        warnedLowRef.current = true;
        notify(t("fewLeftFetching"));
      }
    } else if (cards.length > LOW_DECK_WARNING_CARDS) {
      warnedLowRef.current = false;
    }
    // t() är stabil per språk/namnrymd (next-intl memoiserar den). Att lägga
    // den i deps skulle bara riskera en extra hämtning vid språkbyte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length, hasMore, ready]);

  // Servern (lib/unifiedRecs.ts) släpper hårda genre-/nyckelordsfilter när
  // gruppens val gjort TMDB-katalogen för smal. Ett nytt `broadened`-objekt
  // per hämtning (se lib/swipeDeckStore.ts) => effekten triggar en gång per
  // svar; själva flaggorna avgör om det faktiskt är värt att säga något.
  useEffect(() => {
    if (!broadened) return;
    if (broadened.genres) {
      notify(t("widenedDroppedGenres"));
    } else if (broadened.keywords) {
      notify(t("widenedSubgenres"));
    }
    // t() är stabil per språk/namnrymd (next-intl memoiserar den). Att lägga
    // den i deps skulle bara riskera en extra hämtning vid språkbyte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadened]);

  // Leken kan tömmas helt (hasMore=false, 0 kort kvar) trots påfyllningen ovan
  // — t.ex. om även det vidgade sökningsläget är uttömt just nu. Tidigare var
  // enda vägen tillbaka att lämna swipen och trycka "Starta gruppswipe" i
  // gruppfliken, vilket bara gör samma sak (ensureGroupDeck med tomma cards
  // triggar redan en full omstart) fast med en extra navigering. Gör det
  // navigeringsfritt: försök EN gång automatiskt, återställ bara flaggan när
  // leken faktiskt fylls på igen (annars skulle en fortsatt tom lek trigga om
  // och om igen varje render).
  const autoRetriedRef = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (cards.length > 0) {
      autoRetriedRef.current = false;
      return;
    }
    if (loading || hasMore || autoRetriedRef.current) return;
    autoRetriedRef.current = true;
    notify(t("lookingForMore"));
    void retry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length, ready, loading, hasMore]);

  const [flippedId, setFlippedId] = useState<string | null>(null);

  // Betygs-popup efter "Sett" (swipe upp), precis som i solo-swipen. Kortet är
  // redan sparat som "seen" via /api/rate — modalen lägger valfritt ett 1–10-
  // betyg ovanpå via /api/ratings/save.
  const [ratePrompt, setRatePrompt] = useState<Card | null>(null);
  const [ratingSaving, setRatingSaving] = useState(false);

  const controls = useAnimation();

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-260, 260], [-16, 16]);
  const likeOpacity = useTransform(x, [48, 150], [0, 1]);
  const nopeOpacity = useTransform(x, [-150, -48], [1, 0]);
  const seenOpacity = useTransform(y, [-120, -36], [1, 0]);
  const seenScale = useTransform(y, [-120, -36], [0.88, 1.06]);
  const seenRotate = useTransform(y, [-120, -36], [-6, 0]);

  // Hydrera details (poster/år/betyg/beskrivning) för topp-3 i stacken, som solo.
  const fetched = useRef<Set<string>>(new Set());
  useEffect(() => {
    const toFetch = cards
      .slice(0, 3)
      .filter((c) => !fetched.current.has(c.id));
    if (toFetch.length === 0) return;

    toFetch.forEach((t) => fetched.current.add(t.id));
    Promise.all(
      toFetch.map((t) =>
        fetchDetailsWithFallback(t.mediaType, t.tmdbId).then((det) => ({ id: t.id, det }))
      )
    ).then((results) => {
      results.forEach(({ id, det }) => {
        if (!det) return;
        updateCards((prev) =>
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
                }
              : c
          )
        );
      });
    });
    // Providers hämtas parallellt med details (samma mönster som solo).
    toFetch.forEach((t) => {
      void fetchWatchProviders(t.mediaType, t.tmdbId).then((providers) => {
        updateCards((prev) =>
          prev.map((c) => (c.id === t.id && c.providers === undefined ? { ...c, providers } : c))
        );
      });
    });
  }, [cards, updateCards]);

  function popTop() {
    setFlippedId(null);
    popCard();
  }

  /* ---------- gruppröst + match-koll (fire-and-forget, blockerar inte UI) ---------- */

  const sendVote = useCallback(
    (c: Card, vote: "LIKE" | "DISLIKE") => {
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
          if (!res.ok) {
            // 429 = daglig swipegräns nådd — visa väggen (SwipeLimitWall lyssnar).
            reportSwipeLimitFrom(res);
            return null;
          }
          emitGroupVoted(); // OverlayMount snabb-pollar matchen (ersatte fetch-patchen)
          return fetch(`/api/group/match?code=${encodeURIComponent(code)}`, {
            cache: "no-store",
          });
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

      // Personlig rating i bakgrunden (smakmodellen), som tidigare.
      void fetch("/api/rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          tmdbId: c.tmdbId,
          mediaType: c.mediaType,
          decision: vote === "LIKE" ? "like" : "dislike",
        }),
      }).catch(() => {
        /* best-effort */
      });
    },
    [code]
  );

  function saveSeenRating(c: Card) {
    void fetch("/api/rate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        tmdbId: c.tmdbId,
        mediaType: c.mediaType,
        decision: "seen",
      }),
    }).catch(() => {
      /* best-effort */
    });
  }

  function recordUndo(c: Card, action: SwipeAction) {
    undoStackRef.current = [{ card: c, action }, ...undoStackRef.current].slice(0, UNDO_MAX);
  }

  function handleDislike(c: Card): void {
    recordUndo(c, "dislike");
    markSeen(c.id);
    hideFor7Days(c.tmdbId);
    popTop();
    sendVote(c, "DISLIKE");
  }

  function handleLike(c: Card): void {
    recordUndo(c, "like");
    markSeen(c.id);
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
    sendVote(c, "LIKE");
  }

  function handleSeen(c: Card): void {
    recordUndo(c, "seen");
    markSeen(c.id);
    hideFor7Days(c.tmdbId);
    popTop();
    saveSeenRating(c);
    sendVote(c, "DISLIKE");
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
      notify(t("nothingToUndo"));
      return;
    }
    undoStackRef.current = undoStackRef.current.slice(1);
    setRatePrompt(null);
    unmarkSeen(entry.card.id);
    if (entry.action === "dislike" || entry.action === "seen") {
      unhide(entry.card.tmdbId);
    }
    unshiftCard(entry.card);
    void fetch("/api/swipe/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        tmdbId: entry.card.tmdbId,
        mediaType: entry.card.mediaType,
        action: entry.action,
        groupCode: code,
      }),
    }).catch(() => {
      notify(t("undoFailed"));
    });
  }

  /* ---------- render (identisk med solo-swipen) ---------- */

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
    // Räknaren i lib/admobAds är modulglobal och delas med solo-swipen, så en
    // användare som växlar mellan lägena får inte annonser dubbelt så tätt.
    registerSwipeForAds();
    x.set(0);
    y.set(0);
    controls.set({ x: 0, y: 0, opacity: 1 });
  }

  if (!code) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center">
        <p className="text-sm text-neutral-400">
          Saknar <code>?code=XXXXXX</code> i URL:en.
        </p>
      </div>
    );
  }

  if (showLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {/* Samma geometri som kortet (2/3, max 420 px, rounded-2xl) — övergången
            skelett → poster blir en ren korsning utan hopp i layouten. */}
        <CardSkeleton />
      </div>
    );
  }

  const stackIndices: number[] = [];
  if (cards.length > 0) {
    for (let i = Math.min(2, cards.length - 1); i >= 0; i--) stackIndices.push(i);
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <SwipeLimitWall />
      {/* Lyssnar på "nw:admob-ad-shown" — utan den visas interstitials i
          gruppläget men aldrig uppföljande upsell ("slipp annonser i 24h"). */}
      <PremiumUpsellModal />
      <div className="relative min-h-0 flex-1 overflow-hidden pb-1">
        {cards[0] ? (
          <div className="absolute inset-x-1 inset-y-2 isolate mx-auto max-w-[min(100%,420px)] overflow-hidden">
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
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
            <p className="opacity-70">{t("outOfSuggestions")}</p>
            <button
              type="button"
              className="text-cyan-400 underline underline-offset-2"
              onClick={() => {
                // Automatförsöket ovan (en gång per tömning) kan redan ha
                // körts och ändå kommit tomhänt — låt användaren utlösa ett
                // till utan att lämna skärmen.
                autoRetriedRef.current = false;
                notify(t("lookingForMore"));
                void retry();
              }}
            >
              {t("retry")}
            </button>
            <a
              className="text-cyan-400 underline underline-offset-2"
              href={`/group/match?code=${encodeURIComponent(code)}`}
            >
              Visa matchlista
            </a>
          </div>
        )}
      </div>

      <div data-guide="action-dock">
        <ActionDock
          disabled={!cards[0] || showLoading}
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
    </div>
  );
}
