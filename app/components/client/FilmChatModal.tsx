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
import WatchNowButton from "@/app/components/watch/WatchNowButton";
import { useSwipeSettings } from "@/app/components/client/SwipeSettingsProvider";
import { useLocale, useTranslations } from "next-intl";
import { bcp47 } from "@/lib/i18nConfig";
import {
  bestWatchUrl,
  isPaidOnly,
  providerGroupsFor,
  type WatchProviders,
} from "@/lib/watchLinks";

type Reaction = "seen" | "want" | "skip";

// Etiketten översätts vid rendering (filmChat.reaction.<key>) — bara emojin
// bor här, eftersom reaktionen skickas till servern som id.
const REACTION_META: Record<Reaction, { emoji: string }> = {
  seen: { emoji: "👀" },
  want: { emoji: "🍿" },
  skip: { emoji: "🙅" },
};

type ThreadItem = {
  id: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year: string | null;
  poster: string | null;
  fromMe: boolean;
  createdAt: string;
  /** Satt på mina bubblor när motparten öppnat tråden → "Läst". */
  seenAt: string | null;
  reaction: Reaction | null;
};

type ThreadResp = { ok?: boolean; items?: ThreadItem[] };

type SearchHit = { id: number; title: string; year: string; poster: string | null };

const POLL_MS = 8000;

