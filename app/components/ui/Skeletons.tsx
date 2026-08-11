// app/components/ui/Skeletons.tsx
//
// Delade laddningsskelett för loading.tsx-filerna. Alla tunga sidor är
// force-dynamic och blockerade tidigare förstamålningen på serverarbete — utan
// loading.tsx frös den gamla skärmen tills servern var klar, vilket var
// "knapptryck tar lång tid"-känslan. Skeletten ger omedelbar respons.

function Pulse({ className = "" }: { className?: string }) {
  // bg-white/10: /5 dimmades ned till nästan osynligt av animate-pulse på #0a0a0a.
  return <div className={`animate-pulse rounded-xl bg-white/10 ${className}`} />;
}

/** Rubrik + undertext — matchar PageHeader-ytan. */
export function HeaderSkeleton() {
  return (
    <div className="mb-6 grid gap-2">
      <Pulse className="h-3 w-24" />
      <Pulse className="h-8 w-40" />
      <Pulse className="h-4 w-64" />
    </div>
  );
}

/** Grid med poster-kort (2/3-format) — watchlist/discover-layouten. */
export function PosterGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: count }, (_, i) => (
        <Pulse key={i} className="aspect-[2/3] w-full" />
      ))}
    </div>
  );
}

/** Radlista — grupp/vänner-layouten. */
export function RowsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-2">
      {Array.from({ length: count }, (_, i) => (
        <Pulse key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

/** Ett stort kort — swipe-ytan. */
export function CardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <Pulse className="aspect-[2/3] w-full max-w-[420px] rounded-2xl" />
    </div>
  );
}

export function PageSkeleton({ variant }: { variant: "grid" | "rows" | "card" }) {
  return (
    <main className="mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 py-6">
      <HeaderSkeleton />
      {variant === "grid" ? <PosterGridSkeleton /> : variant === "rows" ? <RowsSkeleton /> : <CardSkeleton />}
    </main>
  );
}
