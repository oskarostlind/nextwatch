"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Copy, LogOut, UserPlus, Users, Search, Plus, Check } from "lucide-react";
import Modal from "../components/ui/Modal";

/** ---------- Types ---------- */
type PublicMember = {
  userId: string;
  username: string | null;
  displayName: string | null;
  providers?: string[];
};

type GroupInitial = {
  code: string | null;
  region?: string;
  members: PublicMember[];
  meUserId?: string | null;
};

type FriendsListUser = {
  id: string;
  username: string | null;
  displayName: string | null;
};

type FriendsListResp = {
  friends: FriendsListUser[];
  pendingIn: { requestId: string; from: FriendsListUser }[];
  pendingOut: { requestId: string; to: FriendsListUser }[];
};

/** ---------- API Helpers ---------- */
async function fetchFriends(): Promise<FriendsListResp | null> {
  try {
    const res = await fetch("/api/friends/list", { cache: "no-store" });
    if (!res.ok) return null;
    
    const data = await res.json() as { 
      friends?: Array<{ other?: FriendsListUser; id?: string; userId?: string; username?: string; displayName?: string }>; 
      pendingIn?: { requestId: string; from: FriendsListUser }[]; 
      pendingOut?: { requestId: string; to: FriendsListUser }[];
    };
    
    const mappedFriends = (data.friends || []).map((row) => {
      if (row.other) return row.other;
      return {
        id: String(row.id ?? row.userId ?? ""),
        username: row.username ?? null,
        displayName: row.displayName ?? null,
      };
    });

    return {
      friends: mappedFriends,
      pendingIn: data.pendingIn || [],
      pendingOut: data.pendingOut || [],
    };
  } catch {
    return null;
  }
}

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

