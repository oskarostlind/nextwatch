"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type MediaType = "movie" | "tv";

export type ProviderLink = {
  name: string;
  url: string;
};

export type GroupMatchItem = {
  tmdbId: number;
  tmdbType: MediaType;
  title: string;
  year?: number;
  rating?: number;
  poster?: string;
  overview?: string;
  providers?: ProviderLink[];
};

type GroupMatchResponse =
  | {
      ok: true;
      size: number; // group members
      need: number; // threshold
      count: number; // current likes for top candidate
      match: GroupMatchItem | null;
      matches?: GroupMatchItem[];
    }
  | {
      ok: false;
      error: string;
    };

function getCookieValue(name: string): string | undefined {
  // Robust cookie-läsning (klientsida)
  const parts = document.cookie.split(";").map((x) => x.trim());
  const found = parts.find((p) => p.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.split("=", 2)[1]) : undefined;
}

export function useGroupMatchPolling() {
  const [open, setOpen] = useState(false);
  const [item, setItem] = useState<GroupMatchItem | null>(null);
  const [groupCode, setGroupCode] = useState<string | undefined>(undefined);

  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const retryRef = useRef<number | null>(null);
  const voteDebounceRef = useRef<number | null>(null);

  // Hämta ev. befintlig grupp direkt
  useEffect(() => {
    setGroupCode(getCookieValue("nw_group"));
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (retryRef.current !== null) {
      window.clearTimeout(retryRef.current);
      retryRef.current = null;
    }
    if (voteDebounceRef.current !== null) {
      window.clearTimeout(voteDebounceRef.current);
      voteDebounceRef.current = null;
    }
  }, []);

  const fetchOnce = useCallback(async () => {
    // Läs cookie varje gång för att dynamiskt ta uppdaterad grupp
    const current = getCookieValue("nw_group");
    if (current !== groupCode) {
      setGroupCode(current);
    }

    if (!current || busyRef.current) return;
    busyRef.current = true;

    try {
      const url = `/api/group/match?code=${encodeURIComponent(current)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 429) {
        // Rate-limitad (t.ex. mitt i snabb swipe). Ge inte upp tyst – schemalägg
        // EN kort retry så att en match inte missas bara för att pollen råkade 429:a.
        if (retryRef.current === null) {
          retryRef.current = window.setTimeout(() => {
            retryRef.current = null;
            void fetchOnce();
          }, 2_000);
        }
        return;
      }
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as GroupMatchResponse;
      if (data.ok && data.match) {
        setItem(data.match);
        setOpen(true);
      }
    } catch {
      // silent
    } finally {
      busyRef.current = false;
    }
  }, [groupCode]);

  const start = useCallback(() => {
    if (timerRef.current !== null) return;
    // gör en första koll direkt
    void fetchOnce();
    timerRef.current = window.setInterval(fetchOnce, 8_000);
  }, [fetchOnce]);

  // Starta/stoppa polling beroende på om vi har gruppkod
  useEffect(() => {
    if (!groupCode) {
      // Ingen grupp → ingen polling
      stop();
      return;
    }
    start();
    return stop;
  }, [groupCode, start, stop]);

  // Kör en extra koll när fliken blir synlig igen
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void fetchOnce();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchOnce]);

  const dismiss = useCallback(() => {
    setOpen(false);
    setItem(null);
  }, []);

  const notifyVoted = useCallback(() => {
    // Trigga en extra koll när någon röstat, men debounca så att snabb swipe
    // (1 röst per kort) inte spammar /api/group/match och spränger rate-limiten.
    if (voteDebounceRef.current !== null) {
      window.clearTimeout(voteDebounceRef.current);
    }
    voteDebounceRef.current = window.setTimeout(() => {
      voteDebounceRef.current = null;
      void fetchOnce();
    }, 800);
  }, [fetchOnce]);

  return useMemo(
    () => ({
      open,
      item,
      dismiss,
      notifyVoted,
      hasGroup: Boolean(groupCode),
      groupCode: groupCode ?? undefined,
    }),
    [dismiss, item, notifyVoted, open, groupCode]
  );
}
