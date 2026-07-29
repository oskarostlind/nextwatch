import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { TOUR_VERSIONS, type TourId } from "@/lib/tours/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

function isTourId(v: unknown): v is TourId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(TOUR_VERSIONS, v);
}

export async function GET() {
  const c = await cookies();
  const uid = c.get("nw_uid")?.value;
  if (!uid) return bad("Ingen session (nw_uid saknas).", 401);

  const rows = await prisma.onboardingTour.findMany({
    where: { userId: uid },
    select: { tourId: true, version: true, status: true },
  });
  const tours: Record<string, { version: number; status: string }> = {};
  for (const r of rows) tours[r.tourId] = { version: r.version, status: r.status };
  return NextResponse.json({ ok: true, tours });
}

export async function POST(req: Request) {
  const c = await cookies();
  const uid = c.get("nw_uid")?.value;
  if (!uid) return bad("Ingen session (nw_uid saknas).", 401);

  const body = (await req.json().catch(() => null)) as
    | { tourId?: unknown; version?: unknown; status?: unknown }
    | null;
  if (!body) return bad("Ogiltig body.");

  const { tourId, version, status } = body;
  if (!isTourId(tourId)) return bad("Okänd tourId.");
  if (typeof version !== "number" || !Number.isFinite(version)) return bad("Ogiltig version.");
  if (status !== "completed" && status !== "skipped") return bad("Ogiltig status.");

  await prisma.onboardingTour.upsert({
    where: { userId_tourId: { userId: uid, tourId } },
    update: { version, status, completedAt: new Date() },
    create: { userId: uid, tourId, version, status },
  });

  return NextResponse.json({ ok: true });
}
