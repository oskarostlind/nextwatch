"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Users, UserPlus, Check, ChevronRight, MessageCircle } from "lucide-react";
import { hydrateSocialInitial, refreshSocial } from "@/lib/socialStore";
import { useSocial } from "@/app/components/client/SocialProvider";
import FriendProfileModal from "./FriendProfileModal";
import FilmChatModal from "@/app/components/client/FilmChatModal";
import Avatar from "@/app/components/ui/Avatar";
import { refreshThreads, useShareThreads } from "@/lib/threadsStore";
import type { FriendsInitial } from "../page";

type SearchRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  is_friend: boolean;
};

async function apiCall<T>(url: string, payload?: unknown): Promise<T | { error: string }> {
  try {
    const res = await fetch(url, {
      method: payload ? "POST" : "GET",
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      cache: "no-store",
    });
    if (!res.ok) throw new Error("API Error");
    return (await res.json()) as T;
  } catch {
    return { error: "Nätverksfel. Försök igen." };
  }
}

const cardClass = "rounded-2xl border border-white/10 bg-white/5 p-4";
const sectionTitleClass = "text-sm font-semibold text-white/70 uppercase tracking-wide";

function displayName(u: { displayName?: string | null; username?: string | null; id?: string }) {
  return u.displayName ?? u.username ?? "Okänd";
}

