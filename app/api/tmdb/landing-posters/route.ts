// app/api/tmdb/landing-posters/route.ts
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { LANG_COOKIE, tmdbLanguage } from "@/lib/i18nConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TmdbItem = {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path: string | null;
};
type TmdbResponse = { results: TmdbItem[] };

function pick<T>(v: T | null | undefined, fallback: T): T {
  return v == null ? fallback : v;
}
function getImageBase(size: "w185" | "w342" | "w500" | "original" = "w185"): string {
  return `https://image.tmdb.org/t/p/${size}`;
}

async function resolveRegionLocale(): Promise<{ region: string; locale: string }> {
  const c = await cookies();
  const h = await headers();

  const ipCountry = h.get("x-vercel-ip-country") ?? "";
  const accept = h.get("accept-language")?.split(",")[0] ?? "";

  const regionCookie = c.get("nw_region")?.value ?? null;

  const region = regionCookie || (/^[A-Z]{2}$/.test(ipCountry) ? ipCountry : "SE");
  // Språket kommer från nw_lang (Accept-Language används redan av middleware
  // för att gissa den cookien första gången).
  const locale = tmdbLanguage(c.get(LANG_COOKIE)?.value ?? accept);

  return { region, locale };
}

async function tmdbFetch(path: string, params: Record<string, string | number>): Promise<TmdbResponse> {
  const apiKey = process.env.TMDB_API_KEY;
  const v4 = process.env.TMDB_V4_TOKEN ?? process.env.TMDB_v4_TOKEN;

  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) usp.set(k, String(v));
  if (apiKey) usp.set("api_key", apiKey);

  const url = `https://api.themoviedb.org/3${path}?${usp.toString()}`;
  const res = await fetch(url, {
    headers: v4 ? { Authorization: `Bearer ${v4}` } : undefined,
    next: { revalidate: 60 * 15 },
  });
  if (!res.ok) throw new Error(`TMDB error ${res.status} on ${path}`);
  return (await res.json()) as TmdbResponse;
}

export async function GET() {
  // Regler: alltid await cookies() i App Router (server)
  await cookies();

  const { region, locale } = await resolveRegionLocale();

  const [trending, popularMovies, popularTv] = await Promise.all([
    tmdbFetch("/trending/all/day", { region, language: locale }),
    tmdbFetch("/movie/popular", { region, language: locale, page: 1 }),
    tmdbFetch("/tv/popular", { region, language: locale, page: 1 }),
  ]);

  const base = getImageBase("w185"); // mindre posters → bättre LCP

  const posters = [...trending.results, ...popularMovies.results, ...popularTv.results]
    .filter((x) => x && x.poster_path)
    .map((x) => ({
      id: x.id,
      title: pick(x.title ?? x.name, "Untitled"),
      year: pick((x.release_date ?? x.first_air_date ?? "").slice(0, 4), ""),
      src: `${base}${x.poster_path}`,
    }));

  const unique = new Map<number, { id: number; title: string; year: string; src: string }>();
  for (const p of posters) {
    if (!unique.has(p.id)) unique.set(p.id, p);
    if (unique.size >= 24) break; // färre initialt → snabbare första render
  }

  // `private` med flit, INTE `public, s-maxage`: resolveRegionLocale() läser
  // nw_region/nw_locale (och accept-language) medan URL:en alltid är densamma,
  // så ett delat CDN-svar hade serverat den första besökarens region/språk till
  // alla i 15 minuter. TMDB-anropen är redan datacachade server-side
  // (revalidate 15 min); private ger klientens egen HTTP-cache utan att blanda
  // ihop besökare.
  return NextResponse.json(
    { ok: true, posters: Array.from(unique.values()) },
    { headers: { "Cache-Control": "private, max-age=900" } },
  );
}
