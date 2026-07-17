"use client";

// Inbox för filmtips från vänner — visas överst i /watchlist (dit tipsen
// naturligt leder). Hämtar vid mount, kvitterar oläst via /api/share/ack när
// listan faktiskt visats, och döljer sig helt när den är tom.

import { useEffect, useState } from "react";
import Image from "next/image";
import Avatar from "@/app/components/ui/Avatar";

type TipFrom = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarId: string | null;
};

type Tip = {
  id: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year: string | null;
  poster: string | null;
  seen: boolean;
  createdAt: string;
  from: TipFrom;
};

type ListResp = { ok?: boolean; unseen?: number; items?: Tip[] };

export default function SharedTipsInbox({ onAdded }: { onAdded?: () => void }) {
  const [tips, setTips] = useState<Tip[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/share/list", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ListResp>) : null))
      .then((j) => {
        if (!active || !j?.ok) return;
        setTips(j.items ?? []);
        if ((j.unseen ?? 0) > 0) {
          void fetch("/api/share/ack", { method: "POST", cache: "no-store" }).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!tips || tips.length === 0) return null;

  const senderName = (f: TipFrom) => f.displayName ?? f.username ?? "En vän";

  async function addToWatchlist(tip: Tip) {
    setBusyId(tip.id);
    try {
      const res = await fetch("/api/watchlist/like", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          tmdbId: tip.tmdbId,
          mediaType: tip.mediaType,
          title: tip.title,
          year: tip.year,
          poster: tip.poster,
        }),
      });
      if (res.ok) {
        await remove(tip, false);
        onAdded?.();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function remove(tip: Tip, setBusy = true) {
    if (setBusy) setBusyId(tip.id);
    try {
      // Optimistiskt — raden är borta för ögat direkt; API:t är en tyst no-op
      // om något hann ändras.
      setTips((cur) => (cur ?? []).filter((t) => t.id !== tip.id));
      await fetch("/api/share/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ id: tip.id }),
      });
    } finally {
      if (setBusy) setBusyId(null);
    }
  }

  return (
    <section className="mb-5">
      <h3 className="mb-2 text-sm font-semibold text-white/80">
        Tips från vänner{" "}
        <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-xs font-bold text-cyan-300">
          {tips.length}
        </span>
      </h3>
      <div className="grid gap-2">
        {tips.map((tip) => (
          <div
            key={tip.id}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
              tip.seen ? "border-white/5 bg-white/[0.03]" : "border-cyan-400/25 bg-cyan-400/5"
            }`}
          >
            {tip.poster ? (
              <Image
                src={tip.poster}
                alt=""
                width={40}
                height={60}
                className="h-[60px] w-10 shrink-0 rounded-md object-cover"
              />
            ) : (
              <div className="h-[60px] w-10 shrink-0 rounded-md bg-neutral-800" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-white/90">
                {tip.title}
                {tip.year ? <span className="text-white/40"> ({tip.year})</span> : null}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-white/45">
                <Avatar avatarId={tip.from.avatarId} name={senderName(tip.from)} size={16} className="rounded-md" />
                <span className="truncate">{senderName(tip.from)} tipsade dig</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={busyId === tip.id}
                onClick={() => void addToWatchlist(tip)}
                className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-cyan-400 disabled:opacity-60"
              >
                Lägg till
              </button>
              <button
                type="button"
                disabled={busyId === tip.id}
                onClick={() => void remove(tip)}
                aria-label="Ta bort tipset"
                className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-white/60 transition hover:bg-white/5"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
