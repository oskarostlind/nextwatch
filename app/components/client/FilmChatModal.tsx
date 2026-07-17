"use client";

// Filmchatten: tråden med EN vän där titelkorten är meddelandena — vännens
// tips som bubblor till vänster, mina till höger. Ingen fritext (avsiktligt
// scope, se lib/…/share): kortet ÄR meddelandet. "+"-knappen öppnar titelsök
// så nästa tips skickas direkt ur tråden.
//
// Läskvittot sker server-side i GET /api/share/thread — att öppna tråden är
// kvittot, som i en chatt. Pollar var 8:e sekund medan modalen är öppen
// (samma rytm som socialStore).

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Plus, Send, X } from "lucide-react";
import Modal from "@/app/components/ui/Modal";
import Avatar from "@/app/components/ui/Avatar";
import { SegmentedTabs } from "@/app/components/ui/kit";

type ThreadItem = {
  id: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year: string | null;
  poster: string | null;
  fromMe: boolean;
  createdAt: string;
};

type ThreadResp = { ok?: boolean; items?: ThreadItem[] };

type SearchHit = { id: number; title: string; year: string; poster: string | null };

const POLL_MS = 8000;

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hm = d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? hm : `${d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" })} ${hm}`;
}

export default function FilmChatModal({
  friendId,
  friendName,
  friendAvatarId,
  onClose,
  onWatchlistAdd,
}: {
  friendId: string | null;
  friendName: string;
  friendAvatarId?: string | null;
  onClose: () => void;
  /** Anropas när ett tips lagts i watchlisten — låter t.ex. /watchlist refetcha. */
  onWatchlistAdd?: () => void;
}) {
  const [items, setItems] = useState<ThreadItem[] | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [q, setQ] = useState("");
  const [searchType, setSearchType] = useState<"movie" | "tv">("movie");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (!friendId) return;
    void fetch(`/api/share/thread?friendId=${encodeURIComponent(friendId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ThreadResp>) : null))
      .then((j) => {
        if (j?.ok && Array.isArray(j.items)) {
          const server = j.items;
          setItems((cur) => {
            // Behåll optimistiska bubblor tills servern bekräftat samma titel.
            const pending = (cur ?? []).filter(
              (x) =>
                x.id.startsWith("optimistic_") &&
                !server.some((s) => s.fromMe && s.tmdbId === x.tmdbId && s.mediaType === x.mediaType),
            );
            return [...server, ...pending];
          });
        }
      })
      .catch(() => {});
  }, [friendId]);

  // Ladda + polla medan öppen; nollställ vid stängning.
  useEffect(() => {
    if (!friendId) {
      setItems(null);
      setComposerOpen(false);
      setQ("");
      setHits([]);
      return;
    }
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [friendId, load]);

  // Autoscrolla till senaste när tråden växer.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [items?.length]);

  // Titelsök (debounced).
  useEffect(() => {
    const query = q.trim();
    if (!composerOpen || query.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      void fetch(`/api/tmdb/search?type=${searchType}&q=${encodeURIComponent(query)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { ok?: boolean; results?: SearchHit[] } | null) => {
          if (j?.ok && Array.isArray(j.results)) setHits(j.results);
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [q, searchType, composerOpen]);

  async function sendHit(hit: SearchHit) {
    if (!friendId) return;
    setSendingId(hit.id);
    const optimistic: ThreadItem = {
      id: `optimistic_${hit.id}_${searchType}`,
      tmdbId: hit.id,
      mediaType: searchType,
      title: hit.title,
      year: hit.year || null,
      poster: hit.poster,
      fromMe: true,
      createdAt: new Date().toISOString(),
    };
    setItems((cur) => [...(cur ?? []), optimistic]);
    setComposerOpen(false);
    setQ("");
    setHits([]);
    try {
      await fetch("/api/share/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          toUserId: friendId,
          tmdbId: hit.id,
          mediaType: searchType,
          title: hit.title,
          year: hit.year || null,
          poster: hit.poster,
        }),
      });
      load();
    } finally {
      setSendingId(null);
    }
  }

  async function addToWatchlist(item: ThreadItem) {
    const res = await fetch("/api/watchlist/like", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        title: item.title,
        year: item.year,
        poster: item.poster,
      }),
    });
    if (res.ok) {
      setAddedIds((cur) => new Set(cur).add(item.id));
      onWatchlistAdd?.();
    }
  }

  return (
    <Modal open={friendId !== null} onClose={onClose} labelledBy="filmchat-heading">
      <div className="flex h-[78dvh] flex-col p-1">
        {/* Topprad */}
        <div className="flex items-center gap-3 border-b border-white/10 pb-3">
          <Avatar avatarId={friendAvatarId} name={friendName} size={38} />
          <div className="min-w-0 flex-1">
            <h3 id="filmchat-heading" className="truncate text-base font-bold text-white">
              {friendName}
            </h3>
            <p className="text-xs text-white/40">Filmtips fram och tillbaka</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stäng"
            className="rounded-full p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tråden */}
        <div className="min-h-0 flex-1 overflow-y-auto py-3">
          {items === null ? (
            <p className="py-10 text-center text-sm text-white/50">Laddar…</p>
          ) : items.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-white/50">
              Inga tips än — skicka det första med <Plus className="inline h-3.5 w-3.5" />-knappen nedan.
            </p>
          ) : (
            <div className="grid gap-2 px-1">
              {items.map((it) => (
                <div key={it.id} className={`flex ${it.fromMe ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`flex w-[85%] max-w-[340px] items-center gap-3 rounded-2xl border px-3 py-2.5 ${
                      it.fromMe
                        ? "rounded-br-md border-cyan-400/25 bg-cyan-400/10"
                        : "rounded-bl-md border-white/10 bg-white/5"
                    }`}
                  >
                    {it.poster ? (
                      <Image
                        src={it.poster}
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
                        {it.title}
                        {it.year ? <span className="text-white/40"> ({it.year})</span> : null}
                      </div>
                      <div className="mt-0.5 text-[11px] text-white/35">{timeLabel(it.createdAt)}</div>
                      {!it.fromMe && (
                        <button
                          type="button"
                          disabled={addedIds.has(it.id)}
                          onClick={() => void addToWatchlist(it)}
                          className={`mt-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                            addedIds.has(it.id)
                              ? "bg-emerald-600/20 text-emerald-300"
                              : "bg-cyan-500 text-black hover:bg-cyan-400"
                          }`}
                        >
                          {addedIds.has(it.id) ? "I din watchlist ✓" : "Lägg till"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Composer: "+" → titelsök → klick skickar */}
        <div className="border-t border-white/10 pt-3">
          {composerOpen ? (
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <SegmentedTabs
                  layoutId="filmchat-type"
                  tabs={[
                    { id: "movie" as const, label: "Film" },
                    { id: "tv" as const, label: "Serie" },
                  ]}
                  value={searchType}
                  onChange={setSearchType}
                />
                <button
                  type="button"
                  onClick={() => {
                    setComposerOpen(false);
                    setQ("");
                    setHits([]);
                  }}
                  aria-label="Stäng sök"
                  className="ml-auto rounded-full p-2 text-white/50 transition hover:bg-white/10"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={searchType === "movie" ? "Sök film att tipsa om…" : "Sök serie att tipsa om…"}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-500 focus:ring-2 focus:ring-cyan-500/40"
              />
              {hits.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-neutral-950">
                  {hits.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      disabled={sendingId === h.id}
                      onClick={() => void sendHit(h)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-white/5 disabled:opacity-60"
                    >
                      {h.poster ? (
                        <Image src={h.poster} alt="" width={28} height={42} className="h-[42px] w-7 shrink-0 rounded object-cover" />
                      ) : (
                        <div className="h-[42px] w-7 shrink-0 rounded bg-neutral-800" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm text-white/85">
                        {h.title}
                        {h.year ? <span className="text-white/40"> ({h.year})</span> : null}
                      </span>
                      <Send className="h-4 w-4 shrink-0 text-cyan-300" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setComposerOpen(true)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 py-2.5 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
            >
              <Plus className="h-4 w-4" />
              Tipsa om en titel
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
