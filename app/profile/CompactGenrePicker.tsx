"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
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

  // Esc stänger arket.
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open]);

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
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/10"
          >
            + Lägg till genre
          </button>

          {/*
            Tidigare en absolut-positionerad meny: klipptes av föräldern på
            mobil och hade små tryckytor. Nu ett ark via portal (fixed → fångas
            inte av overflow), förankrat i botten på mobil och centrerat på
            större skärmar, med stora rader.
          */}
          {open && typeof document !== "undefined"
            ? createPortal(
                <div className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center">
                  <div
                    className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                    onClick={() => setOpen(false)}
                  />
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={`Lägg till genre — ${label}`}
                    className="relative flex max-h-[70vh] w-full flex-col rounded-t-2xl border border-white/10 bg-neutral-900 pb-[env(safe-area-inset-bottom)] shadow-xl sm:w-[min(28rem,94vw)] sm:rounded-2xl"
                  >
                    <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                      <span className="text-sm font-semibold text-white/90">Lägg till genre</span>
                      <button
                        type="button"
                        aria-label="Stäng"
                        onClick={() => setOpen(false)}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-neutral-400 transition hover:bg-white/10 hover:text-white"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 overflow-auto p-3">
                      {available.map((g) => (
                        <button
                          key={g}
                          type="button"
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-left text-sm text-white/85 transition hover:bg-white/10 active:bg-white/15"
                          onClick={() => add(g)}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>,
                document.body,
              )
            : null}
        </>
      ) : null}
    </div>
  );
}
