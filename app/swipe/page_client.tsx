"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion, useAnimation } from "framer-motion";

/* ---------- types ---------- */

type MediaType = "movie" | "tv";

export type Card = {
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year: string | null;
  poster: string | null;
  overview?: string | null;
  rating?: number | null;
};

type UnifiedOk = {
  ok: true;
  mode: "group" | "individual";
  group: { code: string; strictProviders: boolean } | null;
  language: string;
  region: string;
  usedProviderIds: number[];
  items: {
    id: number;
    tmdbType: MediaType;
    title: string;
    year?: string;
    poster_path?: string | null;
    vote_average?: number;
  }[];
};
type UnifiedResp = UnifiedOk | { ok: false; message?: string };

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

/* ---------- Local hide/seen helpers ---------- */

const HIDE_KEY = "nw_disliked_until";
const SEEN_KEY = "nw_seen_ids";

/** Hämta nästa unified-sida när kön har färre kort än detta (aggressiv prefetch). */
const PREFETCH_MIN_CARDS = 10;

function readHideMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(HIDE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as unknown;
    return obj && typeof obj === "object" ? (obj as Record<string, number>) : {};
  } catch {
    return {};
  }
}
function writeHideMap(map: Record<string, number>) {
  localStorage.setItem(HIDE_KEY, JSON.stringify(map));
}
function isHidden(tmdbId: number): boolean {
  const map = readHideMap();
  const until = map[String(tmdbId)];
  return typeof until === "number" && Date.now() < until;
}
function hideFor7Days(tmdbId: number) {
  const map = readHideMap();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  map[String(tmdbId)] = Date.now() + sevenDays;
  writeHideMap(map);
}

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}
function writeSeen(seen: Set<string>) {
  localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen)));
}
function markSeen(id: string) {
  const s = readSeen();
  s.add(id);
  writeSeen(s);
}

/* ---------- Details helpers (fallback sv → en) ---------- */

