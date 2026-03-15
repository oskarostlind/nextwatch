"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Users, UserPlus, Send, Check, X } from "lucide-react";

type FriendsListUser = {
  id: string;
  username: string | null;
  displayName: string | null;
};

type FriendRowData = {
  id?: string;
  userId?: string;
  username?: string | null;
  displayName?: string | null;
  other?: {
    id?: string;
    userId?: string;
    username?: string | null;
    displayName?: string | null;
  };
};

type FriendsListApiResponse = {
  ok?: boolean;
  friends?: FriendRowData[];
  pendingIn?: { requestId: string; from: FriendsListUser }[];
  pendingOut?: { requestId: string; to: FriendsListUser }[];
};

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

export default function FriendsTab() {
  const [friends, setFriends] = useState<FriendsListUser[]>([]);
  const [pendingIn, setPendingIn] = useState<{ requestId: string; from: FriendsListUser }[]>([]);
  const [pendingOut, setPendingOut] = useState<{ requestId: string; to: FriendsListUser }[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [sentToIds, setSentToIds] = useState<Set<string>>(new Set());

  const loadFriends = async () => {
    const res = await fetch("/api/friends/list", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as FriendsListApiResponse;

    if (data && data.ok) {
      setFriends(
        (data.friends || []).map((row) => {
          const u = row.other || row;
          return {
            id: String(u.id ?? u.userId ?? ""),
            username: u.username ?? null,
            displayName: u.displayName ?? null,
          };
        })
      );
      setPendingIn(data.pendingIn || []);
      setPendingOut(data.pendingOut || []);
    }
  };

  useEffect(() => {
    void loadFriends();
  }, []);

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
      void loadFriends();
    }
  };

  const acceptRequest = async (requestId: string) => {
    const res = await apiCall<{ ok: boolean }>("/api/friends/accept", { requestId });
    if (!("error" in res)) {
      void loadFriends();
    }
  };

  const declineRequest = async (requestId: string) => {
    const res = await apiCall<{ ok: boolean }>("/api/friends/decline", { requestId });
    if (!("error" in res)) {
      void loadFriends();
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2">
      {/* Sök – enhetlig med GroupTab */}
      <div className={cardClass}>
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
                      className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-black transition active:scale-[0.98] hover:bg-white/90"
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
          <ul className="flex flex-col gap-2">
            {friends.map((f) => (
              <li
                key={f.id}
                className="flex flex-row items-center rounded-xl bg-white/5 px-4 py-3"
              >
                <span className="font-medium text-white/90">{displayName(f)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Inkommande */}
      <div className={cardClass}>
        <h3 className={`mb-3 flex items-center gap-2 ${sectionTitleClass}`}>
          <UserPlus className="h-4 w-4 text-white/50" />
          Inkommande ({pendingIn.length})
        </h3>
        {pendingIn.length === 0 ? (
          <p className="rounded-xl bg-white/[0.02] py-4 text-center text-sm text-white/50">
            Inga nya förfrågningar
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pendingIn.map((r) => (
              <li
                key={r.requestId}
                className="flex flex-row flex-wrap items-center justify-between gap-3 rounded-xl bg-white/5 px-4 py-3"
              >
                <span className="font-medium text-white/90">{displayName(r.from)}</span>
                <div className="flex flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => void declineRequest(r.requestId)}
                    className="inline-flex items-center gap-1 rounded-full border border-white/20 px-3 py-2 text-xs font-medium text-white/70 transition active:scale-[0.98] hover:bg-white/10"
                  >
                    <X className="h-3.5 w-3.5" /> Avvisa
                  </button>
                  <button
                    type="button"
                    onClick={() => void acceptRequest(r.requestId)}
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-500/25 px-3 py-2 text-xs font-bold text-emerald-400 transition active:scale-[0.98] hover:bg-emerald-500/35"
                  >
                    <Check className="h-3.5 w-3.5" /> Acceptera
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Utgående */}
      <div className={cardClass}>
        <h3 className={`mb-3 flex items-center gap-2 ${sectionTitleClass}`}>
          <Send className="h-4 w-4 text-white/50" />
          Utgående ({pendingOut.length})
        </h3>
        {pendingOut.length === 0 ? (
          <p className="rounded-xl bg-white/[0.02] py-4 text-center text-sm text-white/50">
            Inga utgående förfrågningar
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pendingOut.map((r) => (
              <li
                key={r.requestId}
                className="flex flex-row items-center justify-between rounded-xl bg-white/5 px-4 py-3"
              >
                <span className="font-medium text-white/90">{displayName(r.to)}</span>
                <span className="rounded-full border border-white/15 px-3 py-1 text-xs font-medium text-white/50">
                  Skickad
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}