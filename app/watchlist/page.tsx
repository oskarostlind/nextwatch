// app/watchlist/page.tsx
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import WatchlistClient from './WatchlistClient';
import { PageHeader } from '../components/ui/kit';
import { buildWatchlistCards, type WatchlistCard } from '@/lib/watchlistCards';

type NormalizedItem = {
  id: number;
  tmdbType: 'movie' | 'tv';
  title: string;
  year?: string;
  rating?: number;
  posterUrl: string;
  addedAt?: string;
  voteAverage?: number | null;
  popularity?: number | null;
  genreIds?: number[];
};

const DATA_URI_1x1 =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

function toClientItem(card: WatchlistCard): NormalizedItem {
  return {
    id: card.tmdbId,
    tmdbType: card.mediaType,
    title: card.title,
    year: card.year ?? undefined,
    rating: typeof card.rating === 'number' ? card.rating : undefined,
    posterUrl: card.poster ?? DATA_URI_1x1,
    addedAt: card.addedAt,
    voteAverage: card.voteAverage,
    popularity: card.popularity,
    genreIds: card.genreIds,
  };
}

// OBS: ingen intern HTTP-fetch till /api/watchlist/list här. Sidan anropade
// tidigare API:t med en återuppbyggd cookie-header — det bröts när nw_uid
// signerades (middleware normaliserar till bare-uid, den interna requesten
// underkändes och fick en NY anonym identitet → tom lista trots data).
// Nu byggs korten direkt via lib/watchlistCards, samma väg som API-routen.
async function getWatchlistServer(): Promise<NormalizedItem[]> {
  const jar = await cookies();
  const uid = jar.get('nw_uid')?.value ?? null;
  if (!uid) return [];
  try {
    const cards = await buildWatchlistCards(uid);
    return cards.map(toClientItem);
  } catch {
    return [];
  }
}

export default async function Page() {
  const items = await getWatchlistServer();

  return (
    <main className="mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 py-6">
      <PageHeader eyebrow="Din lista" title="Watchlist" subtitle="Titlar du vill se — och betyg på dem du redan sett." />
      <WatchlistClient items={items} />
    </main>
  );
}
