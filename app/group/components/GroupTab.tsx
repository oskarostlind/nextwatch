"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Copy, LogOut, UserPlus, Users, Plus, Check, Play, Settings } from "lucide-react";
import Modal from "@/app/components/ui/Modal";
import GroupSettingsModal from "./GroupSettingsModal";
import { hydrateSocialInitial, refreshSocial } from "@/lib/socialStore";
import { useSocial } from "@/app/components/client/SocialProvider";
import type { PublicMember } from "../GroupClient";

type GroupResponse = {
  code?: string;
  group?: { code: string };
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
  const router = useRouter();
  const [code, setCode] = useState<string | null>(initialCode);
  const [region] = useState<string | undefined>(initialRegion);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());

  // Medlemmar + vänner kommer från den delade social-store:n (en gemensam
  // poller i AppShell) istället för egna fetch/setInterval här.
  const social = useSocial();

  useEffect(() => {
    hydrateSocialInitial({
      members: (initialMembers || []).map((m) => ({
        id: m.userId,
        username: m.username,
        displayName: m.displayName,
      })),
      groupCode: initialCode,
    });
  }, [initialMembers, initialCode]);

  const members: PublicMember[] =
    social.membersReady && social.groupCode === code
      ? social.members.map((m) => ({
          userId: m.id,
          username: m.username,
          displayName: m.displayName,
        }))
      : initialMembers || [];

  const friends = social.friends.map((f) => ({
    id: f.id,
    name: f.displayName ?? f.username ?? "Okänd",
  }));

  const [meUserId, setMeUserId] = useState<string | null>(initialMeUserId || null);

  // Kugghjulet visas bara för gruppens skapare (servern verifierar också vid PATCH).
  const [isCreator, setIsCreator] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!code) {
      setIsCreator(false);
      return;
    }
    let cancelled = false;
    void fetch(`/api/group/settings?code=${encodeURIComponent(code)}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ ok?: boolean; isCreator?: boolean }>)
      .then((j) => {
        if (!cancelled) setIsCreator(Boolean(j?.ok && j.isCreator));
      })
      .catch(() => {
        if (!cancelled) setIsCreator(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (!meUserId) {
      apiCall<{ profile?: { userId: string } }>("/api/profile").then((res) => {
        if (res && !("error" in res) && res.profile?.userId) {
          setMeUserId(res.profile.userId);
        }
      });
    }
  }, [meUserId]);

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
        if (newCode) {
          setCode(newCode);
          // nw_group-cookien sattes av servern — store:n plockar upp nya gruppen.
          void refreshSocial();
          // Bust:a router-cachen så /swipe renderas om med nw_group-cookien.
          router.refresh();
        }
      }
    );

  const handleJoin = (groupCode: string) => 
    void handleAction(
      () => apiCall<GroupResponse>("/api/group/join", { code: groupCode }),
      (data) => { 
        const newCode = data.code || data.group?.code;
        if (newCode) {
          setCode(newCode);
          void refreshSocial();
          router.refresh();
        }
      }
    );

  const handleLeave = () => 
    void handleAction(
      () => apiCall<{ success: boolean }>("/api/group/leave", {}),
      () => { setCode(null); void refreshSocial(); router.refresh(); }
    );

  const startGroupSwipe = () => {
    router.refresh();
    router.push("/swipe");
  };

  const openInviteModal = () => {
    setInviteOpen(true);
    // Vännerna kommer redan från social-store:n — hämta bara om ifall listan är färsk.
    void refreshSocial();
  };

  const inviteUser = async (userId: string) => {
    setError(null);
    const result = await apiCall<{ ok?: boolean }>("/api/group/invite", { toUserId: userId });
    if (result && "error" in result) {
      setError(result.error);
      return;
    }
    setInvitedIds((prev) => new Set(prev).add(userId));
    void refreshSocial();
  };

  if (code) {
    return (
      <div className="space-y-4">
        {error && <div className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

        <button
          type="button"
          onClick={startGroupSwipe}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-base font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500"
        >
          <Play className="h-5 w-5" /> Starta gruppswipe
        </button>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-white/40">Gruppkod</p>
            {isCreator && (
              <button
                type="button"
                aria-label="Gruppinställningar"
                title="Gruppinställningar"
                onClick={() => setSettingsOpen(true)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                <Settings className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <h2 className="font-mono text-3xl font-bold tracking-wider text-white">{code}</h2>
            {region && <span className="text-xs text-white/40">{region}</span>}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(code).catch(() => {})}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
            >
              <Copy className="h-4 w-4" /> Kopiera
            </button>
            <button
              type="button"
              onClick={openInviteModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black hover:bg-white/90"
            >
              <UserPlus className="h-4 w-4" /> Bjud in
            </button>
            <button
              type="button"
              onClick={handleLeave}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/20 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10"
            >
              <LogOut className="h-4 w-4" /> Lämna
            </button>
          </div>
        </div>

        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-white/60">
            <Users className="h-4 w-4" /> Medlemmar ({members.length})
          </h3>
          <ul className="space-y-2">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3"
              >
                <span className="font-medium text-white/90">{m.displayName ?? m.username ?? "Okänd"}</span>
                {meUserId === m.userId && (
                  <span className="text-xs text-white/40">Du</span>
                )}
              </li>
            ))}
          </ul>
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

        {isCreator && (
          <GroupSettingsModal code={code} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <h3 className="mb-1 font-semibold">Gå med i grupp</h3>
        <p className="mb-4 text-sm text-white/50">Har du fått en kod? Skriv in den här.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            handleJoin((fd.get("code") as string).trim().toUpperCase());
          }}
          className="flex gap-2"
        >
          <input
            name="code"
            placeholder="ABC123"
            className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 font-mono text-sm uppercase outline-none focus:border-white/25"
            required
          />
          <button
            disabled={busy}
            type="submit"
            className="shrink-0 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-black hover:bg-cyan-400 disabled:opacity-50"
          >
            Gå med
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <h3 className="mb-1 font-semibold">Skapa grupp</h3>
        <p className="mb-4 text-sm text-white/50">Starta en ny grupp och dela koden med vänner.</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => handleCreate()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 py-2.5 text-sm font-semibold text-black hover:bg-cyan-400 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Skapa ny grupp
        </button>
      </div>
    </div>
  );
}