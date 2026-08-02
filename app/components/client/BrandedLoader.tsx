"use client";

/**
 * Neutral, varumärkt laddningsvy — visas i stället för inloggningsvyn medan
 * AuthGate väntar på sessionskollen. Ska likna den native launch-skärmen
 * (svart bakgrund, se capacitor.config.ts) så bytet native splash → den här →
 * riktigt innehåll inte syns som ett hopp.
 */
export default function BrandedLoader() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-black">
      <span className="text-2xl font-bold tracking-tight text-white">
        Next<span className="text-cyan-400">Watch</span>
      </span>
      <span
        aria-hidden
        className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-cyan-400"
      />
    </div>
  );
}
