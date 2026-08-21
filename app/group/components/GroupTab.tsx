"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Copy, LogOut, UserPlus, Users, Plus, Check, Play, Settings, Sparkles, X } from "lucide-react";
import Modal from "@/app/components/ui/Modal";
import PosterImage from "@/app/components/ui/PosterImage";
import { fieldClass } from "@/app/components/ui/kit";
import GroupSettingsModal from "./GroupSettingsModal";
import ReportUserModal from "@/app/components/client/ReportUserModal";
import { hydrateSocialInitial, refreshSocial } from "@/lib/socialStore";
import { useSocial } from "@/app/components/client/SocialProvider";
import CoachMarkTour from "@/app/components/client/tours/CoachMarkTour";
import { GROUP_ACTIVE_STEPS, GROUPS_START_STEPS } from "@/lib/tours/coachSteps";
import type { PublicMember } from "../GroupClient";
import { useTranslations } from "next-intl";

type GroupResponse = {
  code?: string;
  group?: { code: string };
};

// networkError skickas in i stället för att slås upp här: funktionen ligger
// på modulnivå och har ingen tillgång till useTranslations.
async function apiCall<T>(
  url: string,
  payload: unknown,
  networkError: string
): Promise<T | { error: string }> {
  try {
    const res = await fetch(url, {
      method: payload ? "POST" : "GET",
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      cache: "no-store",
    });
    if (!res.ok) {
      // Servern skickar ofta en förklarande `message` (t.ex. medlemstaket i
      // /api/group/join). Kastade vi direkt här blev varje sådant svar
      // "Nätverksfel. Försök igen." — fel orsak, och användaren fick aldrig
      // veta att gruppen var full.
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      return { error: body?.message || networkError };
    }
    return (await res.json()) as T;
  } catch {
    return { error: networkError };
  }
}

type Props = {
  initialCode: string | null;
  initialRegion?: string;
  initialMembers: PublicMember[];
  initialMeUserId?: string | null;
};

type CommonItem = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year: string | null;
  poster: string | null;
  count: number;
};

/**
 * "Gemensamt i era watchlists" — titlar som ≥2 medlemmar redan sparat.
 * Svaret på "vad händer när alla swipat klart?": det ni redan är överens om.
 */
