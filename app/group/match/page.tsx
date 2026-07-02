"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader, Card, Note } from "../../components/ui/kit";

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
      <div className="p-6 text-sm text-neutral-400">
        Ingen kod. Gå till <a className="text-cyan-400 underline underline-offset-2" href="/group">gruppsidan</a>.
      </div>
    );
  }
  if (err) return <div className="p-6"><Note tone="error">{err}</Note></div>;
  if (!data) return <div className="p-6 text-neutral-400">Laddar…</div>;
  if (!data.match) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <PageHeader eyebrow="Grupp" title="Ingen träff ännu" subtitle="Fortsätt svepa!" />
        <Card>
          <p className="text-sm text-neutral-400">
            Gruppstorlek: {data.size}. Kräver minst {data.need} likes på samma titel.
          </p>
        </Card>
      </div>
    );
  }

  const m = data.match;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <PageHeader
        eyebrow="Grupp"
        title="Gruppens träff"
        subtitle={`Gruppstorlek: ${data.size} · Kräver ${data.need} likes · Nuvarande: ${data.count}`}
      />
      <Card className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium text-white">
            {m.title || `TMDb #${m.tmdbId}`}{" "}
            <span className="text-xs text-neutral-500">({m.tmdbType === "movie" ? "film" : "serie"})</span>
          </div>
          {typeof m.rating === "number" && (
            <div className="text-sm text-neutral-400">★ {m.rating.toFixed(1)}</div>
          )}
        </div>
        <a
          className="shrink-0 text-sm text-cyan-400 underline underline-offset-2"
          href={`https://www.themoviedb.org/${m.tmdbType}/${m.tmdbId}`}
          target="_blank"
          rel="noreferrer"
        >
          Öppna på TMDb
        </a>
      </Card>
    </div>
  );
}
