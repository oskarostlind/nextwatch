// "Bevaka" (WatchNowButton): bevakning av en titel som inte går att streama
// på användarens tjänster än. Sparas i release_follows med kind="stream";
// cronen i app/api/cron/daily-recs pushar när den dyker upp (lib/streamFollows.ts).
//
//   GET    ?tmdbId=&mediaType=        → { ok, following }
//   POST   { tmdbId, mediaType, title } → bevaka
//   DELETE { tmdbId, mediaType }        → sluta bevaka

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { apiMsg } from "@/lib/apiMessages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Key = { tmdbId: number; mediaType: "movie" | "tv" };

function parseKey(tmdbId: unknown, mediaType: unknown): Key | null {
  const id = typeof tmdbId === "string" ? Number(tmdbId) : tmdbId;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null;
  if (mediaType !== "movie" && mediaType !== "tv") return null;
  return { tmdbId: id, mediaType };
}

async function uidOr401() {
  const uid = (await cookies()).get("nw_uid")?.value ?? null;
  if (uid) return { uid };
  return {
    res: NextResponse.json({ ok: false, message: await apiMsg("noSession") }, { status: 401 }),
  };
}

async function badRequest() {
  return NextResponse.json({ ok: false, message: await apiMsg("invalidRequest") }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const a = await uidOr401();
  if (!a.uid) return a.res;
  const sp = req.nextUrl.searchParams;
  const key = parseKey(sp.get("tmdbId"), sp.get("mediaType"));
  if (!key) return badRequest();
  const row = await prisma.releaseFollow.findUnique({
    where: { userId_tmdbId_mediaType: { userId: a.uid, ...key } },
    select: { notifiedAt: true },
  });
  // En bevakning som redan plingat räknas inte — då har titeln gått att se
  // och knappen ska kunna bevaka igen om den försvunnit.
  return NextResponse.json({ ok: true, following: Boolean(row && !row.notifiedAt) });
}

export async function POST(req: NextRequest) {
  const a = await uidOr401();
  if (!a.uid) return a.res;
  const body = (await req.json().catch(() => null)) as
    | { tmdbId?: unknown; mediaType?: unknown; title?: unknown }
    | null;
  const key = parseKey(body?.tmdbId, body?.mediaType);
  if (!key) return badRequest();
  const title =
    (typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "") || String(key.tmdbId);
  // Gäster kan ha en uid-cookie utan users-rad → foreign key-fel. Kontrollera
  // i stället för att låta upsert kasta 500.
  const user = await prisma.user.findUnique({ where: { id: a.uid }, select: { id: true } });
  if (!user) {
    return NextResponse.json({ ok: false, message: await apiMsg("noSession") }, { status: 401 });
  }
  await prisma.releaseFollow.upsert({
    where: { userId_tmdbId_mediaType: { userId: a.uid, ...key } },
    // En gammal släpp-bevakning (redan plingad) blir en tjänstebevakning.
    update: { kind: "stream", title, notifiedAt: null, checkedAt: null },
    create: { userId: a.uid, ...key, title, kind: "stream" },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, following: true });
}

export async function DELETE(req: NextRequest) {
  const a = await uidOr401();
  if (!a.uid) return a.res;
  const body = (await req.json().catch(() => null)) as { tmdbId?: unknown; mediaType?: unknown } | null;
  const key = parseKey(body?.tmdbId, body?.mediaType);
  if (!key) return badRequest();
  await prisma.releaseFollow.deleteMany({ where: { userId: a.uid, ...key } });
  return NextResponse.json({ ok: true, following: false });
}
