// Global klient-store för socialdata: vänner, gruppinbjudningar och
// gruppmedlemmar. Samma mönster som lib/swipeDeckStore.ts (modul-singleton +
// useSyncExternalStore via app/components/client/SocialProvider.tsx):
// datan förladdas i idle time vid appstart och hålls färsk av EN gemensam
// poller istället för spridda setInterval i varje komponent. Alla vyer
// (FriendsTab, IncomingInvites, GroupTab, GroupBar, InviteToasts) läser
// samma tillstånd, så accept/decline syns överallt direkt via refreshSocial().

import { readGroupCodeFromCookie } from "@/lib/swipeDeck";

export type SocialUser = {
  id: string;
  username: string | null;
  displayName: string | null;
};

export type FriendRequestIn = { requestId: string; from: SocialUser };
export type FriendRequestOut = { requestId: string; to: SocialUser };

export type GroupInviteItem = {
  id: string;
  groupCode: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  createdAt: string;
  from: SocialUser;
};

export type GroupMemberItem = SocialUser;

export type SocialState = {
  friends: SocialUser[];
  pendingIn: FriendRequestIn[];
  pendingOut: FriendRequestOut[];
  invitesIncoming: GroupInviteItem[];
  invitesOutgoing: GroupInviteItem[];
  /** Medlemmar i aktiv grupp (nw_group-cookien), tom lista annars. */
  members: GroupMemberItem[];
  groupCode: string | null;
  friendsReady: boolean;
  invitesReady: boolean;
  membersReady: boolean;
};

const POLL_MS = 5000;

let state: SocialState = {
  friends: [],
  pendingIn: [],
  pendingOut: [],
  invitesIncoming: [],
  invitesOutgoing: [],
  members: [],
  groupCode: null,
  friendsReady: false,
  invitesReady: false,
  membersReady: false,
};

const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollTickets = 0; // antal aktiva konsumenter av pollern
let refreshInFlight: Promise<void> | null = null;
let visibilityHooked = false;

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeSocial(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSocialSnapshot(): SocialState {
  return state;
}

function setState(patch: Partial<SocialState>) {
  state = { ...state, ...patch };
  emit();
}

/* ---------- parsers (defensiva mot API:ernas lite olika former) ---------- */

type FriendRowData = {
  id?: string;
  userId?: string;
  username?: string | null;
  displayName?: string | null;
  other?: { id?: string; userId?: string; username?: string | null; displayName?: string | null };
};

type FriendsListResp = {
  ok?: boolean;
  friends?: FriendRowData[];
  pendingIn?: { requestId: string; from: SocialUser }[];
  pendingOut?: { requestId: string; to: SocialUser }[];
};

type InviteListResp = {
  ok?: boolean;
  incoming?: GroupInviteItem[];
  outgoing?: GroupInviteItem[];
};

type MembersResp = {
  ok?: boolean;
  members?: { id?: string; userId?: string; username?: string | null; displayName?: string | null }[];
};

function parseFriendRow(row: FriendRowData): SocialUser {
  const u = row.other || row;
  return {
    id: String(u.id ?? u.userId ?? ""),
    username: u.username ?? null,
    displayName: u.displayName ?? null,
  };
}

/* ---------- fetchers ---------- */

async function fetchFriends(): Promise<void> {
  try {
    const res = await fetch("/api/friends/list", { cache: "no-store" });
    if (!res.ok) return;
    const j = (await res.json()) as FriendsListResp;
    if (!j?.ok) return;
    setState({
      friends: (j.friends ?? []).map(parseFriendRow),
      pendingIn: j.pendingIn ?? [],
      pendingOut: j.pendingOut ?? [],
      friendsReady: true,
    });
  } catch {
    /* best-effort */
  }
}

async function fetchInvites(): Promise<void> {
  try {
    const res = await fetch("/api/group/invite/list", { cache: "no-store" });
    if (!res.ok) return;
    const j = (await res.json()) as InviteListResp;
    if (!j?.ok) return;
    setState({
      invitesIncoming: j.incoming ?? [],
      invitesOutgoing: j.outgoing ?? [],
      invitesReady: true,
    });
  } catch {
    /* best-effort */
  }
}

async function fetchMembers(): Promise<void> {
  const code = readGroupCodeFromCookie();
  if (!code) {
    if (state.groupCode !== null || state.members.length > 0) {
      setState({ groupCode: null, members: [], membersReady: true });
    } else if (!state.membersReady) {
      setState({ membersReady: true });
    }
    return;
  }
  try {
    const res = await fetch(`/api/group/members?code=${encodeURIComponent(code)}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const j = (await res.json()) as MembersResp;
    if (!j?.ok || !Array.isArray(j.members)) return;
    setState({
      groupCode: code,
      members: j.members.map((m) => ({
        id: String(m.id ?? m.userId ?? ""),
        username: m.username ?? null,
        displayName: m.displayName ?? null,
      })),
      membersReady: true,
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Hämta om all socialdata nu. Anropas av pollern och efter mutationer
 * (skicka/acceptera/avvisa förfrågan eller inbjudan, join/leave grupp).
 */
export function refreshSocial(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = Promise.all([fetchFriends(), fetchInvites(), fetchMembers()])
    .then(() => undefined)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/* ---------- poller (en enda för hela appen) ---------- */

function scheduleNext() {
  if (pollTimer !== null) return;
  pollTimer = setTimeout(() => {
    pollTimer = null;
    if (pollTickets <= 0) return;
    if (typeof document !== "undefined" && document.hidden) {
      // Flik i bakgrunden: pausa — visibilitychange återupptar.
      return;
    }
    void refreshSocial().finally(() => {
      if (pollTickets > 0) scheduleNext();
    });
  }, POLL_MS);
}

function hookVisibility() {
  if (visibilityHooked || typeof document === "undefined") return;
  visibilityHooked = true;
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && pollTickets > 0) {
      void refreshSocial();
      scheduleNext();
    }
  });
}

/** Starta pollern (räknas per konsument). Returnerar stopp-funktion. */
export function startSocialPolling(): () => void {
  pollTickets += 1;
  hookVisibility();
  scheduleNext();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    pollTickets -= 1;
    if (pollTickets <= 0 && pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };
}

/** Förladda socialdata i idle time vid appstart (som swipe-korten). */
export function preloadSocialIdle() {
  const run = () => void refreshSocial();
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(run, { timeout: 3000 });
  } else {
    setTimeout(run, 500);
  }
}

/** Seeda store:n med SSR-data (första snapshot utan flash) — skriver aldrig över färskare data. */
export function hydrateSocialInitial(initial: {
  friends?: SocialUser[];
  pendingIn?: FriendRequestIn[];
  pendingOut?: FriendRequestOut[];
  members?: GroupMemberItem[];
  groupCode?: string | null;
}) {
  const patch: Partial<SocialState> = {};
  if (!state.friendsReady && initial.friends) {
    patch.friends = initial.friends;
    patch.pendingIn = initial.pendingIn ?? [];
    patch.pendingOut = initial.pendingOut ?? [];
    patch.friendsReady = true;
  }
  if (!state.membersReady && initial.members) {
    patch.members = initial.members;
    patch.groupCode = initial.groupCode ?? null;
    patch.membersReady = true;
  }
  if (Object.keys(patch).length > 0) setState(patch);
}
