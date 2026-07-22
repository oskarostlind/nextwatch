"use client";

import { useEffect, useRef, useState } from "react";
import MatchOverlay, { type GroupMatchItem } from "../ui/MatchOverlay";
import RatingModal, { type RatingModalItem } from "./RatingModal";
import { useGroupMatchPolling } from "../../../lib/useGroupMatch";
import { GROUP_VOTED_EVENT } from "../../../lib/groupVoteEvent";

/* ---------- Betygsätt tidigare gruppmatchningar (vid app-öppning) ---------- */

const PENDING_FETCHED_KEY = "nw_pending_ratings_fetched";

type PendingItem = {
  tmdbId: number;
  tmdbType: "movie" | "tv";
  title: string;
  poster: string | null;
  year: number | null;
};

type PendingResp = { ok: true; items: PendingItem[] } | { ok: false; message?: string };

function usePendingMatchRatings(liveMatchOpen: boolean) {
  const [queue, setQueue] = useState<PendingItem[]>([]);
  const [saving, setSaving] = useState(false);

  // Hämta en gång per session (sessionStorage-guard så prompten inte tjatar
  // vid varje navigering).
  useEffect(() => {
    try {
      if (sessionStorage.getItem(PENDING_FETCHED_KEY)) return;
      sessionStorage.setItem(PENDING_FETCHED_KEY, "1");
    } catch {
      return; // privat läge etc. — hoppa över prompten
    }
    void fetch("/api/group/match/pending-ratings", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<PendingResp>) : null))
      .then((data) => {
        if (data && data.ok && data.items.length > 0) {
          setQueue(data.items.filter((it) => it.title));
        }
      })
      .catch(() => {
        /* best-effort */
      });
  }, []);

  const current = queue[0] ?? null;

  function advance() {
    setQueue((q) => q.slice(1));
  }

  function rate(rating: number) {
    if (!current) return;
    setSaving(true);
    void fetch("/api/ratings/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ tmdbId: current.tmdbId, mediaType: current.tmdbType, rating }),
    })
      .catch(() => {
        /* best-effort */
      })
      .finally(() => {
        setSaving(false);
        advance();
      });
  }

  function skip() {
    if (!current) return;
    // "Hoppa över" = fråga aldrig igen om denna titel (RATE_DISMISSED).
    void fetch("/api/ratings/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ tmdbId: current.tmdbId, mediaType: current.tmdbType }),
    }).catch(() => {
      /* best-effort */
    });
    advance();
  }

  // Live-matchen (ny gruppmatch) har prioritet — visa prompten först när den
  // inte är öppen.
  const item: RatingModalItem | null =
    !liveMatchOpen && current
      ? {
          tmdbId: current.tmdbId,
          mediaType: current.tmdbType,
          title: current.title,
          year: current.year !== null ? String(current.year) : null,
          poster: current.poster,
        }
      : null;

  return { item, saving, rate, skip };
}

export default function OverlayMount() {
  const { open, item, dismiss, notifyVoted, groupCode } = useGroupMatchPolling();
  const pending = usePendingMatchRatings(open);

  // Sticky-minne: om vi får ett item när overlayn inte hunnit mounta,
  // behåll det så att vi kan visa direkt när allt är redo.
  const lastItemRef = useRef<GroupMatchItem | null>(null);
  if (open && item) {
    lastItemRef.current = item;
  }
  const shownItem = item ?? lastItemRef.current;

  // Explicit event från röst-flödena (emitGroupVoted i lib/groupVoteEvent).
  // Tidigare monkeypatchades window.fetch globalt för att sniffa vote-POST:ar —
  // en wrapper runt VARJE fetch i hela appen, och skör mot andra patchare.
  useEffect(() => {
    const onVoted = () => notifyVoted();
    window.addEventListener(GROUP_VOTED_EVENT, onVoted);
    return () => window.removeEventListener(GROUP_VOTED_EVENT, onVoted);
  }, [notifyVoted]);

  return (
    <>
      <MatchOverlay open={open} item={shownItem} onClose={dismiss} code={groupCode} />
      <RatingModal
        open={pending.item !== null}
        item={pending.item}
        heading="Ni matchade på denna — såg du den?"
        skipLabel="Såg den inte / hoppa över"
        saving={pending.saving}
        onRate={pending.rate}
        onSkip={pending.skip}
      />
    </>
  );
}
