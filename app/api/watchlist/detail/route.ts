export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

import { tmdbLanguageFromCookies } from "@/lib/tmdbLanguage";

const TMDB_BASE = 'https://api.themoviedb.org/3';

async function tmdbGet<T>(path: string, query: string): Promise<T> {
  const v4 = process.env.TMDB_V4_TOKEN ?? process.env.TMDB_v4_TOKEN;
  const v3 = process.env.TMDB_API_KEY;
  const headersObj: Record<string, string> = {};
  const sep = path.includes('?') ? '&' : '?';
  let url = `${TMDB_BASE}${path}${sep}${query}`;
  if (v4) headersObj.Authorization = `Bearer ${v4}`;
  if (!v4 && v3) url += `${sep.includes('?') ? '' : ''}${query ? '&' : ''}api_key=${v3}`;
  if (!v4 && !v3) throw new Error('TMDB credentials missing');
  const res = await fetch(url, { headers: headersObj, cache: 'no-store' });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return (await res.json()) as T;
}

type MovieDetail = {
  overview?: string;
  runtime?: number;
};

type TvDetail = {
  overview?: string;
  episode_run_time?: number[];
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const type = searchParams.get('type'); // movie|tv
    if (!id || (type !== 'movie' && type !== 'tv')) {
      return NextResponse.json({ ok: false, message: 'Missing id or invalid type.' }, { status: 400 });
    }

    const language = await tmdbLanguageFromCookies();

    // 1) Försök på användarens språk
    let data = await tmdbGet<MovieDetail | TvDetail>(`/${type}/${id}`, `language=${encodeURIComponent(language)}`);
    let overview = data?.overview;

    // 2) Fallback till engelska om saknas
    if (!overview) {
      data = await tmdbGet<MovieDetail | TvDetail>(`/${type}/${id}`, `language=en-US`);
      overview = data?.overview;
    }

    const runtime = type === 'movie' ? (data as MovieDetail)?.runtime : undefined;
    const episode_run_time = type === 'tv' ? (data as TvDetail)?.episode_run_time : undefined;

    return NextResponse.json({ overview, runtime, episode_run_time }, { status: 200 });
  } catch (e) {
    console.error('[detail GET] ', e);
    return NextResponse.json({}, { status: 200 });
  }
}
