// app/api/group/share/route.ts — "Bjud in någon" (nya flödet del 6).
//
// Ger värden en delbar länk https://www.nextwatch.se/g/<KOD>:
//   1. återanvänder den aktiva gruppen (nw_group) om värden är medlem och det
//      finns plats, annars skapas en ny grupp (samma som /api/group/create);
//   2. "Dina N gillade följer med": värdens senaste gillade läggs som LIKE-
//      röster i gruppen (lib/referral seedHostLikes) så att vännens första
//      gilla på en av dem blir en match;
//   3. kommer ihåg vem som delade (referral_links) för belöningen.
// Steg 3 tål att SQL:en inte körts (loggas, länken fungerar ändå).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { apiMsg } from "@/lib/apiMessages";
import { getGroupCapacity } from "@/lib/groupLimits";
import { getRateLimitKey, rateLimitAllow } from "@/lib/rateLimit";
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_OPTS,
  deviceKey,
  inviteUrl,
  newDeviceId,
  newGroupCode,
  normalizeGroupCode,
  recordReferralLink,
  seedHostLikes,
} from "@/lib/referral";

type ShareOk = { ok: true; code: string; url: string; seeded: number; reused: boolean };
type ShareErr = { ok: false; message: string };

async function reusableGroup(code: string | null, uid: string): Promise<string | null> {
  if (!code) return null;
  const member = await prisma.groupMember.findUnique({
    where: { groupCode_userId: { groupCode: code, userId: uid } },
    select: { userId: true },
  });
  if (!member) return null;
  const cap = await getGroupCapacity(code);
  return cap.isFull ? null : code;
}

export async function POST(req: Request): Promise<NextResponse<ShareOk | ShareErr>> {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value ?? null;
    if (!uid) return NextResponse.json({ ok: false, message: await apiMsg("noSession") }, { status: 401 });

    // Varje anrop kan skapa en grupp — håll det inom rimliga gränser.
    if (!rateLimitAllow(getRateLimitKey(req, uid), "group_share", { limit: 20 })) {
      return NextResponse.json({ ok: false, message: await apiMsg("tooManyRequests") }, { status: 429 });
    }

    // group_members/groups har FK till users; middleware sätter bara cookien.
    await prisma.user.upsert({ where: { id: uid }, update: {}, create: { id: uid } });

    let code = await reusableGroup(normalizeGroupCode(jar.get("nw_group")?.value), uid);
    const reused = !!code;
    if (!code) {
      let candidate = newGroupCode();
      for (let i = 0; i < 5; i += 1) {
        const exists = await prisma.group.findUnique({ where: { code: candidate }, select: { code: true } });
        if (!exists) break;
        candidate = newGroupCode();
      }
      await prisma.group.create({ data: { code: candidate, createdBy: uid } });
      await prisma.groupMember.upsert({
        where: { groupCode_userId: { groupCode: candidate, userId: uid } },
        update: {},
        create: { groupCode: candidate, userId: uid },
      });
      code = candidate;
    }

    const seeded = await seedHostLikes(code, uid);

    const rawDevice = jar.get(DEVICE_COOKIE)?.value ?? null;
    const device = deviceKey(rawDevice) ? rawDevice! : newDeviceId();
    await recordReferralLink(code, uid, deviceKey(device));

    const res = NextResponse.json<ShareOk>({ ok: true, code, url: inviteUrl(code), seeded, reused });
    // Samma klientläsbara cookie som create/join — värdens grupplek och
    // matchpollningen (lib/useGroupMatch) följer den.
    res.cookies.set({
      name: "nw_group",
      value: code,
      httpOnly: false,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
    if (device !== rawDevice) res.cookies.set({ name: DEVICE_COOKIE, value: device, ...DEVICE_COOKIE_OPTS });
    return res;
  } catch (e) {
    console.error("[group/share]", e);
    return NextResponse.json({ ok: false, message: await apiMsg("internalError") }, { status: 500 });
  }
}
