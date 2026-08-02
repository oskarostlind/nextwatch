// app/api/profile/swipe-settings/route.ts
//
// Läser/uppdaterar användarens swipe-inställningar (lagras på Profile).
// GET  -> nuvarande värden (defaults om profil saknas)
// PUT  -> uppdaterar en delmängd av fälten
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  SWIPE_MEDIA_FILTER_DEFAULT,
  isValidSwipeMediaFilter,
  normalizeSwipeMediaFilter,
  type SwipeMediaFilter,
} from "@/lib/swipeMediaFilter";

export type SwipeSettings = {
  /** Visa hyr-/köpalternativ på titelkort. */
  showPaidOptions: boolean;
  /** Film/serie-filter för solo-swipe. */
  mediaFilter: SwipeMediaFilter;
  /** Visa barn-/familjeinnehåll (TV-Kids) i förslagen. */
  showKidsContent: boolean;
};

const DEFAULTS: SwipeSettings = {
  showPaidOptions: false,
  mediaFilter: SWIPE_MEDIA_FILTER_DEFAULT,
  showKidsContent: false,
};

export async function GET() {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value;
  if (!uid) return NextResponse.json({ ok: false, error: "no cookie" }, { status: 401 });

  const p = await prisma.profile.findUnique({
    where: { userId: uid },
    select: { showPaidOptions: true, swipeMediaFilter: true, showKidsContent: true },
  });

  const settings: SwipeSettings = p
    ? {
        showPaidOptions: p.showPaidOptions,
        mediaFilter: normalizeSwipeMediaFilter(p.swipeMediaFilter),
        showKidsContent: p.showKidsContent,
      }
    : DEFAULTS;

  return NextResponse.json({ ok: true, settings });
}

export async function PUT(req: NextRequest) {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value;
  if (!uid) return NextResponse.json({ ok: false, error: "no cookie" }, { status: 401 });

  let body: Partial<SwipeSettings> = {};
  try {
    body = (await req.json()) as Partial<SwipeSettings>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }

  const data: { showPaidOptions?: boolean; swipeMediaFilter?: SwipeMediaFilter; showKidsContent?: boolean } = {};
  if (typeof body.showPaidOptions === "boolean") data.showPaidOptions = body.showPaidOptions;
  if (isValidSwipeMediaFilter(body.mediaFilter)) data.swipeMediaFilter = body.mediaFilter;
  if (typeof body.showKidsContent === "boolean") data.showKidsContent = body.showKidsContent;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: "no valid fields" }, { status: 400 });
  }

  // Profilen kan saknas för nyregistrerade – uppdatera bara om den finns.
  const existing = await prisma.profile.findUnique({
    where: { userId: uid },
    select: { userId: true },
  });
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "profile_missing", message: "Slutför onboarding först." },
      { status: 409 }
    );
  }

  const p = await prisma.profile.update({
    where: { userId: uid },
    data,
    select: { showPaidOptions: true, swipeMediaFilter: true, showKidsContent: true },
  });

  return NextResponse.json({
    ok: true,
    settings: {
      showPaidOptions: p.showPaidOptions,
      mediaFilter: normalizeSwipeMediaFilter(p.swipeMediaFilter),
      showKidsContent: p.showKidsContent,
    },
  });
}
