"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TasteProfileOk } from "@/lib/tasteProfile";

type Props = {
  groupCode?: string | null;
};

function TagRow({ label, items, tone }: { label: string; items: string[]; tone?: "like" | "dislike" | "neutral" }) {
  if (items.length === 0) return null;
  const color =
    tone === "like"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : tone === "dislike"
        ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
        : "border-white/10 bg-white/5 text-white/75";

  return (
    <div>
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/45">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={`${label}-${item}`} className={`rounded-lg border px-2 py-0.5 text-xs ${color}`}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function WeightedRow({
  label,
  items,
}: {
  label: string;
  items: { name: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/45">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={`${label}-${item.name}`}
            className="rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-100"
          >
            {item.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function TasteProfilePanel({ groupCode = null }: Props) {
  const [data, setData] = useState<TasteProfileOk | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(null);

    const qs = groupCode ? `?group=${encodeURIComponent(groupCode)}` : "";
    void fetch(`/api/profile/taste${qs}`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json()) as TasteProfileOk | { ok: false; message?: string };
        if (ignore) return;
        if (!res.ok || !json.ok) {
          setError("message" in json && json.message ? json.message : "Kunde inte ladda smakprofil.");
          setData(null);
          return;
        }
        setData(json);
      })
      .catch(() => {
        if (!ignore) setError("Nätverksfel.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [groupCode]);

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-sm text-white/50">Analyserar din smak…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
        <p className="text-sm text-rose-200">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { explicit, inferred, stats, mode } = data;
  const favorites = [
    explicit.favoriteMovie?.title,
    explicit.favoriteShow?.title,
  ].filter((t): t is string => Boolean(t));

  const seedTitles = inferred.topSeeds
    .filter((s) => s.weight > 0 && s.title)
    .map((s) => s.title as string);

  if (!stats.hasEnoughData) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="mb-1 text-sm font-semibold text-white/90">
          {mode === "group" ? "Er gruppsmak" : "Din smakprofil"}
        </h3>
        <p className="text-sm text-white/55">
          Swipa, betygsätt och fyll i favoriter nedan — då bygger vi en profil åt dig.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4">
      <div>
        <h3 className="text-sm font-semibold text-white/90">
          {mode === "group" ? "Er gruppsmak" : "Din smakprofil"}
        </h3>
        <p className="mt-0.5 text-xs text-white/45">
          Så här tolkar algoritmen {mode === "group" ? "ert sällskap" : "dig"} just nu.
        </p>
      </div>

      <div className="grid gap-3">
        <TagRow label="Gillar" items={explicit.likedGenres} tone="like" />
        <TagRow label="Undviker" items={explicit.dislikedGenres} tone="dislike" />
        <TagRow label="Favoriter" items={favorites} />
        <TagRow label="Streaming" items={explicit.providers} />
        <WeightedRow label="Regissörer / skapare" items={inferred.directors} />
        <WeightedRow label="Skådespelare" items={inferred.cast} />
        <WeightedRow label="Teman" items={inferred.keywords} />
        <TagRow label="Baserat på" items={seedTitles} />
      </div>

      <p className="text-xs text-white/40">
        Stämmer något inte? Justera under &quot;Redigera smak&quot; nedan.
        {mode === "individual" ? (
          <>
            {" "}
            <Link href="/swipe" className="text-cyan-300/80 underline-offset-2 hover:underline">
              Swipa mer
            </Link>{" "}
            för att finslipa profilen.
          </>
        ) : null}
      </p>
    </div>
  );
}