function timeLabel(iso: string, locale: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hm = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return sameDay ? hm : `${d.toLocaleDateString(locale, { day: "numeric", month: "short" })} ${hm}`;
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
  const t = useTranslations("filmChat");
  const locale = useLocale();
  const tw = useTranslations("watch");
  const [items, setItems] = useState<ThreadItem[] | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [q, setQ] = useState("");
  const [searchType, setSearchType] = useState<"movie" | "tv">("movie");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  // Klickat kort → fullt filmkort (beskrivning + tjänster hämtas vid öppning).
  const [detailItem, setDetailItem] = useState<ThreadItem | null>(null);
  const [detailOverview, setDetailOverview] = useState<string | null>(null);
  const [detailProviders, setDetailProviders] = useState<WatchProviders | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const { showPaidOptions } = useSwipeSettings();

  useEffect(() => {
    if (!detailItem) {
      setDetailOverview(null);
      setDetailProviders(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    void Promise.all([
      fetch(`/api/watchlist/detail?id=${detailItem.tmdbId}&type=${detailItem.mediaType}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(`/api/tmdb/watch-providers?id=${detailItem.tmdbId}&type=${detailItem.mediaType}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([d, p]: [{ overview?: string } | null, { ok?: boolean; providers?: WatchProviders | null } | null]) => {
        if (!active) return;
        setDetailOverview(d?.overview ?? null);
        setDetailProviders(p?.ok ? p.providers ?? null : null);
      })
      .finally(() => active && setDetailLoading(false));
    return () => {
      active = false;
    };
  }, [detailItem]);

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
      seenAt: null,
      reaction: null,
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

  async function react(item: ThreadItem, reaction: Reaction) {
    // Klick på aktiv reaktion tar bort den. Optimistiskt — chatten ska kännas direkt.
    const next = item.reaction === reaction ? null : reaction;
    setItems((cur) => (cur ?? []).map((x) => (x.id === item.id ? { ...x, reaction: next } : x)));
    await fetch("/api/share/react", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ id: item.id, reaction: next }),
    }).catch(() => {});
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
          {/* Inget eget stängkryss här — ui/Modal renderar redan ett uppe till
              höger, och två kryss ovanpå varandra såg ut som en bugg. */}
          <div className="min-w-0 flex-1 pr-8">
            <h3 id="filmchat-heading" className="truncate text-base font-bold text-white">
              {friendName}
            </h3>
            <p className="text-xs text-white/40">Filmtips fram och tillbaka</p>
          </div>
        </div>

        {/* Tråden */}
        <div className="min-h-0 flex-1 overflow-y-auto py-3">
          {items === null ? (
            <p className="py-10 text-center text-sm text-white/50">Laddar…</p>
          ) : items.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-white/50">
              {t.rich("noTips", {
                plus: () => <Plus className="inline h-3.5 w-3.5" />,
              })}
            </p>
          ) : (
            <div className="grid gap-2 px-1">
              {items.map((it) => (
                <div key={it.id} className={`flex ${it.fromMe ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`w-[85%] max-w-[340px] rounded-2xl border px-3 py-2.5 ${
                      it.fromMe
                        ? "rounded-br-md border-cyan-400/25 bg-cyan-400/10"
                        : "rounded-bl-md border-white/10 bg-white/5"
                    }`}
                  >
                    {/* Kortet är klickbart → fullt filmkort (beskrivning, tjänster) */}
                    <button
                      type="button"
                      onClick={() => setDetailItem(it)}
                      className="flex w-full items-center gap-3 text-left"
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
                        <div className="mt-0.5 text-[11px] text-white/35">
                          {timeLabel(it.createdAt, bcp47(locale))}
                          {it.fromMe && !it.id.startsWith("optimistic_") && (
                            <span className="ml-1.5 text-cyan-300/70">
                              {it.seenAt ? t("read") : t("sent")}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>

                    {/* Min bubbla: motpartens reaktion. Vännens bubbla: reagera + lägg till. */}
                    {it.fromMe ? (
                      it.reaction && (
                        <div className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/70">
                          {REACTION_META[it.reaction].emoji} {t(`reaction.${it.reaction}`)}
                        </div>
                      )
                    ) : (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {(Object.keys(REACTION_META) as Reaction[]).map((r) => (
                          <button
                            key={r}
                            type="button"
                            title={t(`reaction.${r}`)}
                            aria-pressed={it.reaction === r}
                            onClick={() => void react(it, r)}
                            className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                              it.reaction === r
                                ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-200"
                                : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                            }`}
                          >
                            {REACTION_META[r].emoji}
                            {it.reaction === r ? ` ${t(`reaction.${r}`)}` : ""}
                          </button>
                        ))}
                        <button
                          type="button"
                          disabled={addedIds.has(it.id)}
                          onClick={() => void addToWatchlist(it)}
                          className={`ml-auto rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                            addedIds.has(it.id)
                              ? "bg-emerald-600/20 text-emerald-300"
                              : "bg-cyan-500 text-black hover:bg-cyan-400"
                          }`}
                        >
                          {addedIds.has(it.id) ? t("added") : t("add")}
                        </button>
                      </div>
                    )}
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
                  aria-label={t("closeSearch")}
                  className="ml-auto rounded-full p-2 text-white/50 transition hover:bg-white/10"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={searchType === "movie" ? t("searchMovie") : t("searchTv")}
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
              {t("shareATitle")}
            </button>
          )}
        </div>
      </div>

      {/* Fullt filmkort för klickad bubbla — som i /watchlist-modalen. */}
      <Modal open={detailItem !== null} onClose={() => setDetailItem(null)} labelledBy="filmchat-detail-heading">
        {detailItem && (
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="relative mx-auto h-[280px] w-[190px] shrink-0 overflow-hidden rounded-2xl md:mx-0">
              {detailItem.poster ? (
                <Image src={detailItem.poster} alt={detailItem.title} fill sizes="190px" className="object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-neutral-800 p-3 text-center text-sm text-neutral-400">
                  {detailItem.title}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h4 id="filmchat-detail-heading" className="text-xl font-bold text-white">
                {detailItem.title}
                {detailItem.year ? ` (${detailItem.year})` : ""}
              </h4>
              <p className="mt-3 text-sm leading-relaxed text-neutral-200">
                {detailLoading ? t("loadingInfo") : detailOverview || t("noDescription")}
              </p>

              {!detailLoading && (
                <div className="mt-4">
                  {providerGroupsFor(detailProviders, showPaidOptions).length === 0 ? (
                    <p className="text-sm text-neutral-400">
                      {isPaidOnly(detailProviders, showPaidOptions)
                        ? tw("paidOnly")
                        : t("noStreamingData")}
                    </p>
                  ) : (
                    providerGroupsFor(detailProviders, showPaidOptions).map(({ labelKey, list }) => (
                      <div key={labelKey} className="mb-2">
                        <p className="mb-1 text-xs uppercase tracking-widest text-cyan-400/80">{tw(`group.${labelKey}`)}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {list.map((p) => (
                            <span
                              key={p.provider_name}
                              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-neutral-200"
                            >
                              {p.provider_name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <WatchNowButton url={bestWatchUrl(detailProviders, detailItem.title, showPaidOptions)} />
                {!detailItem.fromMe && !addedIds.has(detailItem.id) && (
                  <button
                    type="button"
                    onClick={() => {
                      void addToWatchlist(detailItem);
                      setDetailItem(null);
                    }}
                    className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-cyan-400"
                  >
                    {t("addToWatchlist")}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </Modal>
  );
}
