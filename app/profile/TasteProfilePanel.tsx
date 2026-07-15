"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TasteProfileOk } from "@/lib/tasteProfile";

type Props = {
  groupCode?: string | null;
};

function TagRow({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <div>
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/45">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={`${label}-${item}`}
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/75"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
      <div className="text-base font-semibold tabular-nums text-white/90">{value}</div>
      <div className="text-[11px] leading-tight text-white/45">{label}</div>
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

  const { inferred, stats, mode } = data;
  const { behavior } = stats;

  const seedTitles = inferred.topSeeds
    .filter((s) => s.weight > 0 && s.title)
    .map((s) => s.title as string);

  const hasBehavior = behavior.totalSwipes > 0 || behavior.ratedCount > 0;

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
          Vad algoritmen har läst ut ur {mode === "group" ? "ert" : "ditt"} beteende — inte vad
          {mode === "group" ? " ni" : " du"} kryssat i.
        </p>
      </div>

      {hasBehavior ? (
        <div className="grid grid-cols-3 gap-2">
          <Stat value={String(behavior.totalSwipes)} label="Swipes" />
          <Stat
            value={behavior.likeRatio !== null ? `${Math.round(behavior.likeRatio * 100)} %` : "–"}
            label="Gillade"
          />
          <Stat
            value={behavior.avgRating !== null ? behavior.avgRating.toFixed(1) : "–"}
            label={behavior.ratedCount > 0 ? `Snittbetyg (${behavior.ratedCount})` : "Snittbetyg"}
          />
        </div>
      ) : null}

      <div className="grid gap-3">
        <WeightedRow label="Genrer du dras till" items={inferred.genres} />
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
