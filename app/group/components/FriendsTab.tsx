"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Users, UserPlus, Check, ChevronRight, MessageCircle, MoreHorizontal } from "lucide-react";
import { hydrateSocialInitial, refreshSocial } from "@/lib/socialStore";
import { useSocial } from "@/app/components/client/SocialProvider";
import FriendProfileModal from "./FriendProfileModal";
import FilmChatModal from "@/app/components/client/FilmChatModal";
import ReportUserModal from "@/app/components/client/ReportUserModal";
import Avatar from "@/app/components/ui/Avatar";
import { fieldClass } from "@/app/components/ui/kit";
import { refreshThreads, useShareThreads } from "@/lib/threadsStore";
import CoachMarkTour from "@/app/components/client/tours/CoachMarkTour";
import { FRIENDS_TOUR_STEPS } from "@/lib/tours/coachSteps";
import type { FriendsInitial } from "../page";
import { useTranslations } from "next-intl";

type SearchRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  is_friend: boolean;
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
    if (!res.ok) throw new Error("API Error");
    return (await res.json()) as T;
  } catch {
    return { error: networkError };
  }
}

const cardClass = "rounded-2xl border border-white/10 bg-white/5 p-4";
const sectionTitleClass = "text-sm font-semibold text-white/70 uppercase tracking-wide";

