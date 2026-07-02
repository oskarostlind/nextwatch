"use client";

// Grupp-swipe med exakt samma kortlek-UI som solo-swipen (app/swipe/page_client.tsx):
// framer-motion-drag, like/nope/sett-overlays, tap = info-flip, hint-rad istället
// för fysiska knappar. Skillnaden mot solo är bara dataflödet: feed från
// /api/recs/group och röster till /api/group/vote (+ /api/rate, watchlist på like).

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useAnimation, useMotionValue, useTransform } from "framer-motion";
import {
  StaticCard,
  fetchDetailsWithFallback,
  type Card,
} from "../../swipe/page_client";

type MediaType = "movie" | "tv";

type RecItem = {
  type: "rec";
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  matchedProviders: string[];
  unknown: boolean;
};
type FeedItem = RecItem | { type: "ad" };

type FeedResp = { ok: true; feed: FeedItem[] } | { ok: false; error?: string };

type MatchResp =
  | { ok: true; match: { tmdbId: number; tmdbType: MediaType } | null }
  | { ok: false };

function isRec(x: FeedItem): x is RecItem {
  return x.type === "rec";
}

export default function GroupSwipePage({ code }: { code: string }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [flippedId, setFlippedId] = useState<string | null>(null);

  const controls = useAnimation();

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-260, 260], [-16, 16]);
  const likeOpacity = useTransform(x, [48, 150], [0, 1]);
  const nopeOpacity = useTransform(x, [-150, -48], [1, 0]);
  const seenOpacity = useTransform(y, [-150, -48], [1, 0]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!code) return;
      setLoading(true);
      try {
        const r = await fetch(`/api/recs/group?code=${encodeURIComponent(code)}`, {
          cache: "no-store",
        });
        const j = (await r.json()) as FeedResp;
        if (ignore) return;
        if (j.ok) {
          const mapped: Card[] = j.feed.filter(isRec).map((it) => ({
            id: `${it.mediaType}_${it.tmdbId}`,
            tmdbId: it.tmdbId,
            mediaType: it.mediaType,
            title: it.title,
            year: null,
            poster: null,
            overview: null,
            rating: null,
          }));
          setCards(mapped);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [code]);

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
        setCards((prev) =>
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
  }, [cards]);

  function popTop() {
    setFlippedId(null);
    setCards((prev) => prev.slice(1));
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
          if (!res.ok) return null;
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

  function handleDislike(c: Card): void {
    popTop();
    sendVote(c, "DISLIKE");
  }

  function handleLike(c: Card): void {
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
    popTop();
    sendVote(c, "DISLIKE");
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

  if (loading) {
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
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {cards[0] ? (
          <div className="absolute inset-x-2 inset-y-2 isolate mx-auto max-w-[360px] overflow-hidden">
            {stackIndices.map((idx) => {
              const card = cards[idx];
              if (!card) return null;
              const isTop = idx === 0;
              if (isTop) {
                return (
                  <motion.div
                    key={card.id}
                    className="absolute inset-0 z-10 flex items-center justify-center p-0.5"
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

                    <motion.div
                      style={{ opacity: likeOpacity }}
                      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
                    >
                      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500/25 text-5xl text-emerald-300 ring-4 ring-emerald-400 backdrop-blur-sm">
                        ❤
                      </div>
                    </motion.div>
                    <motion.div
                      style={{ opacity: nopeOpacity }}
                      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
                    >
                      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-rose-500/25 text-5xl text-rose-300 ring-4 ring-rose-400 backdrop-blur-sm">
                        ✖
                      </div>
                    </motion.div>
                    <motion.div
                      style={{ opacity: seenOpacity }}
                      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
                    >
                      <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-sky-500/25 text-4xl text-sky-300 ring-4 ring-sky-400 backdrop-blur-sm">
                        ✓
                      </div>
                    </motion.div>
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

      <div className="pointer-events-none flex shrink-0 items-center justify-center gap-4 px-2 pb-1 pt-1.5 text-[11px] text-neutral-500">
        <span className="text-rose-400/80">← Nej</span>
        <span className="text-sky-400/80">↑ Sett</span>
        <span className="text-emerald-400/80">Gilla →</span>
      </div>
    </div>
  );
}
