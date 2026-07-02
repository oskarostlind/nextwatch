// app/watchlist/page.tsx
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { cookies, headers } from 'next/headers';
import WatchlistClient from './WatchlistClient';
import { PageHeader } from '../components/ui/kit';

type UnknownRecord = Record<string, unknown>;

type ApiResponse =
  | { ok: true; items: UnknownRecord[] }
  | { ok: false; message?: string };

type NormalizedItem = {
  id: number;
  tmdbType: 'movie' | 'tv';
  title: string;
  year?: string;
  rating?: number;
  posterUrl: string;
};

const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p/w500';
const DATA_URI_1x1 =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

/** Forward all cookies to the API route so the user is identified on the server */
async function buildCookieHeader(): Promise<string> {
  const jar = await cookies();
  const all = jar.getAll();
  return all.map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join('; ');
}

/** Safe number parser for unknown JSON fields */
function getNumber(obj: UnknownRecord, key: string): number | undefined {
  const v = obj[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

/** Safe string getter for unknown JSON fields */
function getString(obj: UnknownRecord, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function pickTitle(o: UnknownRecord): string {
  return getString(o, 'title') ?? getString(o, 'name') ?? 'Okänd titel';
}

function pickYear(o: UnknownRecord): string | undefined {
  return (
    getString(o, 'year') ??
    getString(o, 'releaseYear') ??
    (getString(o, 'release_date')?.slice(0, 4)) ??
    (getString(o, 'first_air_date')?.slice(0, 4)) ??
    undefined
  );
}

function pickType(o: UnknownRecord): 'movie' | 'tv' {
  const raw =
    getString(o, 'tmdbType') ??
    getString(o, 'type') ??
    getString(o, 'media_type') ??
    '';
  const s = raw.toLowerCase();
  if (s === 'movie' || s === 'tv') return s;
  // Heuristik: om first_air_date finns → tv, annars movie
  return getString(o, 'first_air_date') ? 'tv' : 'movie';
}

function pickPosterUrl(o: UnknownRecord): string {
  const v =
    getString(o, 'posterUrl') ??
    getString(o, 'poster') ??
    getString(o, 'poster_path') ??
    getString(o, 'posterPath') ??
    '';

  if (v.startsWith('http://') || v.startsWith('https://')) return v;
  if (v.startsWith('/')) return `${TMDB_IMG_BASE}${v}`;
  return DATA_URI_1x1; // trygg fallback så vi aldrig visar trasig bild
}

function pickRating(o: UnknownRecord): number | undefined {
  return getNumber(o, 'rating') ?? getNumber(o, 'vote_average') ?? getNumber(o, 'score');
}

function normalize(raw: UnknownRecord): NormalizedItem | null {
  const id =
    getNumber(raw, 'tmdbId') ??
    getNumber(raw, 'id') ??
    getNumber(raw, 'tmdb_id');

  if (typeof id !== 'number') return null;

  const tmdbType = pickType(raw);
  const title = pickTitle(raw);
  const year = pickYear(raw);
  const rating = pickRating(raw);
  const posterUrl = pickPosterUrl(raw);

  return { id, tmdbType, title, year, rating, posterUrl };
}

async function getWatchlistServer(): Promise<NormalizedItem[]> {
  // I din miljö är headers() asynkront typat – vänta in det
  const hdrs = await headers();
  const host = hdrs.get('host') ?? 'localhost:3000';
  const proto =
    hdrs.get('x-forwarded-proto') ??
    (host.includes('localhost') ? 'http' : 'https');

  const url = `${proto}://${host}/api/watchlist/list`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Cookie: await buildCookieHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}), // om din route förväntar body
    cache: 'no-store',
  });

  if (!res.ok) return [];
  const data = (await res.json()) as ApiResponse;
  if (!('ok' in data) || !data.ok) return [];
  return data.items.map(normalize).filter((x): x is NormalizedItem => x !== null);
}

export default async function Page() {
  const items = await getWatchlistServer();

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <PageHeader eyebrow="Din lista" title="Watchlist" subtitle="Titlar du gillat och vill se." />
      <WatchlistClient items={items} />
    </main>
  );
}