export default function FriendsTab({ initial }: { initial: FriendsInitial }) {
  const t = useTranslations("friends");
  // Fallback-etiketten är översatt, så helpern måste bo inne i komponenten
  // (den låg tidigare på modulnivå med hårdkodad "Okänd").
  const displayName = (u: { displayName?: string | null; username?: string | null; id?: string }) =>
    u.displayName ?? u.username ?? t("unknown");
  // Delad social-store: förladdad vid appstart + hålls färsk av den globala
  // pollern (SocialPreloader i AppShell) — ingen egen fetch/interval här.
  const social = useSocial();
  const { friends, pendingIn, pendingOut } = social;

  const [searchQuery, setSearchQuery] = useState("");
  // Vilken vän som har raden med Ta bort/Blockera utfälld.
  const [manageId, setManageId] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [sentToIds, setSentToIds] = useState<Set<string>>(new Set());
  const [openFriendId, setOpenFriendId] = useState<string | null>(null);
  const [chatFriendId, setChatFriendId] = useState<string | null>(null);
  // Guideline 1.2: anmälan ska gå att nå där användaren visas.
  const [reportFriendId, setReportFriendId] = useState<string | null>(null);
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
      const res = await apiCall<{ ok: boolean; results: SearchRow[] }>(`/api/friends/search?q=${encodeURIComponent(query)}`, undefined, t("networkError"));
      if (res && !("error" in res) && res.ok) {
        setSearchResults(res.results);
      }
      setIsSearching(false);
    }, 300);

    return () => clearTimeout(timer);
    // t() är stabil per språk/namnrymd (next-intl memoiserar den). Att lägga
    // den i deps skulle bara riskera en extra hämtning vid språkbyte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const sendFriendRequest = async (userId: string) => {
    const res = await apiCall<{ requestId: string }>("/api/friends/request", { toUserId: userId }, t("networkError"));
    if (!("error" in res)) {
      setSentToIds((prev) => new Set(prev).add(userId));
      void refreshSocial();
    }
  };

  const acceptRequest = async (requestId: string) => {
    const res = await apiCall<{ ok: boolean }>("/api/friends/accept", { requestId }, t("networkError"));
    if (!("error" in res)) {
      void refreshSocial();
    }
  };

  const declineRequest = async (requestId: string) => {
    const res = await apiCall<{ ok: boolean }>("/api/friends/decline", { requestId }, t("networkError"));
    if (!("error" in res)) {
      void refreshSocial();
    }
  };

  // App Store-riktlinje 1.2: den som lagt till en vän — och därmed öppnat en
  // filmchatt — måste kunna ta sig ur kontakten igen.
  const removeFriend = async (userId: string) => {
    setManaging(true);
    const res = await apiCall<{ ok: boolean }>("/api/friends/remove", { userId }, t("networkError"));
    setManaging(false);
    if (!("error" in res)) {
      setManageId(null);
      void refreshSocial();
    }
  };

  const blockFriend = async (userId: string) => {
    setManaging(true);
    const res = await apiCall<{ ok: boolean }>("/api/friends/block", { userId, block: true }, t("networkError"));
    setManaging(false);
    if (!("error" in res)) {
      setManageId(null);
      void refreshSocial();
    }
  };

  const hasPending = pendingIn.length > 0 || pendingOut.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className={cardClass} data-tour="friends-add">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-white/40" />
          <input
            className={`${fieldClass} pl-10 pr-10 text-sm`}
            placeholder={t("searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {isSearching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/60">
              {t("searching")}
            </span>
          )}
        </div>
      </div>

      {/* Sökresultat */}
      {searchResults.length > 0 && (
        <div className={cardClass}>
          <h3 className={`mb-3 flex items-center gap-2 ${sectionTitleClass}`}>
            <Search className="h-4 w-4 text-white/50" />
            {t("searchResults")}
          </h3>
          <ul className="flex flex-col gap-2">
            {searchResults.map((user) => {
              const isAlreadyFriend = user.is_friend;
              const isSent =
                sentToIds.has(user.id) || pendingOut.some((p) => p.to.id === user.id);
              const name = user.display_name ?? user.username ?? t("unknown");

              return (
                <li
                  key={user.id}
                  className="flex flex-row items-center justify-between rounded-xl bg-white/5 px-4 py-3"
                >
                  <span className="font-medium text-white/90">{name}</span>
                  {isAlreadyFriend ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-400">
                      <Check className="h-3 w-3" /> {t("friend")}
                    </span>
                  ) : isSent ? (
                    <span className="rounded-full border border-white/20 px-3 py-1 text-xs font-medium text-white/50">
                      {t("sent")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void sendFriendRequest(user.id)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500 px-4 py-2 text-xs font-bold text-black transition active:scale-[0.98] hover:bg-cyan-400"
                    >
                      <Plus className="h-3.5 w-3.5" /> {t("add")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Dina vänner */}
      <div className={cardClass} data-tour="friends-list">
        <h3 className={`mb-3 flex items-center gap-2 ${sectionTitleClass}`}>
          <Users className="h-4 w-4 text-white/50" />
          {t("yourFriends", { count: friends.length })}
        </h3>
        {friends.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] py-8 text-center">
            <Users className="mx-auto mb-2 h-10 w-10 text-white/20" />
            <p className="text-sm text-white/50">{t("noFriends")}</p>
          </div>
        ) : (
          <>
            {friends.length > 3 && (
              <input
                value={friendFilter}
                onChange={(e) => setFriendFilter(e.target.value)}
                placeholder={t("filterPlaceholder")}
                className={`${fieldClass} mb-2 text-sm`}
              />
            )}
          <ul className="flex flex-col gap-2">
            {visibleFriends.map((f) => {
              const unseen = unseenByFriend[f.id] ?? 0;
              return (
                <li key={f.id} className="rounded-xl bg-white/5 transition hover:bg-white/10">
                  <div className="flex items-center gap-2 px-2 py-1.5">
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
                    aria-label={t("chatWithAria", { name: displayName(f) })}
                    onClick={() => setChatFriendId(f.id)}
                    className="relative shrink-0 rounded-full p-2.5 text-cyan-300/80 transition hover:bg-cyan-500/15 hover:text-cyan-200"
                  >
                    <MessageCircle className="h-5 w-5" />
                    {unseen > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[10px] font-bold tabular-nums text-black">
                        {unseen}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={t("manageAria", { name: displayName(f) })}
                    onClick={() => setManageId(manageId === f.id ? null : f.id)}
                    className="shrink-0 rounded-full p-2.5 text-white/40 transition hover:bg-white/10 hover:text-white/80"
                  >
                    <MoreHorizontal className="h-5 w-5" />
                  </button>
                  </div>
                  {manageId === f.id && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-3 py-2">
                      <button
                        type="button"
                        disabled={managing}
                        onClick={() => removeFriend(f.id)}
                        className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/20 disabled:opacity-50"
                      >
                        {t("removeFriend")}
                      </button>
                      <button
                        type="button"
                        disabled={managing}
                        onClick={() => blockFriend(f.id)}
                        className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-500/25 disabled:opacity-50"
                      >
                        {t("block")}
                      </button>
                      <button
                        type="button"
                        disabled={managing}
                        onClick={() => setReportFriendId(f.id)}
                        className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/20 disabled:opacity-50"
                      >
                        {t("report")}
                      </button>
                      <span className="text-[11px] text-white/60">
                        {t("blockHint")}
                      </span>
                    </div>
                  )}
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
        onReport={(id) => {
          setOpenFriendId(null);
          setReportFriendId(id);
        }}
      />

      <ReportUserModal
        userId={reportFriendId}
        userLabel={displayName(friends.find((f) => f.id === reportFriendId) ?? { id: reportFriendId ?? "" })}
        onClose={() => setReportFriendId(null)}
        onReported={() => {
          setManageId(null);
          void refreshSocial();
        }}
      />

      <FilmChatModal
        friendId={chatFriendId}
        friendName={displayName(friends.find((f) => f.id === chatFriendId) ?? { id: chatFriendId ?? "" })}
        friendAvatarId={friends.find((f) => f.id === chatFriendId)?.avatarId ?? null}
        onClose={() => setChatFriendId(null)}
      />

      {hasPending && (
        <div className={cardClass} data-tour="friends-requests">
          <h3 className={`mb-3 flex items-center gap-2 ${sectionTitleClass}`}>
            <UserPlus className="h-4 w-4 text-white/50" />
            {t("requests")}
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
                    className="rounded-xl border border-white/15 px-3 py-2 text-xs text-white/70 hover:bg-white/5"
                  >
                    {t("decline")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void acceptRequest(r.requestId)}
                    className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-medium text-white"
                  >
                    {t("accept")}
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
                <span className="text-xs text-white/60">{t("pending")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <CoachMarkTour tourId="friends-tour" steps={FRIENDS_TOUR_STEPS} />
    </div>
  );
}