// app/api/watchlist/list/route.ts
//
// Tre lägen, samma route:
//   (inget)   → full lista med TMDB-berikning. Oförändrat beteende, fallback.
//   ?meta=0   → bara DB-raderna. Klienten har metadatan i lib/titleCache och
//               behöver bara veta VILKA titlar som ligger i listan.
//   ?ids=…    → full berikning för just de nycklarna (`movie_123,tv_9`), för de
//               titlar klientens cache saknar — typiskt någon man nyss gillat.
//
// Raderna är alltid auktoritativa för medlemskap; cachen dekorerar bara. Därför
// kan en inaktuell klientcache aldrig få en titel att försvinna ur listan.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildWatchlistCards, listWatchlistRows } from "@/lib/watchlistCards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Skydd mot orimligt långa query-strängar. */
const MAX_IDS = 200;

export async function POST(req: Request) {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value ?? null;
    if (!uid) return NextResponse.json({ ok: false, items: [], message: "Ingen session" }, { status: 401 });

    const url = new URL(req.url);

    if (url.searchParams.get("meta") === "0") {
      const rows = await listWatchlistRows(uid);
      return NextResponse.json({ ok: true, rows });
    }

    const idsParam = url.searchParams.get("ids");
    if (idsParam) {
      const onlyIds = new Set(
        idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_IDS),
      );
      const items = await buildWatchlistCards(uid, { onlyIds });
      return NextResponse.json({ ok: true, items });
    }

    const items = await buildWatchlistCards(uid);
    return NextResponse.json({ ok: true, items });
  } catch {
    return NextResponse.json({ ok: false, items: [], message: "Internt fel" }, { status: 500 });
  }
}
