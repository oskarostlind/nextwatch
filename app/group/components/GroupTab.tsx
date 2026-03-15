"use client";

import { useState, useEffect, useCallback } from "react";
import { Copy, LogOut, UserPlus, Users, Plus, Check } from "lucide-react";
import Modal from "@/app/components/ui/Modal";
import type { PublicMember } from "../GroupClient";

type GroupResponse = {
  code?: string;
  group?: { code: string };
};

type RawMember = {
  userId?: string | number;
  user_id?: string | number;
  id?: string | number;
  username?: string | null;
  displayName?: string | null;
  providers?: unknown;
};

type GroupMembersResponse = {
  code?: string;
  region?: string;
  members?: RawMember[];
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
  friends?: FriendRowData[];
  error?: string;
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

type Props = {
  initialCode: string | null;
  initialRegion?: string;
  initialMembers: PublicMember[];
  initialMeUserId?: string | null;
};

export default function GroupTab({ initialCode, initialRegion, initialMembers, initialMeUserId }: Props) {
  const [code, setCode] = useState<string | null>(initialCode);
  const [region, setRegion] = useState<string | undefined>(initialRegion);
  const [members, setMembers] = useState<PublicMember[]>(initialMembers || []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const [friends, setFriends] = useState<{ id: string; name: string }[]>([]);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());

  const [meUserId, setMeUserId] = useState<string | null>(initialMeUserId || null);

  useEffect(() => {
    if (!meUserId) {
      apiCall<{ profile?: { userId: string } }>("/api/profile").then((res) => {
        if (res && !("error" in res) && res.profile?.userId) {
          setMeUserId(res.profile.userId);
        }
      });
    }
  }, [meUserId]);

  const refreshMembers = useCallback(async (overrideCode?: string) => {
    const targetCode = overrideCode || code;
    if (!targetCode) return;
    
    const res = await apiCall<GroupMembersResponse>(
      `/api/group/members?code=${encodeURIComponent(targetCode)}`
    );
    
    if (res && !("error" in res) && Array.isArray(res.members)) {
      const safeMembers: PublicMember[] = res.members.map((m) => ({
        userId: String(m.userId ?? m.user_id ?? m.id ?? ""),
        username: typeof m.username === "string" ? m.username : null,
        displayName: typeof m.displayName === "string" ? m.displayName : null,
        providers: Array.isArray(m.providers) 
          ? m.providers.filter((p): p is string => typeof p === "string") 
          : [],
      }));
      setMembers(safeMembers);
      if (res.region) setRegion(res.region);
    }
  }, [code]);

  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => void refreshMembers(), 5000);
    return () => clearInterval(timer);
  }, [code, refreshMembers]);

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

  const handleCreate = () => 
    void handleAction(
      () => apiCall<GroupResponse>("/api/group/create", {}),
      (data) => { 
        const newCode = data.code || data.group?.code;
        if (newCode) { setCode(newCode); void refreshMembers(newCode); }
      }
    );

  const handleJoin = (groupCode: string) => 
    void handleAction(
      () => apiCall<GroupResponse>("/api/group/join", { code: groupCode }),
      (data) => { 
        const newCode = data.code || data.group?.code;
        if (newCode) { setCode(newCode); void refreshMembers(newCode); }
      }
    );

  const handleLeave = () => 
    void handleAction(
      () => apiCall<{ success: boolean }>("/api/group/leave", {}),
      () => { setCode(null); setMembers([]); }
    );

  const openInviteModal = async () => {
    setInviteOpen(true);
    const res = await apiCall<FriendsListApiResponse>("/api/friends/list");
    
    if (res && !("error" in res) && Array.isArray(res.friends)) {
      setFriends(res.friends.map((row) => {
        const u = row.other || row;
        return { 
          id: String(u.id ?? u.userId ?? ""), 
          name: u.displayName ?? u.username ?? "Okänd" 
        };
      }));
    }
  };

  const inviteUser = async (userId: string) => {
    setError(null);
    const result = await apiCall<{ ok?: boolean }>("/api/group/invite", { toUserId: userId });
    if (result && "error" in result) {
      setError(result.error);
      return;
    }
    setInvitedIds((prev) => new Set(prev).add(userId));
  };

  if (code) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
        {error && <div className="rounded-xl bg-red-500/10 p-4 text-sm text-red-400">{error}</div>}
        <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-6 shadow-xl backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-white/50">Aktiv grupp</p>
            <div className="mt-1 flex items-baseline gap-2">
              <h2 className="text-4xl font-black tracking-tighter text-white">{code}</h2>
              {region && <span className="text-sm font-medium text-white/40">{region}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void navigator.clipboard.writeText(code).catch(() => {})} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium transition hover:bg-white/10">
              <Copy className="h-4 w-4" /> Kod
            </button>
            <button onClick={() => void openInviteModal()} className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/90">
              <UserPlus className="h-4 w-4" /> Bjud in
            </button>
            <button onClick={handleLeave} className="flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/20">
              <LogOut className="h-4 w-4" /> Lämna
            </button>
          </div>
        </div>

        <div>
          <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white/90">
            <Users className="h-5 w-5" /> Medlemmar ({members.length})
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {members.map((m) => (
              <div key={m.userId} className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/5 p-4 transition hover:bg-white/10">
                <div>
                  <p className="font-medium text-white">{m.displayName ?? m.username ?? "Okänd"}</p>
                  {m.providers && m.providers.length > 0 && <p className="mt-1 text-xs text-white/40">{m.providers.join(", ")}</p>}
                </div>
                {meUserId === m.userId && <span className="rounded-full bg-white/10 px-2 py-1 text-xs font-medium text-white/60">Du</span>}
              </div>
            ))}
          </div>
        </div>

        <Modal open={inviteOpen} onClose={() => setInviteOpen(false)}>
          <div className="p-2">
            <h3 className="mb-4 text-xl font-bold">Bjud in vänner</h3>
            <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
              {friends.map((f) => (
                <li key={f.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 p-3">
                  <span className="font-medium">{f.name}</span>
                  {invitedIds.has(f.id) ? (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-400"><Check className="h-3 w-3" /> Inbjuden</span>
                  ) : (
                    <button onClick={() => void inviteUser(f.id)} className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black hover:bg-white/80">Bjud in</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Modal>
      </div>
    );
  }

  return (
    <div className="grid gap-4 animate-in fade-in sm:grid-cols-2">
      {error && <div className="col-span-full rounded-xl bg-red-500/10 p-4 text-sm text-red-400">{error}</div>}
      <div className="flex flex-col justify-between rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur-md">
        <div>
          <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/20 text-violet-400"><Users className="h-5 w-5" /></div>
          <h3 className="mb-2 text-lg font-semibold">Gå med i grupp</h3>
          <p className="mb-4 text-sm text-white/60">Har du fått en kod? Skriv in den nedan.</p>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); handleJoin(fd.get("code") as string); }} className="flex gap-2">
          <input name="code" placeholder="Ex. ABC123" className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-2 font-mono text-sm uppercase outline-none focus:border-white/30" required />
          <button disabled={busy} type="submit" className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50">Gå med</button>
        </form>
      </div>
      <div className="flex flex-col justify-between rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur-md">
        <div>
          <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-400"><Plus className="h-5 w-5" /></div>
          <h3 className="mb-2 text-lg font-semibold">Skapa en grupp</h3>
          <p className="mb-4 text-sm text-white/60">Starta en ny grupp och bjud in vänner.</p>
        </div>
        <button disabled={busy} onClick={() => handleCreate()} className="w-full rounded-xl bg-cyan-600 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50">Skapa ny grupp</button>
      </div>
    </div>
  );
}