// app/recs/useUnifiedRecs.ts
"use client";

import { clientMsg } from "@/lib/clientMessages";
import { useEffect, useState } from "react";

export type MediaKind = "movie" | "tv";

export type SimpleItem = {
  id: number;
  tmdbType: MediaKind;
  title: string;
  year?: string;
  poster_path?: string | null;
  vote_average?: number;
};

export type UnifiedResp =
  | {
      ok: true;
      mode: "group" | "individual";
      group: { code: string; strictProviders: boolean } | null;
      language: string;
      region: string;
      usedProviderIds: number[];
      items: SimpleItem[];
    }
  | { ok: false; message?: string };

export function useUnifiedRecs(page: number) {
  const [items, setItems] = useState<SimpleItem[]>([]);
  const [mode, setMode] = useState<"group" | "individual">("individual");
  const [group, setGroup] = useState<{ code: string; strictProviders: boolean } | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/recs/unified?page=${page}`, { cache: "no-store" });
        if (!res.ok) {
          let message = clientMsg("recsLoadFailed");
          try {
            const body = (await res.json()) as { message?: string };
            if (body?.message) message = body.message;
          } catch { /* ignore */ }
          if (alive) setErr(message);
          return;
        }
        const data = (await res.json()) as UnifiedResp;
        if (!("ok" in data) || !data.ok) {
          if (alive) setErr(clientMsg("recsLoadFailed"));
          return;
        }
        if (!alive) return;
        setItems(data.items);
        setMode(data.mode);
        setGroup(data.group);
      } catch {
        if (alive) setErr(clientMsg("networkError"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [page]);

  return { items, mode, group, loading, error: err };
}

/** Skicka röst till grupp-läget (no-op om ingen aktiv grupp på servern). */
export async function sendGroupVote(params: {
  tmdbId: number;
  tmdbType: MediaKind;
  vote: "LIKE" | "DISLIKE" | "SKIP";
}): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch("/api/group/vote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    try {
      const body = (await res.json()) as { message?: string };
      return { ok: false, message: body?.message ?? clientMsg("voteFailed") };
    } catch {
      return { ok: false, message: clientMsg("voteFailed") };
    }
  }
  return (await res.json()) as { ok: boolean; message?: string };
}
