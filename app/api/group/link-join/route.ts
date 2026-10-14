// app/api/group/link-join/route.ts — vännen öppnar /g/<KOD> (nya flödet del 6).
//
// Ett anrop gör allt som tidigare krävde konto + manuellt inskriven kod:
//   1. tyst gästprofil om besökaren saknar profil — exakt samma handler som
//      /api/profile/guest (återanvänds, inte kopierad);
//   2. går med i gruppen med samma medlemstak som /api/group/join (skaparens
//      plan styr — lib/groupLimits). Fullt → 403 + reason "full";
//   3. sätter aktiv grupp (nw_group) och enhets-cookien nw_dev;
//   4. var besökaren INTE redan medlem → referral-rad (lib/referral), som ger
//      båda AI-val när vännen röstat 10 gånger (app/api/group/votes).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { apiMsg } from "@/lib/apiMessages";
import { canJoinGroup } from "@/lib/groupLimits";
import { getRateLimitKey, rateLimitAllow } from "@/lib/rateLimit";
import { POST as ensureGuestProfile } from "@/app/api/profile/guest/route";
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_OPTS,
  deviceKey,
  newDeviceId,
  normalizeGroupCode,
  recordReferralJoin,
} from "@/lib/referral";

type Ok = { ok: true; code: string; joined: boolean };
type Err = { ok: false; reason: "invalid" | "full" | "session" | "error"; message: string };

export async function POST(req: Request): Promise<NextResponse<Ok | Err>> {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value ?? null;
    if (!uid) {
      return NextResponse.json({ ok: false, reason: "session", message: await apiMsg("noSession") }, { status: 401 });
    }

    // Gissningsskydd: koderna är korta (6 tecken). Per uid OCH per IP — en ny
    // gäst-uid per förfrågan (cookielös klient) ska inte kringgå gränsen.
    // In-memory per instans, samma limiter som /api/group/share.
    const ipKey = getRateLimitKey(req);
    if (
      !rateLimitAllow(getRateLimitKey(req, uid), "group_link_join_uid", { limit: 15 }) ||
      !rateLimitAllow(ipKey, "group_link_join_ip", { limit: 40 })
    ) {
      return NextResponse.json(
        { ok: false, reason: "error", message: await apiMsg("tooManyRequests") },
        { status: 429 }
      );
    }

    const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
    const code = normalizeGroupCode(typeof body?.code === "string" ? body.code : null);
    if (!code) {
      return NextResponse.json(
        { ok: false, reason: "invalid", message: await apiMsg("invalidGroupCode") },
        { status: 400 }
      );
    }

    const group = await prisma.group.findUnique({ where: { code }, select: { code: true } });
    if (!group) {
      return NextResponse.json({ ok: false, reason: "invalid", message: await apiMsg("groupNotFound") }, { status: 404 });
    }

    // 1. Gästprofil (no-op om profil redan finns). Skapar även users-raden.
    // Anropas med en egen tom Request så att det fungerar oavsett om handlern
    // (del 1 äger den) läser en body eller inte. Cookies läses via cookies().
    const guest = await (ensureGuestProfile as (r?: Request) => Promise<Response>)(
      new Request(req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    );
    if (!guest.ok) {
      return NextResponse.json({ ok: false, reason: "error", message: await apiMsg("guestFailed") }, { status: 500 });
    }

    // 2. Medlemstak — redan medlem släpps alltid igenom (lib/groupLimits).
    const already = await prisma.groupMember.findUnique({
      where: { groupCode_userId: { groupCode: code, userId: uid } },
      select: { userId: true },
    });
    if (!already) {
      const gate = await canJoinGroup(code, uid);
      if (!gate.allowed) {
        return NextResponse.json({ ok: false, reason: "full", message: gate.message }, { status: 403 });
      }
      await prisma.groupMember.upsert({
        where: { groupCode_userId: { groupCode: code, userId: uid } },
        update: {},
        create: { groupCode: code, userId: uid },
      });
    }

    const rawDevice = jar.get(DEVICE_COOKIE)?.value ?? null;
    const device = deviceKey(rawDevice) ? rawDevice! : newDeviceId();

    // 4. Bara den som faktiskt gick med nu kan ge belöning. Tål saknad tabell.
    if (!already) {
      await recordReferralJoin({ groupCode: code, inviteeId: uid, inviteeDevice: deviceKey(device) });
    }

    // 3. Aktiv grupp + enhets-cookie.
    const res = NextResponse.json<Ok>({ ok: true, code, joined: !already });
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
    console.error("[group/link-join]", e);
    return NextResponse.json({ ok: false, reason: "error", message: await apiMsg("internalError") }, { status: 500 });
  }
}
