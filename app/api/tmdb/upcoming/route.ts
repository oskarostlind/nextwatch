// app/api/tmdb/upcoming/route.ts
//
// Kommande biopremiärer/släpp från TMDB, filtrerat till framtida datum och
// sorterat närmast först. Cachas några timmar (listan ändras långsamt).
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TmdbUpcoming = {
  results?: Array<{
    id: number;
    title?: string;
    release_date?: string;
    poster_path?: string | null;
    overview?: string;
  }>;
};

export async function GET() {
  const jar = await cookies();
  const regionRaw = jar.get("nw_region")?.value ?? "";
  const region = /^[A-Z]{2}$/.test(regionRaw) ? regionRaw : "SE";
  const localeRaw = jar.get("nw_locale")?.value ?? "";
  const locale = /^[a-z]{2}(-[A-Z]{2})?$/.test(localeRaw) ? localeRaw : "sv-SE";

  const v4 = process.env.TMDB_V4_TOKEN ?? process.env.TMDB_READ_TOKEN;
  const apiKey = process.env.TMDB_API_KEY;

  const usp = new URLSearchParams({ language: locale, region });
  if (apiKey) usp.set("api_key", apiKey);

  try {
    const res = await fetch(`https://api.themoviedb.org/3/movie/upcoming?${usp.toString()}`, {
      headers: v4 ? { Authorization: `Bearer ${v4}` } : undefined,
      next: { revalidate: 60 * 60 * 6 }, // 6h
    });
    if (!res.ok) return NextResponse.json({ ok: false, items: [] }, { status: 200 });

    const data = (await res.json()) as TmdbUpcoming;
    const today = new Date().toISOString().slice(0, 10);

    const items = (data.results ?? [])
      .filter((m) => m.release_date && m.release_date >= today && m.title)
      .sort((a, b) => (a.release_date! < b.release_date! ? -1 : 1))
      .slice(0, 30)
      .map((m) => ({
        id: m.id,
        title: m.title!,
        releaseDate: m.release_date!,
        poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
        overview: m.overview ?? "",
      }));

    // `private` med flit, INTE `public, s-maxage`: svaret varierar med
    // nw_region/nw_locale (cookies) men URL:en är alltid densamma, så ett delat
    // CDN-svar hade serverat den första besökarens region/språk till alla i sex
    // timmar. TMDB-hämtningen ovan är redan datacachad server-side (revalidate
    // 6 h), så det som återstår att vinna är WKWebView:s egen HTTP-cache — och
    // den får vi med private.
    return NextResponse.json(
      { ok: true, region, items },
      { headers: { "Cache-Control": "private, max-age=21600, stale-while-revalidate=3600" } },
    );
  } catch {
    return NextResponse.json({ ok: false, items: [] }, { status: 200 });
  }
}