function CommonWatchlistSection({ code, memberCount }: { code: string; memberCount: number }) {
  const t = useTranslations("group");
  const [items, setItems] = useState<CommonItem[] | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/group/common-watchlist?code=${encodeURIComponent(code)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; items?: CommonItem[] } | null) => {
        if (active && j?.ok) setItems(j.items ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [code, memberCount]);

  if (!items || items.length === 0) return null;

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-white/60">
        <Sparkles className="h-4 w-4" /> {t("commonWatchlist")}
      </h3>
      <p className="mb-2 text-xs text-white/60">
        {t("commonWatchlistHint")}
      </p>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {items.map((it) => (
          <div key={`${it.mediaType}-${it.tmdbId}`} className="w-[100px] shrink-0">
            <div className="relative overflow-hidden rounded-lg border border-white/10">
              {it.poster ? (
                <PosterImage
                  src={it.poster}
                  alt={it.title}
                  width={100}
                  height={150}
                  className="h-[150px] w-[100px] object-cover"
                />
              ) : (
                <div className="flex h-[150px] w-[100px] items-center justify-center bg-neutral-800 p-2 text-center text-[11px] text-neutral-400">
                  {it.title}
                </div>
              )}
              <span className="absolute right-1 top-1 rounded-full bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
                {it.count}/{memberCount}
              </span>
            </div>
            <p className="mt-1 truncate text-[11px] text-white/70">{it.title}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GroupTab({ initialCode, initialRegion, initialMembers, initialMeUserId }: Props) {
  const t = useTranslations("group");
  const router = useRouter();
  const [code, setCode] = useState<string | null>(initialCode);
  const [region] = useState<string | undefined>(initialRegion);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  // Kort visuell kvittens på Kopiera (ikonen växlar till en bock) — toasten
  // gör själva jobbet, den här bara bekräftar på knappen man just tryckte på.
  const [copied, setCopied] = useState(false);

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

  // useState fångar bara initialCode vid mount. Efter join/accept/leave kör
  // servern om (router.refresh) med ett nytt initialCode ur nw_group-cookien —
  // synka hit, annars fastnar vyn på det gamla värdet. Det var därför en
  // accepterad inbjudan inte syntes ("som att jag inte gått med i någon grupp").
  useEffect(() => {
    setCode(initialCode);
  }, [initialCode]);

  // "Inbjuden"-chippen lever i lokalt state. Utan den här nollställningen låg
  // den kvar när man lämnade en grupp och skapade/gick med i en ny (samma
  // komponentinstans återanvänds vid router.refresh) — då såg det ut som att
  // vännerna redan var inbjudna i den nya gruppen fast de inte var det.
  useEffect(() => {
    setInvitedIds(new Set());
  }, [code]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

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
    name: f.displayName ?? f.username ?? t("unknown"),
  }));

  // Vänner som redan är med i gruppen ska inte gå att bjuda in igen.
  const memberIds = new Set(members.map((m) => m.userId));

  const [meUserId, setMeUserId] = useState<string | null>(initialMeUserId || null);
  // Guideline 1.2: anmäl en gruppmedlem.
  const [reportMemberId, setReportMemberId] = useState<string | null>(null);

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
      apiCall<{ profile?: { userId: string } }>("/api/profile", undefined, t("networkError")).then((res) => {
        if (res && !("error" in res) && res.profile?.userId) {
          setMeUserId(res.profile.userId);
        }
      });
    }
    // t() är stabil per språk/namnrymd (next-intl memoiserar den). Att lägga
    // den i deps skulle bara riskera en extra hämtning vid språkbyte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      () => apiCall<GroupResponse>("/api/group/create", {}, t("networkError")),
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
      () => apiCall<GroupResponse>("/api/group/join", { code: groupCode }, t("networkError")),
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
      () => apiCall<{ success: boolean }>("/api/group/leave", {}, t("networkError")),
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
    const result = await apiCall<{ ok?: boolean }>("/api/group/invite", { toUserId: userId }, t("networkError"));
    if (result && "error" in result) {
      setError(result.error);
      return;
    }
    setInvitedIds((prev) => new Set(prev).add(userId));
    void refreshSocial();
  };

  const removeMember = async (userId: string) => {
    setError(null);
    const result = await apiCall<{ ok?: boolean; message?: string }>("/api/group/remove", { userId }, t("networkError"));
    if (result && "error" in result) {
      setError(result.error);
      return;
    }
    if (result && "ok" in result && result.ok === false) {
      setError(result.message ?? t("removeMemberFailed"));
      return;
    }
    void refreshSocial();
  };

  if (code) {
    return (
      <div className="space-y-4">
        {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}

        <button
          type="button"
          data-tour="group-start-swipe"
          onClick={startGroupSwipe}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-base font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500"
        >
          <Play className="h-5 w-5" /> {t("startGroupSwipe")}
        </button>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-white/60">{t("groupCode")}</p>
            {isCreator && (
              <button
                type="button"
                aria-label={t("groupSettings")}
                title={t("groupSettings")}
                data-tour="group-settings"
                onClick={() => setSettingsOpen(true)}
                className="relative flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-white/60 transition after:absolute after:-inset-1.5 hover:bg-white/10 hover:text-white"
              >
                <Settings className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <h2 className="font-mono text-3xl font-bold tracking-wider text-white">{code}</h2>
            {region && <span className="text-xs text-white/60">{region}</span>}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard
                  .writeText(code)
                  .then(() => {
                    setCopied(true);
                    window.dispatchEvent(new CustomEvent("app:toast", { detail: t("codeCopied") }));
                  })
                  .catch(() => {})
              }
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {t("copy")}
            </button>
            <button
              type="button"
              data-tour="group-invite"
              onClick={openInviteModal}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-black hover:bg-white/90"
            >
              <UserPlus className="h-4 w-4" /> {t("invite")}
            </button>
            <button
              type="button"
              onClick={handleLeave}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/20 px-3 py-2 text-sm text-rose-400 hover:bg-rose-500/10"
            >
              <LogOut className="h-4 w-4" /> {t("leave")}
            </button>
          </div>
        </div>

        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-white/60">
            <Users className="h-4 w-4" /> {t("members", { count: members.length })}
          </h3>
          <ul className="space-y-2">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3"
              >
                <span className="font-medium text-white/90">{m.displayName ?? m.username ?? t("unknown")}</span>
                <span className="flex items-center gap-2">
                  {meUserId === m.userId ? (
                    <span className="text-xs text-white/60">{t("you")}</span>
                  ) : (
                    <>
                      {/* Guideline 1.2: anmälan nåbar där andra användare visas. */}
                      <button
                        type="button"
                        onClick={() => setReportMemberId(m.userId)}
                        className="rounded-lg px-2 py-1 text-[11px] font-medium text-white/45 transition hover:bg-rose-500/10 hover:text-rose-300"
                      >
                        {t("report")}
                      </button>
                      {isCreator ? (
                        <button
                          type="button"
                          aria-label={t("removeMemberAria", { name: m.displayName ?? m.username ?? t("member") })}
                          title={t("removeFromGroup")}
                          onClick={() => void removeMember(m.userId)}
                          className="relative flex h-7 w-7 items-center justify-center rounded-full border border-rose-500/20 text-rose-400 transition after:absolute after:-inset-1.5 hover:bg-rose-500/10"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      ) : null}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <CommonWatchlistSection code={code} memberCount={members.length} />

        <ReportUserModal
          userId={reportMemberId}
          userLabel={
            members.find((m) => m.userId === reportMemberId)?.displayName ??
            members.find((m) => m.userId === reportMemberId)?.username ??
            undefined
          }
          onClose={() => setReportMemberId(null)}
          onReported={() => void refreshSocial()}
        />

        <Modal open={inviteOpen} onClose={() => setInviteOpen(false)}>
          <div className="p-2">
            <h3 className="mb-4 text-xl font-bold">{t("inviteFriendsHeading")}</h3>
            <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
              {friends.map((f) => (
                <li key={f.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 p-3">
                  <span className="font-medium">{f.name}</span>
                  {memberIds.has(f.id) ? (
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/50">{t("alreadyMember")}</span>
                  ) : invitedIds.has(f.id) ? (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-400"><Check className="h-3 w-3" /> {t("invited")}</span>
                  ) : (
                    <button onClick={() => void inviteUser(f.id)} className="rounded-full bg-white px-4 py-2 text-xs font-bold text-black hover:bg-white/80">{t("invite")}</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Modal>

        {isCreator && (
          <GroupSettingsModal code={code} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        )}

        {/* Bjud in / inställningar / starta swipe förklaras först när man
            FAKTISKT är med i en grupp — tidigare pekade de på knappar som inte
            fanns, och varje saknat mål gav 3,5 sekunder tom ruta. */}
        <CoachMarkTour tourId="group-active-tour" steps={GROUP_ACTIVE_STEPS} forceAliases={["groups-tour"]} />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-tour="group-join-create">
      {error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <h3 className="mb-1 font-semibold">{t("joinGroupHeading")}</h3>
        <p className="mb-4 text-sm text-white/50">{t("joinGroupHint")}</p>
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
            className={`${fieldClass} font-mono text-sm uppercase`}
            required
          />
          <button
            disabled={busy}
            type="submit"
            className="shrink-0 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-black hover:bg-cyan-400 disabled:opacity-50"
          >
            {t("join")}
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <h3 className="mb-1 font-semibold">{t("createGroupHeading")}</h3>
        <p className="mb-4 text-sm text-white/50">{t("createGroupHint")}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => handleCreate()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 py-2.5 text-sm font-semibold text-black hover:bg-cyan-400 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {t("createGroup")}
        </button>
      </div>

      <CoachMarkTour tourId="groups-tour" steps={GROUPS_START_STEPS} />
    </div>
  );
}