"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Bell, BellRing, CalendarClock } from "lucide-react";
import { PageHeader, Note } from "../components/ui/kit";
import { canRemind, scheduleReleaseReminder, cancelReleaseReminder } from "@/lib/filmReminders";

type Item = {
  id: number;
  title: string;
  releaseDate: string;
  poster: string | null;
  overview: string;
};

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("sv-SE", { day: "numeric", month: "long", year: "numeric" });
}

export default function ComingSoonClient() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [reminded, setReminded] = useState<Set<number>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [native, setNative] = useState(false);

  useEffect(() => {
    setNative(canRemind());
    fetch("/api/tmdb/upcoming", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setItems(j?.ok ? (j.items as Item[]) : []))
      .catch(() => setItems([]));
  }, []);

  async function toggleReminder(it: Item) {
    setNote(null);
    if (reminded.has(it.id)) {
      await cancelReleaseReminder(it.id);
      setReminded((prev) => {
        const next = new Set(prev);
        next.delete(it.id);
        return next;
      });
      return;
    }
    const res = await scheduleReleaseReminder({ tmdbId: it.id, title: it.title, releaseDate: it.releaseDate });
    if (res.ok) {
      setReminded((prev) => new Set(prev).add(it.id));
    } else if (res.message) {
      setNote(res.message);
    }
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-y-auto px-4 py-6">
      <PageHeader eyebrow="På gång" title="Kommer snart" subtitle="Nya filmer på väg – få en påminnelse när de släpps." />

      {!native && (
        <Note tone="info">Påminnelser kan sättas i iOS-appen. Här ser du vad som är på väg.</Note>
      )}
      {note && <Note tone="error">{note}</Note>}

      {items === null ? (
        <p className="py-10 text-center text-sm text-white/50">Laddar…</p>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-sm text-white/50">Inga kommande titlar hittades just nu.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {items.map((it) => {
            const isReminded = reminded.has(it.id);
            return (
              <div key={it.id} className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                <div className="relative aspect-[2/3] bg-white/5">
                  {it.poster ? (
                    <Image src={it.poster} alt={it.title} fill sizes="(max-width:768px) 45vw, 220px" className="object-cover" unoptimized />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-white/30">Ingen bild</div>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <p className="line-clamp-2 text-sm font-semibold text-white/90" title={it.title}>
                    {it.title}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-white/50">
                    <CalendarClock className="h-3.5 w-3.5" /> {formatDate(it.releaseDate)}
                  </p>
                  {native && (
                    <button
                      type="button"
                      onClick={() => void toggleReminder(it)}
                      className={
                        isReminded
                          ? "mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-300"
                          : "mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-semibold text-black transition hover:bg-cyan-400"
                      }
                    >
                      {isReminded ? (
                        <>
                          <BellRing className="h-3.5 w-3.5" /> Påminns
                        </>
                      ) : (
                        <>
                          <Bell className="h-3.5 w-3.5" /> Påminn mig
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