type DetailsDTO = {
  id: number;
  type?: MediaType;
  title?: string;
  overview?: string | null;
  poster?: string | null;
  poster_path?: string | null;
  year?: number | null;
  releaseYear?: number | null;
  vote_average?: number | null;
  rating?: number | null;
  name?: string;
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
      : typeof o.vote_average === "number"
      ? o.vote_average
      : null;
  const posterPath =
    typeof o.poster === "string"
      ? o.poster
      : typeof o.poster_path === "string"
      ? o.poster_path
      : null;
  const poster = posterPath
    ? posterPath.startsWith("http")
      ? posterPath
      : `https://image.tmdb.org/t/p/w780${posterPath}`
    : null;
  const y =
    typeof o.year === "number"
      ? String(o.year)
      : typeof o.releaseYear === "number"
      ? String(o.releaseYear)
      : null;
  return { overview, rating, poster, title, year: y };
}
async function fetchDetailsWithFallback(type: MediaType, id: number) {
  const p1 = fetch(`/api/tmdb/details?type=${type}&id=${id}`, {
    cache: "force-cache",
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const d1 = await p1;
  let parsed = parseDetails(d1);
  if (parsed && parsed.overview) return parsed;

  const p2 = fetch(`/api/tmdb/details?type=${type}&id=${id}&locale=en-US`, {
    cache: "force-cache",
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const d2 = await p2;
  parsed = parseDetails(d2) ?? parsed;
  return parsed;
}

/* ---------- component ---------- */

export default function SwipePageClient() {
  const [cards, setCards] = useState<Card[]>([]);
  const [page, setPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [flippedId, setFlippedId] = useState<string | null>(null);

  const [mode, setMode] = useState<"group" | "individual">("individual");
  const [group, setGroup] = useState<{ code: string; strictProviders: boolean } | null>(null);

  const controls = useAnimation();
  const loadingRef = useRef(false);

  const loadPage = useCallback(
    async (targetPage: number, replace: boolean) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      try {
        const res = await fetch(`/api/recs/unified?page=${targetPage}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as UnifiedResp;
        if (!("ok" in data) || !data.ok) {
          setHasMore(false);
          return;
        }

        setMode(data.mode);
        setGroup(data.group);

        const mapped: Card[] = data.items
          .map((it): Card | null => {
            const id = `${it.tmdbType}_${it.id}`;
            const poster = it.poster_path
              ? it.poster_path.startsWith("http")
                ? it.poster_path
                : `https://image.tmdb.org/t/p/w780${it.poster_path}`
              : null;
            return {
              id,
              tmdbId: it.id,
              mediaType: it.tmdbType,
              title: it.title,
              year: it.year ?? null,
              poster,
              overview: null,
              rating:
                typeof it.vote_average === "number" ? it.vote_average : null,
            };
          })
          .filter((v): v is Card => Boolean(v))
          .filter((c) => !isHidden(c.tmdbId))
          .filter((c) => !readSeen().has(c.id));

        if (replace) setCards(mapped);
        else setCards((prev) => [...prev, ...mapped]);

        setHasMore(mapped.length > 0);
      } finally {
        loadingRef.current = false;
      }
    },
    []
  );

  useEffect(() => {
    void loadPage(1, true);
  }, [loadPage]);

  useEffect(() => {
    if (!loadingRef.current && cards.length < PREFETCH_MIN_CARDS && hasMore) {
      const next = page + 1;
      setPage(next);
      void loadPage(next, false);
    }
  }, [cards.length, hasMore, page, loadPage]);

  // lazy hydrering av details på topp- och nästa korten i stacken (parallellt)
  const fetched = useRef<Set<string>>(new Set());
  useEffect(() => {
    const cur = cards[0];
    const nxt = cards[1];
    const third = cards[2];
    const toFetch: { id: string; mediaType: MediaType; tmdbId: number }[] = [];
    if (cur && !fetched.current.has(cur.id)) toFetch.push({ id: cur.id, mediaType: cur.mediaType, tmdbId: cur.tmdbId });
    if (nxt && !fetched.current.has(nxt.id)) toFetch.push({ id: nxt.id, mediaType: nxt.mediaType, tmdbId: nxt.tmdbId });
    if (third && !fetched.current.has(third.id))
      toFetch.push({ id: third.id, mediaType: third.mediaType, tmdbId: third.tmdbId });
    if (toFetch.length === 0) return;

    toFetch.forEach((t) => fetched.current.add(t.id));
    Promise.all(
      toFetch.map((t) => fetchDetailsWithFallback(t.mediaType, t.tmdbId).then((det) => ({ id: t.id, det })))
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

  function handleDislike(c: Card): void {
    markSeen(c.id);
    hideFor7Days(c.tmdbId);
    popTop();
    sendGroupVoteBackground(c, "DISLIKE");
  }

  function handleLike(c: Card): void {
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
    sendGroupVoteBackground(c, "LIKE");
  }

  function onInfo(c: Card) {
    setFlippedId((prev) => (prev === c.id ? null : c.id));
  }

  /* ---------- render ---------- */

  const DIST_THRESHOLD = 110;
  const VELOCITY_THRESHOLD = 700;

  const stackIndices: number[] = [];
  if (cards.length > 0) {
    for (let i = Math.min(2, cards.length - 1); i >= 0; i--) stackIndices.push(i);
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {mode === "group" && group?.code && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2 rounded-full border border-emerald-500/40 bg-emerald-600/15 px-3 py-1 text-xs font-medium text-emerald-200 backdrop-blur">
          Swiping as: <span className="font-mono tracking-wider">{group.code}</span>
        </div>
      )}

      {/* Kort-yta: flex-1 + min-h-0 + overflow-hidden => flexbox styr höjden och kortet kan aldrig växa förbi ytan och klippas bakom ikon-raden. */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2 pt-2">
      {cards[0] ? (
          <div
            className="relative isolate mx-auto h-full max-h-full w-full min-h-0 max-w-[360px] overflow-hidden"
          >
          {stackIndices.map((idx) => {
            const card = cards[idx];
            if (!card) return null;
            const isTop = idx === 0;
            if (isTop) {
              return (
                <motion.div
                  key={card.id}
                  className="absolute inset-0 z-10 flex items-center justify-center p-0.5"
                  animate={controls}
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.18}
                  onDragEnd={(_, info) => {
                    const { x } = info.offset;
                    const v = info.velocity.x;
                    if (x > DIST_THRESHOLD || v > VELOCITY_THRESHOLD) {
                      const c = cards[0];
                      if (!c) return;
                      void controls
                        .start({ x: 520, rotate: 18, opacity: 0, transition: { duration: 0.22 } })
                        .then(() => {
                          handleLike(c);
                          void controls.start({ x: 0, rotate: 0, opacity: 1 });
                        });
                      return;
                    }
                    if (x < -DIST_THRESHOLD || v < -VELOCITY_THRESHOLD) {
                      const c = cards[0];
                      if (!c) return;
                      void controls
                        .start({ x: -520, rotate: -18, opacity: 0, transition: { duration: 0.22 } })
                        .then(() => {
                          handleDislike(c);
                          void controls.start({ x: 0, rotate: 0, opacity: 1 });
                        });
                      return;
                    }
                    void controls.start({
                      x: 0,
                      rotate: 0,
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
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center opacity-70">
          Slut på förslag nu.
        </div>
      )}
      </div>

      {/* Action buttons: endast luft mot kort — bottenutfyllnad sköts av AppShell main (tabs + safe area). pb-0 så ikonerna ligger tajt ovanför BottomTabs. */}
      <div className="pointer-events-auto relative z-20 flex shrink-0 items-center justify-center gap-7 px-2 pb-0 pt-2">
        <button
          aria-label="Nej"
          onClick={() =>
            cards[0] &&
            (async () => {
              const c = cards[0];
              await controls.start({ x: -520, rotate: -18, opacity: 0, transition: { duration: 0.22 } });
              handleDislike(c);
              await controls.start({ x: 0, rotate: 0, opacity: 1 });
            })()
          }
          className="h-16 w-16 rounded-full bg-rose-500/15 text-rose-300 ring-2 ring-rose-400/40 backdrop-blur-md shadow-[0_10px_30px_rgba(244,63,94,0.25)] transition hover:bg-rose-500/25"
          title="Nej"
        >
          <span className="text-2xl">✖</span>
        </button>

        <button
          aria-label="Info"
          onClick={() => cards[0] && onInfo(cards[0])}
          className="h-14 w-14 rounded-full bg-white/10 text-white ring-1 ring-white/30 backdrop-blur-md shadow-[0_10px_30px_rgba(255,255,255,0.15)] transition hover:bg-white/20"
          title="Info"
        >
          <span className="text-xl">i</span>
        </button>

        <button
          aria-label="Gilla"
          onClick={() =>
            cards[0] &&
            (async () => {
              const c = cards[0];
              await controls.start({ x: 520, rotate: 18, opacity: 0, transition: { duration: 0.22 } });
              handleLike(c);
              await controls.start({ x: 0, rotate: 0, opacity: 1 });
            })()
          }
          className="h-16 w-16 rounded-full bg-emerald-500/15 text-emerald-300 ring-2 ring-emerald-400/40 backdrop-blur-md shadow-[0_10px_30px_rgba(16,185,129,0.25)] transition hover:bg-emerald-500/25"
          title="Gilla"
        >
          <span className="text-2xl">❤</span>
        </button>

        {/* ✓-knappen behåller vi – markerar kortet som sett och döljer likt dislike */}
        <button
          aria-label="Sett redan"
          onClick={() =>
            cards[0] &&
            (async () => {
              const c = cards[0];
              await controls.start({ x: 520, rotate: 0, opacity: 0, transition: { duration: 0.18 } });
              markSeen(c.id);
              hideFor7Days(c.tmdbId);
              popTop();
              sendGroupVoteBackground(c, "DISLIKE");
              await controls.start({ x: 0, rotate: 0, opacity: 1 });
            })()
          }
          className="h-14 w-14 rounded-full bg-sky-500/15 text-sky-200 ring-2 ring-sky-400/40 backdrop-blur-md shadow-[0_10px_30px_rgba(14,165,233,0.25)] transition hover:bg-sky-500/25"
          title="Sett redan"
        >
          <span className="text-xl">✓</span>
        </button>
      </div>
    </div>
  );
}

/* ---------- Card components (oförändrat utseende) ---------- */

function StaticCard({
  card,
  flipped,
  onFlip,
  interactive = true,
}: {
  card: Card;
  flipped: boolean;
  interactive?: boolean;
  onFlip: () => void;
}) {
  return (
    <div
      className={`relative h-full max-h-full w-full min-h-0 [perspective:1000px] ${interactive ? "cursor-pointer" : "cursor-default"}`}
      onClick={interactive ? onFlip : undefined}
    >
      <div
        className="relative h-full max-h-full w-full min-h-0 rounded-2xl border border-white/15 bg-black shadow-xl transition-transform duration-300 [transform-style:preserve-3d]"
        style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
      >
        <div className="absolute inset-0 [backface-visibility:hidden]">
          <Front card={card} />
        </div>
        <div className="absolute inset-0 rotate-y-180 [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <Back card={card} />
        </div>
      </div>
    </div>
  );
}

function Front({ card }: { card: Card }) {
  return (
    <div className="relative h-full w-full min-h-0 overflow-hidden rounded-2xl">
      {card.poster ? (
        <div className="relative h-full w-full min-h-0">
          <Image
            src={card.poster}
            alt={card.title}
            fill
            sizes="(max-width: 768px) 100vw, 600px"
            className="object-contain object-center"
            priority={false}
          />
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-neutral-800">{card.title}</div>
      )}

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

function Back({ card }: { card: Card }) {
  return (
    <div className="flex h-full w-full flex-col gap-2 rounded-2xl bg-neutral-950 p-4">
      <div className="text-base font-semibold">
        {card.title} {card.year ? <span className="opacity-70">({card.year})</span> : null}
      </div>
      {typeof card.rating === "number" ? (
        <div className="text-sm text-emerald-300">Betyg: ★ {card.rating.toFixed(1)} / 10</div>
      ) : null}
      <div className="mt-2 max-h-[75%] overflow-auto text-sm leading-relaxed opacity-90">
        {card.overview || "Ingen beskrivning tillgänglig."}
      </div>
    </div>
  );
}
