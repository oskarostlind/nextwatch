export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';

type Provider = {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
  display_priority?: number;
};

type ProviderResult = {
  link?: string;
  flatrate?: Provider[];
  rent?: Provider[];
  buy?: Provider[];
};

type ProvidersResp = {
  results?: Record<string, ProviderResult>;
};

const TMDB_BASE = 'https://api.themoviedb.org/3';

async function tmdbGet<T>(path: string): Promise<T> {
  const v4 = process.env.TMDB_V4_TOKEN ?? process.env.TMDB_v4_TOKEN;
  const v3 = process.env.TMDB_API_KEY;
  const headersObj: Record<string, string> = {};
  let url = `${TMDB_BASE}${path}`;
  if (v4) headersObj.Authorization = `Bearer ${v4}`;
  if (!v4 && v3) url += `${path.includes('?') ? '&' : '?'}api_key=${v3}`;
  if (!v4 && !v3) throw new Error('TMDB credentials missing');
  const res = await fetch(url, { headers: headersObj, cache: 'no-store' });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return (await res.json()) as T;
}

function pickCountry(h: string | null): string | null {
  if (!h) return null;
  const m = h.match(/-([A-Z]{2})/);
  return m?.[1] ?? null;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id') ?? undefined;
    const type = (searchParams.get('type') as 'movie' | 'tv' | null) ?? undefined;
    if (!id || !type) {
      return NextResponse.json({ ok: false, message: 'Missing id or type (movie|tv).' }, { status: 400 });
    }

    const jar = await cookies();
    const hdr = await headers();

    const region =
      jar.get('nw_region')?.value ||
      hdr.get('x-vercel-ip-country') ||
      pickCountry(hdr.get('accept-language')) ||
      'SE';

    const data = await tmdbGet<ProvidersResp>(`/${type}/${id}/watch/providers`);
    const result: ProviderResult | undefined = data.results?.[region];

    return NextResponse.json(
      {
        ok: true,
        region,
        providers: result ?? null,
      },
      { status: 200 }
    );
  } catch (e) {
    console.error('[providers GET] ', e);
    return NextResponse.json({ ok: false, message: 'Failed to load watch providers.' }, { status: 200 });
  }
}
