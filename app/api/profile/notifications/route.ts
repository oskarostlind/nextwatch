// app/api/profile/notifications/route.ts
//
// LÃ¤ser/uppdaterar anvÃ¤ndarens notisinstÃ¤llningar (lagras pÃ¥ Profile).
// GET  -> nuvarande vÃ¤rden (defaults om profil saknas)
// PUT  -> uppdaterar en delmÃ¤ngd av flaggorna
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export type NotificationPrefs = {
  dailyRecs: boolean;
  groupMatches: boolean;
  friendRequests: boolean;
  groupInvites: boolean;
  shares: boolean;
  marketing: boolean;
};

const DEFAULTS: NotificationPrefs = {
  dailyRecs: true,
  groupMatches: true,
  friendRequests: true,
  groupInvites: true,
  shares: true,
  marketing: false,
};

export async function GET() {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value;
  if (!uid) return NextResponse.json({ ok: false, error: "no cookie" }, { status: 401 });

  const p = await prisma.profile.findUnique({
    where: { userId: uid },
    select: {
      notifyDailyRecs: true,
      notifyGroupMatches: true,
      notifyFriendRequests: true,
      notifyGroupInvites: true,
      notifyShares: true,
      notifyMarketing: true,
    },
  });

  const prefs: NotificationPrefs = p
    ? {
        dailyRecs: p.notifyDailyRecs,
        groupMatches: p.notifyGroupMatches,
        friendRequests: p.notifyFriendRequests,
        groupInvites: p.notifyGroupInvites,
        shares: p.notifyShares,
        marketing: p.notifyMarketing,
      }
    : DEFAULTS;

  return NextResponse.json({ ok: true, prefs });
}

export async function PUT(req: NextRequest) {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value;
  if (!uid) return NextResponse.json({ ok: false, error: "no cookie" }, { status: 401 });

  let body: Partial<NotificationPrefs> = {};
  try {
    body = (await req.json()) as Partial<NotificationPrefs>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }

  const data: Record<string, boolean> = {};
  if (typeof body.dailyRecs === "boolean") data.notifyDailyRecs = body.dailyRecs;
  if (typeof body.groupMatches === "boolean") data.notifyGroupMatches = body.groupMatches;
  if (typeof body.friendRequests === "boolean") data.notifyFriendRequests = body.friendRequests;
  if (typeof body.groupInvites === "boolean") data.notifyGroupInvites = body.groupInvites;
  if (typeof body.shares === "boolean") data.notifyShares = body.shares;
  if (typeof body.marketing === "boolean") data.notifyMarketing = body.marketing;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: "no valid fields" }, { status: 400 });
  }

  // Profilen kan saknas fÃ¶r nyregistrerade â€“ uppdatera bara om den finns.
  const existing = await prisma.profile.findUnique({ where: { userId: uid }, select: { userId: true } });
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "profile_missing", message: "SlutfÃ¶r onboarding fÃ¶rst." },
      { status: 409 }
    );
  }

  const p = await prisma.profile.update({
    where: { userId: uid },
    data,
    select: {
      notifyDailyRecs: true,
      notifyGroupMatches: true,
      notifyFriendRequests: true,
      notifyGroupInvites: true,
      notifyShares: true,
      notifyMarketing: true,
    },
  });

  return NextResponse.json({
    ok: true,
    prefs: {
      dailyRecs: p.notifyDailyRecs,
      groupMatches: p.notifyGroupMatches,
      friendRequests: p.notifyFriendRequests,
      groupInvites: p.notifyGroupInvites,
      shares: p.notifyShares,
      marketing: p.notifyMarketing,
    },
  });
}
