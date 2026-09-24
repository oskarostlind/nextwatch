// app/watchlist/page.tsx
//
// Medvetet INGEN server-hämtning av listan: den byggs med upp till 40 TMDB-
// anrop (lib/watchlistCards) och blockerade tidigare förstamålningen — det var
// den värsta "knapptryck tar lång tid"-ytan i appen. Skalet renderar direkt,
// klienten hämtar via /api/watchlist/list och visar skelett under tiden.
// Sidan är därför statiskt prerenderad och fullt prefetchbar — flikbytet
// serveras direkt ur router-cachen utan serverrundresa.

import { getTranslations } from "next-intl/server";
import WatchlistClient from "./WatchlistClient";
import { PageHeader } from "../components/ui/kit";

export default async function Page() {
  const t = await getTranslations("watchlist");
  return (
    <main className="mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 py-6">
      <PageHeader eyebrow={t("pageEyebrow")} title={t("pageTitle")} subtitle={t("pageSubtitle")} />
      <WatchlistClient />
    </main>
  );
}
