"use client";

import { useMemo, useState } from "react";
import { Chip } from "@/app/components/ui/kit";
import { ALL_GENRES_SV } from "./profileGenres";

type Props = {
  label: string;
  hint?: string;
  tone: "like" | "dislike";
  selected: string[];
  excluded: string[];
  onChange: (next: string[]) => void;
};

export default function CompactGenrePicker({
  label,
  hint,
  tone,
  selected,
  excluded,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const available = useMemo(
    () => ALL_GENRES_SV.filter((g) => !selected.includes(g) && !excluded.includes(g)),
    [selected, excluded],
  );

  const add = (genre: string) => {
    onChange([...selected, genre]);
    setOpen(false);
  };

  const remove = (genre: string) => {
    onChange(selected.filter((g) => g !== genre));
  };

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <label className="text-sm text-white/70">{label}</label>
        {hint ? <span className="text-xs text-white/40">{hint}</span> : null}
      </div>

      {selected.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((g) => (
            <Chip key={g} tone={tone} selected onClick={() => remove(g)}>
              {g} ×
            </Chip>
          ))}
        </div>
      ) : (
        <p className="mb-2 text-xs text-white/40">Inga valda ännu.</p>
      )}

      {available.length > 0 ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/10"
          >
            + Lägg till genre
          </button>
          {open ? (
            <div className="absolute z-20 mt-1 max-h-48 w-full min-w-[12rem] overflow-auto rounded-xl border border-white/10 bg-neutral-950/95 p-1 shadow-lg backdrop-blur">
              {available.map((g) => (
                <button
                  key={g}
                  type="button"
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10"
                  onClick={() => add(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
