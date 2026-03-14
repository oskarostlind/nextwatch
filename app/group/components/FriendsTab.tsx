"use client";

import { useState, useEffect } from "react";
import { Search, Plus } from "lucide-react";

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
      setFriends((data.friends || []).map((row) => {
        const u = row.other || row;
        return { 
          id: String(u.id ?? u.userId ?? ""), 
          username: u.username ?? null, 
          displayName: u.displayName ?? null 
        };
      }));
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
      const res = await apiCall<{ ok: boolean; results: SearchRow[] }>(`/api/friends/search?q=${encodeURIComponent(query)}`);
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
    const res = await apiCall<{ ok: boolean }>("/api/friends/accepts", { requestId });
    if (!("error" in res) && res.ok) {
      void loadFriends();
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/40" />
        <input
          className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 pl-12 pr-4 text-sm outline-none transition focus:border-white/30 focus:bg-white/10"
          placeholder="Sök efter användarnamn..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {isSearching && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-white/40">Söker...</span>}
      </div>

      {searchResults.length > 0 && (
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
          <h4 className="mb-3 text-sm font-semibold text-cyan-400">Sökresultat</h4>
          <ul className="space-y-2">
            {searchResults.map((user) => {
              const isAlreadyFriend = user.is_friend;
              const isSent = sentToIds.has(user.id) || pendingOut.some(p => p.to.id === user.id);

              return (
                <li key={user.id} className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3">
                  <span className="font-medium">{user.display_name ?? user.username ?? "Okänd"}</span>
                  
                  {isAlreadyFriend ? (
                    <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-medium uppercase text-white/40">Vän</span>
                  ) : isSent ? (
                    <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-medium uppercase text-white/40">Skickad</span>
                  ) : (
                    <button
                      onClick={() => void sendFriendRequest(user.id)}
                      className="flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-black transition hover:bg-white/80"
                    >
                      <Plus className="h-3 w-3" /> Lägg till
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <h4 className="mb-3 font-semibold text-white/80">Dina vänner</h4>
          {friends.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center">
              <p className="text-sm text-white/40">Du har inga vänner tillagda än.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {friends.map((f) => (
                <li key={f.id} className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3">
                  <span className="font-medium">{f.displayName ?? f.username ?? "Okänd"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-6">
          <div>
            <h4 className="mb-3 font-semibold text-white/80">Inkommande ({pendingIn.length})</h4>
            {pendingIn.length === 0 ? (
              <p className="text-sm text-white/40">Inga nya förfrågningar.</p>
            ) : (
              <ul className="space-y-2">
                {pendingIn.map((r) => (
                  <li key={r.requestId} className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3">
                    <span className="font-medium">{r.from.displayName ?? r.from.username ?? "Okänd"}</span>
                    <button
                      onClick={() => void acceptRequest(r.requestId)}
                      className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-400 hover:bg-emerald-500/30"
                    >
                      Acceptera
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          
          <div>
            <h4 className="mb-3 font-semibold text-white/80">Utgående ({pendingOut.length})</h4>
            {pendingOut.length === 0 ? (
              <p className="text-sm text-white/40">Inga utgående förfrågningar.</p>
            ) : (
              <ul className="space-y-2">
                {pendingOut.map((r) => (
                  <li key={r.requestId} className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3">
                    <span className="font-medium">{r.to.displayName ?? r.to.username ?? "Okänd"}</span>
                    <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-medium uppercase text-white/40">Skickad</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}