// app/api/push/action/route.ts
//
// Låsskärmsknapparna på en push (Spara / Nej / Sett / Ta bort) landar här. Anropet
// görs av native iOS-kod i bakgrunden, så det finns INGEN nw_uid-cookie —
// identiteten kommer ur den signerade token som följde med pushen (data.act,
// se lib/pushActionToken.ts). Skrivningarna speglar appens egna vägar:
//   save   = solo-swipens like (/api/swipe/decide): beslut "like" + watchlist-rad
//   nope   = beslut "dislike"
//   seen   = som att betygsätta (/api/ratings/save): beslut "seen" och bort ur att-se-listan
//   remove = watchlist-kryssets /api/watchlist/remove

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { saveSwipeDecision } from "@/lib/swipeDecision";
import { verifyPushAction } from "@/lib/pushActionToken";
import { rateLimitAllow } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "save" | "nope" | "seen" | "remove";
const ACTIONS: readonly Action[] = ["save", "nope", "seen", "remove"];

// Lätt tak per användare: en knapptryckning är ett anrop, så detta stoppar bara missbruk.
const ACTION_LIMIT = 20; // per minut

export async function POST(req: Request) {
  let body: { token?: unknown; action?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const action = ACTIONS.find((a) => a === body.action);
  if (!action) return NextResponse.json({ ok: false, error: "bad_action" }, { status: 400 });

  const claims = typeof body.token === "string" ? verifyPushAction(body.token) : null;
  if (!claims) return NextResponse.json({ ok: false, error: "bad_token" }, { status: 401 });

  if (!rateLimitAllow(claims.uid, "push-action", { limit: ACTION_LIMIT })) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const { uid, tmdbId, mediaType } = claims;
  try {
    switch (action) {
      case "save": {
        await saveSwipeDecision({ userId: uid, tmdbId, mediaType, decision: "like" });
        await prisma.watchlist.upsert({
          where: { userId_tmdbId_mediaType: { userId: uid, tmdbId, mediaType } },
          update: {},
          create: { id: crypto.randomUUID(), userId: uid, tmdbId, mediaType },
        });
        break;
      }
      case "nope": {
        await saveSwipeDecision({ userId: uid, tmdbId, mediaType, decision: "dislike" });
        break;
      }
      case "seen": {
        // Ett redan satt betyg (decision "RATED") ska inte skrivas över av ett "sett"-svep.
        const existing = await prisma.rating.findUnique({
          where: { userId_tmdbId_mediaType: { userId: uid, tmdbId, mediaType } },
          select: { decision: true },
        });
        if (existing?.decision !== "RATED") {
          await saveSwipeDecision({ userId: uid, tmdbId, mediaType, decision: "seen" });
        }
        // Sedd = bort ur att-se-listan, samma som när man betygsätter från watchlisten.
        await prisma.watchlist.deleteMany({ where: { userId: uid, tmdbId, mediaType } });
        break;
      }
      case "remove": {
        await prisma.watchlist.deleteMany({ where: { userId: uid, tmdbId, mediaType } });
        break;
      }
    }
  } catch (e) {
    console.warn("[push/action] misslyckades:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "failed" }, { status: 500 });
  }

  // Statistik är best-effort — en misslyckad logg får inte ge ett fel på en lyckad åtgärd.
  if (claims.pid) {
    const now = new Date();
    try {
      await prisma.pushLog.updateMany({
        where: { id: claims.pid, userId: uid },
        data: { action, actionAt: now },
      });
      // Att trycka på en knapp räknas också som att ha öppnat notisen.
      await prisma.pushLog.updateMany({
        where: { id: claims.pid, userId: uid, openedAt: null },
        data: { openedAt: now },
      });
    } catch {
      /* ignoreras */
    }
  }

  return NextResponse.json({ ok: true });
}
