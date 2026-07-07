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
  fetchWatchUrl,
  SwipeStampOverlays,
  type Card,
} from "../../swipe/page_client";
import ActionDock from "@/app/components/ui/ActionDock";
import { useGroupSwipeDeck } from "@/app/recs/SwipeDeckProvider";
import SwipeLimitWall, { reportSwipeLimitFrom } from "@/app/components/client/SwipeLimitWall";
import { notify } from "@/app/components/lib/notify";
import { hideFor7Days, markSeen, unhide, unmarkSeen } from "@/lib/swipeDeck";

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

export default function GroupSwipePage({ code }: { code: string }) {
  const { deck, popCard, updateCards, unshiftCard } = useGroupSwipeDeck(code);
  const { cards, loading, error, ready } = deck;
  const showLoading = cards.length === 0 && (loading || !ready);

  const undoStackRef = useRef<UndoEntry[]>([]);

  const [flippedId, setFlippedId] = useState<string | null>(null);

  const controls = useAnimation();

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-260, 260], [-16, 16]);
  const likeOpacity = useTransform(x, [48, 150], [0, 1]);
  const nopeOpacity = useTransform(x, [-150, -48], [1, 0]);
  const seenOpacity = useTransform(y, [-150, -48], [1, 0]);

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
                }
              : c
          )
        );
      });
    });
    // "Kolla nu"-länk hämtas parallellt med details (samma mönster som solo).
    toFetch.forEach((t) => {
      void fetchWatchUrl(t.mediaType, t.tmdbId, t.title).then((url) => {
        updateCards((prev) =>
          prev.map((c) => (c.id === t.id && c.watchUrl === undefined ? { ...c, watchUrl: url } : c))
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
  }

  function handleUndo(): void {
    const entry = undoStackRef.current[0];
    if (!entry) {
      notify("Inget att ångra");
      return;
    }
    undoStackRef.current = undoStackRef.current.slice(1);
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
      notify("Kunde inte ångra på servern");
    });
  }

  /* ---------- render (identisk med solo-swipen) ---------- */

  const DIST_THRESHOLD = 110;
  const VELOCITY_THRESHOLD = 700;

  async function swipeOut(dir: "left" | "right" | "up") {
    const c = cards[0];
    if (!c) return;
    const target =
      dir === "right"
        ? { x: 560, opacity: 0 }
        : dir === "left"
        ? { x: -560, opacity: 0 }
        : { y: -760, opacity: 0 };
    await controls.start({ ...target, transition: { duration: 0.22 } });
    if (dir === "right") handleLike(c);
    else if (dir === "left") handleDislike(c);
    else handleSeen(c);
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
        <p className="text-neutral-400">Laddar förslag…</p>
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
                    className="absolute inset-0 z-10 flex touch-none items-center justify-center p-0.5"
                    style={{ x, y, rotate }}
                    animate={controls}
                    drag
                    dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
                    dragElastic={0.8}
                    onDragEnd={(_, info) => {
                      const { offset, velocity } = info;
                      const up =
                        (offset.y < -DIST_THRESHOLD || velocity.y < -VELOCITY_THRESHOLD) &&
                        Math.abs(offset.y) > Math.abs(offset.x);
                      if (up) {
                        void swipeOut("up");
                        return;
                      }
                      if (offset.x > DIST_THRESHOLD || velocity.x > VELOCITY_THRESHOLD) {
                        void swipeOut("right");
                        return;
                      }
                      if (offset.x < -DIST_THRESHOLD || velocity.x < -VELOCITY_THRESHOLD) {
                        void swipeOut("left");
                        return;
                      }
                      void controls.start({
                        x: 0,
                        y: 0,
                        transition: { type: "spring", stiffness: 320, damping: 28 },
                      });
                    }}
                  >
                    <StaticCard
                      card={card}
                      flipped={flippedId === card.id}
                      interactive
                      onFlip={() => setFlippedId((p) => (p === card.id ? null : card.id))}
                    />

                    <SwipeStampOverlays
                      likeOpacity={likeOpacity}
                      nopeOpacity={nopeOpacity}
                      seenOpacity={seenOpacity}
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
                  className="pointer-events-none absolute inset-0 flex items-center justify-center p-0.5 opacity-[0.92]"
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
            <p className="opacity-70">Slut på förslag nu.</p>
            <a
              className="text-cyan-400 underline underline-offset-2"
              href={`/group/match?code=${encodeURIComponent(code)}`}
            >
              Visa matchlista
            </a>
          </div>
        )}
      </div>

      <ActionDock
        disabled={!cards[0] || showLoading}
        onNope={() => void swipeOut("left")}
        onInfo={() => {
          const c = cards[0];
          if (c) setFlippedId((p) => (p === c.id ? null : c.id));
        }}
        onUndo={handleUndo}
        onLike={() => void swipeOut("right")}
      />
    </div>
  );
}
