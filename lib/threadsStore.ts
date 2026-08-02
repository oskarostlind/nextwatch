// lib/threadsStore.ts
//
// EN delad poll av /api/share/threads. Tidigare pollade BottomTabs (30s, med
// intervall-reset på varje route-byte) och FriendsTab (15s) samma endpoint
// parallellt, och ShareTitleModal + SharedTipsInbox gjorde egna engångshämt-
// ningar. Nu: modul-singleton med prenumerationsräkning — pollen (30s) lever
// bara medan någon lyssnar, och alla ytor läser samma snapshot.

import { useSyncExternalStore } from "react";

export type ShareThread = {
  friendId: string;
  lastTitle: string;
  lastAt: string;
  unseen: number;
  lastFromMe?: boolean;
  username: string | null;
  displayName: string | null;
  avatarId: string | null;
};

export type ThreadsState = {
  threads: ShareThread[];
  /** Falskt tills första svaret — ytor kan skilja "laddar" från "tomt". */
  ready: boolean;
};

const POLL_MS = 30_000;

let state: ThreadsState = { threads: [], ready: false };
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;

function emit() {
  listeners.forEach((l) => l());
}

export function getThreadsSnapshot(): ThreadsState {
  return state;
}

/** Hämta en gång (dedupat). Anropas av pollen och vid t.ex. stängd chatt. */
export function refreshThreads(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/share/threads", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { ok?: boolean; threads?: ShareThread[] };
      if (j.ok) {
        state = { threads: j.threads ?? [], ready: true };
        emit();
      }
    } catch {
      /* nätverksfel — behåll senaste snapshot */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function subscribeThreads(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshThreads();
    pollTimer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        void refreshThreads();
      }
    }, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

/** Hook för klientkomponenter — alla läser samma snapshot och delar pollen. */
export function useShareThreads(): ThreadsState {
  return useSyncExternalStore(subscribeThreads, getThreadsSnapshot, getThreadsSnapshot);
}
