import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { TOUR_VERSIONS, type TourId } from "@/lib/tours/registry";
import { apiMsg } from "@/lib/apiMessages";

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
  if (!uid) return bad(await apiMsg("noSession"), 401);

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
  if (!uid) return bad(await apiMsg("noSession"), 401);

  const body = (await req.json().catch(() => null)) as
    | { tourId?: unknown; version?: unknown; status?: unknown }
    | null;
  if (!body) return bad(await apiMsg("invalidRequest"));

  const { tourId, version, status } = body;
  if (!isTourId(tourId)) return bad(await apiMsg("invalidRequest"));
  if (typeof version !== "number" || !Number.isFinite(version)) return bad(await apiMsg("invalidRequest"));
  if (status !== "completed" && status !== "skipped") return bad(await apiMsg("invalidRequest"));

  await prisma.onboardingTour.upsert({
    where: { userId_tourId: { userId: uid, tourId } },
    update: { version, status, completedAt: new Date() },
    create: { userId: uid, tourId, version, status },
  });

  return NextResponse.json({ ok: true });
}
