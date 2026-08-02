// app/watchlist/page.tsx
//
// Medvetet INGEN server-hämtning av listan: den byggs med upp till 40 TMDB-
// anrop (lib/watchlistCards) och blockerade tidigare förstamålningen — det var
// den värsta "knapptryck tar lång tid"-ytan i appen. Skalet renderar direkt,
// klienten hämtar via /api/watchlist/list och visar skelett under tiden.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import WatchlistClient from "./WatchlistClient";
import { PageHeader } from "../components/ui/kit";

export default function Page() {
  return (
    <main className="mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 py-6">
      <PageHeader eyebrow="Din lista" title="Watchlist" subtitle="Titlar du vill se — och betyg på dem du redan sett." />
      <WatchlistClient />
    </main>
  );
}
