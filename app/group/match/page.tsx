"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function GroupMatchPage() {
  return (
    <Suspense fallback={<div className="p-6">Laddar…</div>}>
      <GroupMatchInner />
    </Suspense>
  );
}

type MatchItem = {
  tmdbId: number;
  tmdbType: "movie" | "tv";
  title: string;
  year?: number;
  rating?: number;
};

type MatchResponse = {
  ok: boolean;
  need: number;
  size: number;
  count: number;
  match: MatchItem | null;
  message?: string;
};

function GroupMatchInner() {
  const sp = useSearchParams();
  const code = sp?.get("code") || "";
  const [data, setData] = useState<MatchResponse | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!code) return;
    fetch(`/api/group/match?code=${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .then((js: MatchResponse) => (js.ok ? setData(js) : setErr(js.message || "Fel")))
      .catch((e) => setErr(String(e)));
  }, [code]);

  if (!code) {
    return (
      <div className="p-6">
        Ingen kod. Gå till <a className="underline" href="/group">/group</a>.
      </div>
    );
  }
  if (err) return <div className="p-6 text-red-500">{err}</div>;
  if (!data) return <div className="p-6">Laddar…</div>;
  if (!data.match) {
    return (
      <div className="p-6">
        Inga träffar ännu. Fortsätt svepa!
        <div className="mt-2 text-sm opacity-70">
          Gruppstorlek: {data.size}. Kräver minst {data.need} likes.
        </div>
      </div>
    );
  }

  const m = data.match;

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-6">
      <h1 className="text-2xl font-bold">Gruppens träff</h1>
      <div className="text-sm opacity-70">
        Gruppstorlek: {data.size}. Kräver minst {data.need} likes. Nuvarande: {data.count}.
      </div>
      <div className="flex items-center justify-between rounded border p-3">
        <div>
          <div className="font-medium">
            {m.title || `TMDb #${m.tmdbId}`}{" "}
            <span className="text-xs opacity-60">({m.tmdbType})</span>
          </div>
          {typeof m.rating === "number" && (
            <div className="text-sm opacity-70">Betyg: {m.rating.toFixed(1)}</div>
          )}
        </div>
        <a
          className="text-sm underline"
          href={`https://www.themoviedb.org/${m.tmdbType}/${m.tmdbId}`}
          target="_blank"
          rel="noreferrer"
        >
          Öppna på TMDb
        </a>
      </div>
    </div>
  );
}
