// app/components/ui/ErrorScene.tsx
//
// Bilden ovanför 404- och felvyerna: en liten kortlek i swipe-vyns stil, med
// statusen ("404", "!") på översta kortet. Ren markup utan hooks, så den kan
// användas både i server-komponenten not-found.tsx och i klientkomponenten
// error.tsx. global-error.tsx kan inte lita på Tailwind och ritar sin egen.
export default function ErrorScene({ label }: { label: string }) {
  return (
    <div aria-hidden className="relative mb-2 h-40 w-28">
      <div className="absolute inset-0 -translate-x-6 -rotate-12 rounded-2xl border border-white/10 bg-neutral-900" />
      <div className="absolute inset-0 translate-x-6 rotate-12 rounded-2xl border border-white/10 bg-neutral-800/70" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/15 bg-gradient-to-b from-neutral-700 to-neutral-900 shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
        <span className="text-4xl font-semibold tracking-tight text-white">{label}</span>
        <span className="h-1 w-10 rounded-full bg-white/20" />
      </div>
    </div>
  );
}