/** ---------- Main Component ---------- */
export default function GroupClient({ initial }: { initial: GroupInitial }) {
  const [tab, setTab] = useState<"group" | "friends">("group");
  const [code, setCode] = useState<string | null>(initial.code);
  const [region, setRegion] = useState<string | undefined>(initial.region);
  const [members, setMembers] = useState<PublicMember[]>(initial.members || []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [meUserId] = useState<string | null>(initial.meUserId || null);

  // Vänner & Invites
  const [friends, setFriends] = useState<FriendsListUser[]>([]);
  const [friendsIdSet, setFriendsIdSet] = useState<Set<string>>(new Set());
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [sentToIds, setSentToIds] = useState<Set<string>>(new Set());
  
  // Vänner tab state
  const [pendingIn, setPendingIn] = useState<{ requestId: string; from: FriendsListUser }[]>([]);
  const [pendingOut, setPendingOut] = useState<{ requestId: string; to: FriendsListUser }[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadFriends();
  }, []);

  const loadFriends = async () => {
    const data = await fetchFriends();
    if (data) {
      setFriends(data.friends || []);
      setFriendsIdSet(new Set((data.friends || []).map((u) => u.id)));
      setPendingIn(data.pendingIn || []);
      setPendingOut(data.pendingOut || []);
    }
  };

  const refreshMembers = useCallback(async (overrideCode?: string) => {
    const targetCode = overrideCode || code;
    if (!targetCode) return;
    const res = await apiCall<{ code: string; region?: string; members: PublicMember[] }>(
      `/api/group/members?code=${encodeURIComponent(targetCode)}`
    );
    if ("members" in res) {
      setMembers(res.members);
      setRegion(res.region);
    }
  }, [code]);

  // Polling för gruppmedlemmar
  useEffect(() => {
    if (!code || tab !== "group") return;
    const timer = setInterval(() => refreshMembers(), 5000);
    return () => clearInterval(timer);
  }, [code, tab, refreshMembers]);

  // Actions
  const handleAction = async <T,>(action: () => Promise<T | { error: string }>, onSuccess: (data: T) => void) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result && typeof result === "object" && "error" in result) {
      setError(result.error);
    } else {
      onSuccess(result as T);
    }
  };

  const handleCreate = (name?: string) => 
    handleAction(
      () => apiCall<{ code: string }>("/api/group/create", name ? { name } : {}),
      (data) => { setCode(data.code); refreshMembers(data.code); }
    );

  const handleJoin = (groupCode: string) => 
    handleAction(
      () => apiCall<{ code: string }>("/api/group/join", { code: groupCode }),
      (data) => { setCode(data.code); refreshMembers(data.code); }
    );

  const handleLeave = () => 
    handleAction(
      () => apiCall<{ success: boolean }>("/api/group/leave", {}),
      () => { setCode(null); setMembers([]); }
    );

  const quickAdd = async (userId: string) => {
    const res = await apiCall<{ requestId: string }>("/api/friends/request", { toUserId: userId });
    if (!("error" in res)) setSentToIds((prev) => new Set(prev).add(userId));
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 pt-4">
      {/* --- Animated Tabs (Tinder Style) --- */}
      <div className="flex w-fit items-center gap-1 rounded-full bg-white/5 p-1 shadow-inner">
        {(["group", "friends"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="relative px-6 py-2 text-sm font-semibold capitalize transition-colors"
          >
            {tab === t && (
              <motion.div
                layoutId="group-tabs"
                className="absolute inset-0 rounded-full bg-white"
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
              />
            )}
            <span className={`relative z-10 ${tab === t ? "text-black" : "text-white/60 hover:text-white"}`}>
              {t}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 p-4 text-sm font-medium text-red-400">
          {error}
        </div>
      )}

      {/* --- Tab Content --- */}
      {tab === "group" ? (
        code ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            {/* Active Group Header Card */}
            <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-6 shadow-xl backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-white/50">Aktiv grupp</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <h2 className="text-4xl font-black tracking-tighter text-white">{code}</h2>
                  {region && <span className="text-sm font-medium text-white/40">{region}</span>}
                </div>
              </div>
              
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(code).catch(() => {})}
                  className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium transition hover:bg-white/10"
                >
                  <Copy className="h-4 w-4" /> Kod
                </button>
                <button
                  onClick={() => setInviteOpen(true)}
                  className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/90"
                >
                  <UserPlus className="h-4 w-4" /> Bjud in
                </button>
                <button
                  onClick={handleLeave}
                  className="flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/20"
                >
                  <LogOut className="h-4 w-4" /> Lämna
                </button>
              </div>
            </div>

            {/* Members List */}
            <div>
              <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white/90">
                <Users className="h-5 w-5" /> Medlemmar ({members.length})
              </h3>
              {members.length === 0 ? (
                <p className="text-sm text-white/40">Inga medlemmar ännu.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {members.map((m) => {
                    const isMe = meUserId === m.userId;
                    const isFriend = friendsIdSet.has(m.userId);
                    const isSent = sentToIds.has(m.userId);

                    return (
                      <div key={m.userId} className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/5 p-4 transition hover:bg-white/10">
                        <div>
                          <p className="font-medium text-white">{m.displayName ?? m.username ?? "Okänd"}</p>
                          {m.providers && m.providers.length > 0 && (
                            <p className="mt-1 text-xs text-white/40">{m.providers.join(", ")}</p>
                          )}
                        </div>
                        {isMe ? (
                          <span className="rounded-full bg-white/10 px-2 py-1 text-xs font-medium text-white/60">Du</span>
                        ) : isFriend ? (
                          <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-400">Vän</span>
                        ) : isSent ? (
                          <span className="rounded-full border border-white/10 px-2 py-1 text-xs font-medium text-white/40">Skickad</span>
                        ) : (
                          <button
                            onClick={() => quickAdd(m.userId)}
                            className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20"
                          >
                            <Plus className="h-3 w-3" /> Lägg till
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 animate-in fade-in sm:grid-cols-2">
            <div className="flex flex-col justify-between rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur-md">
              <div>
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/20 text-violet-400">
                  <Users className="h-5 w-5" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">Gå med i grupp</h3>
                <p className="mb-4 text-sm text-white/60">Har du fått en kod? Skriv in den nedan för att ansluta.</p>
              </div>
              <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); handleJoin(fd.get("code") as string); }} className="flex gap-2">
                <input
                  name="code"
                  placeholder="Ex. ABC123"
                  className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-2 font-mono text-sm uppercase outline-none focus:border-white/30"
                  required
                />
                <button disabled={busy} type="submit" className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50">
                  Gå med
                </button>
              </form>
            </div>

            <div className="flex flex-col justify-between rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur-md">
              <div>
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-400">
                  <Plus className="h-5 w-5" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">Skapa en grupp</h3>
                <p className="mb-4 text-sm text-white/60">Starta en ny grupp och bjud in dina vänner att svepa med dig.</p>
              </div>
              <button disabled={busy} onClick={() => handleCreate()} className="w-full rounded-xl bg-cyan-600 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50">
                Skapa ny grupp
              </button>
            </div>
          </div>
        )
      ) : (
        /* --- Friends Tab --- */
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/40" />
            <input
              className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 pl-12 pr-4 text-sm outline-none transition focus:border-white/30 focus:bg-white/10"
              placeholder="Sök efter användarnamn..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            {/* Vänner Lista */}
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

            {/* Förfrågningar */}
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
                        <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-medium uppercase text-white/60">Väntar</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              
              {/* Utgående förfrågningar */}
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
      )}

      {/* --- Invite Modal --- */}
      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)}>
        <div className="p-2">
          <h3 className="mb-4 text-xl font-bold">Bjud in vänner</h3>
          {friends.length === 0 ? (
            <p className="py-8 text-center text-sm text-white/40">Du har inga vänner att bjuda in.</p>
          ) : (
            <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
              {friends.map((f) => {
                const isInvited = invitedIds.has(f.id);
                return (
                  <li key={f.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 p-3">
                    <span className="font-medium">{f.displayName ?? f.username ?? "Okänd"}</span>
                    {isInvited ? (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-400">
                        <Check className="h-3 w-3" /> Inbjuden
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          apiCall("/api/group/invite", { toUserId: f.id }).then(() => {
                            setInvitedIds((prev) => new Set(prev).add(f.id));
                          });
                        }}
                        className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black transition hover:bg-white/80"
                      >
                        Bjud in
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  );
}