export default function FriendsTab({ initial }: { initial: FriendsInitial }) {
  // Delad social-store: förladdad vid appstart + hålls färsk av den globala
  // pollern (SocialPreloader i AppShell) — ingen egen fetch/interval här.
  const social = useSocial();
  const { friends, pendingIn, pendingOut } = social;

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [sentToIds, setSentToIds] = useState<Set<string>>(new Set());
  const [openFriendId, setOpenFriendId] = useState<string | null>(null);
  const [chatFriendId, setChatFriendId] = useState<string | null>(null);
  const [friendFilter, setFriendFilter] = useState("");

  // Olästa filmtips + senaste interaktion per vän — delade threads-storen
  // (en poll för hela appen). Stängd chatt → explicit refresh: tråd-GET:en
  // har nollat olästa server-side.
  const { threads } = useShareThreads();
  useEffect(() => {
    if (chatFriendId === null) void refreshThreads();
  }, [chatFriendId]);
  const unseenByFriend: Record<string, number> = {};
  const lastAtByFriend: Record<string, string> = {};
  for (const t of threads) {
    unseenByFriend[t.friendId] = t.unseen;
    lastAtByFriend[t.friendId] = t.lastAt;
  }

  // Senast interagerad först, övriga alfabetiskt; filtret söker i namn/användarnamn.
  const visibleFriends = friends
    .filter((f) => {
      const needle = friendFilter.trim().toLowerCase();
      if (!needle) return true;
      return (
        displayName(f).toLowerCase().includes(needle) ||
        (f.username ?? "").toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => {
      const la = lastAtByFriend[a.id] ?? "";
      const lb = lastAtByFriend[b.id] ?? "";
      if (la !== lb) return lb.localeCompare(la);
      return displayName(a).localeCompare(displayName(b), "sv");
    });

  useEffect(() => {
    // SSR-datan blir första snapshot (ingen flash) om store:n inte hunnit ladda.
    hydrateSocialInitial({
      friends: initial.friends,
      pendingIn: initial.pendingIn,
      pendingOut: initial.pendingOut,
    });
  }, [initial]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      const res = await apiCall<{ ok: boolean; results: SearchRow[] }>(
        `/api/friends/search?q=${encodeURIComponent(query)}`
      );
      if (res && !("error" in res) && res.ok) {
        setSearchResults(res.results);
      }
      setIsSearching(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const sendFriendRequest = async (userId: string) => {
    const res = await apiCall<{ requestId: string }>("/api/friends/request", { toUserId: userId });
    if (!("error" in res)) {
      setSentToIds((prev) => new Set(prev).add(userId));
      void refreshSocial();
    }
  };

  const acceptRequest = async (requestId: string) => {
    const res = await apiCall<{ ok: boolean }>("/api/friends/accept", { requestId });
    if (!("error" in res)) {
      void refreshSocial();
    }
  };

  const declineRequest = async (requestId: string) => {
    const res = await apiCall<{ ok: boolean }>("/api/friends/decline", { requestId });
    if (!("error" in res)) {
      void refreshSocial();
    }
  };

  const hasPending = pendingIn.length > 0 || pendingOut.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className={cardClass} data-guide="friends-search">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-white/40" />
          <input
            className="w-full rounded-xl border border-white/10 bg-black/30 py-3 pl-10 pr-10 text-sm text-white placeholder:text-white/40 outline-none transition focus:border-white/25 focus:ring-2 focus:ring-white/10"
            placeholder="Sök användarnamn för att lägga till vän"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {isSearching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/40">
              Söker…
            </span>
          )}
        </div>
      </div>

      {/* Sökresultat */}
      {searchResults.length > 0 && (
        <div className={cardClass}>
          <h3 className={`mb-3 flex items-center gap-2 ${sectionTitleClass}`}>
            <Search className="h-4 w-4 text-white/50" />
            Sökresultat
          </h3>
          <ul className="flex flex-col gap-2">
            {searchResults.map((user) => {
              const isAlreadyFriend = user.is_friend;
              const isSent =
                sentToIds.has(user.id) || pendingOut.some((p) => p.to.id === user.id);
              const name = user.display_name ?? user.username ?? "Okänd";

              return (
                <li
                  key={user.id}
                  className="flex flex-row items-center justify-between rounded-xl bg-white/5 px-4 py-3"
                >
                  <span className="font-medium text-white/90">{name}</span>
                  {isAlreadyFriend ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-400">
                      <Check className="h-3 w-3" /> Vän
                    </span>
                  ) : isSent ? (
                    <span className="rounded-full border border-white/20 px-3 py-1 text-xs font-medium text-white/50">
                      Skickad
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void sendFriendRequest(user.id)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500 px-4 py-2 text-xs font-bold text-black transition active:scale-[0.98] hover:bg-cyan-400"
                    >
                      <Plus className="h-3.5 w-3.5" /> Lägg till
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Dina vänner */}
      <div className={cardClass}>
        <h3 className={`mb-3 flex items-center gap-2 ${sectionTitleClass}`}>
          <Users className="h-4 w-4 text-white/50" />
          Dina vänner ({friends.length})
        </h3>
        {friends.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] py-8 text-center">
            <Users className="mx-auto mb-2 h-10 w-10 text-white/20" />
            <p className="text-sm text-white/50">Inga vänner än. Sök och lägg till någon ovan.</p>
          </div>
        ) : (
          <>
            {friends.length > 3 && (
              <input
                value={friendFilter}
                onChange={(e) => setFriendFilter(e.target.value)}
                placeholder="Filtrera dina vänner…"
                className="mb-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-500 focus:ring-2 focus:ring-cyan-500/40"
              />
            )}
          <ul className="flex flex-col gap-2">
            {visibleFriends.map((f) => {
              const unseen = unseenByFriend[f.id] ?? 0;
              return (
                <li key={f.id} className="flex items-center gap-2 rounded-xl bg-white/5 px-2 py-1.5 transition hover:bg-white/10">
                  <button
                    type="button"
                    onClick={() => setOpenFriendId(f.id)}
                    className="flex min-w-0 flex-1 items-center justify-between px-2 py-1.5 text-left"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar avatarId={f.avatarId} name={displayName(f)} size={36} />
                      <span className="truncate font-medium text-white/90">{displayName(f)}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />
                  </button>
                  {/* Filmchatten: egen knapp så profilklicket lämnas ifred. */}
                  <button
                    type="button"
                    aria-label={`Filmtips med ${displayName(f)}`}
                    onClick={() => setChatFriendId(f.id)}
                    className="relative shrink-0 rounded-full p-2.5 text-cyan-300/80 transition hover:bg-cyan-500/15 hover:text-cyan-200"
                  >
                    <MessageCircle className="h-5 w-5" />
                    {unseen > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[10px] font-bold text-black">
                        {unseen}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          </>
        )}
      </div>

      <FriendProfileModal
        friendId={openFriendId}
        onClose={() => setOpenFriendId(null)}
        onOpenChat={(id) => {
          setOpenFriendId(null);
          setChatFriendId(id);
        }}
      />

      <FilmChatModal
        friendId={chatFriendId}
        friendName={displayName(friends.find((f) => f.id === chatFriendId) ?? { id: chatFriendId ?? "" })}
        friendAvatarId={friends.find((f) => f.id === chatFriendId)?.avatarId ?? null}
        onClose={() => setChatFriendId(null)}
      />

      {hasPending && (
        <div className={cardClass}>
          <h3 className={`mb-3 flex items-center gap-2 ${sectionTitleClass}`}>
            <UserPlus className="h-4 w-4 text-white/50" />
            Förfrågningar
          </h3>
          <ul className="flex flex-col gap-2">
            {pendingIn.map((r) => (
              <li
                key={r.requestId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/5 px-4 py-3"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar avatarId={r.from.avatarId} name={displayName(r.from)} size={30} />
                  <span className="truncate text-sm font-medium text-white/90">{displayName(r.from)}</span>
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void declineRequest(r.requestId)}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5"
                  >
                    Avvisa
                  </button>
                  <button
                    type="button"
                    onClick={() => void acceptRequest(r.requestId)}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Acceptera
                  </button>
                </div>
              </li>
            ))}
            {pendingOut.map((r) => (
              <li
                key={r.requestId}
                className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar avatarId={r.to.avatarId} name={displayName(r.to)} size={30} />
                  <span className="truncate text-sm font-medium text-white/90">{displayName(r.to)}</span>
                </span>
                <span className="text-xs text-white/40">Väntar…</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}