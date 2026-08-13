// app/api/group/join/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { canJoinGroup } from "@/lib/groupLimits";

type JoinBody = {
  code: string;
};

type JoinOk = {
  ok: true;
  group: {
    code: string;
    createdAt: string; // <- serialiserad ISO-sträng
    createdBy: string;
  };
  membership: {
    userId: string;
    groupCode: string;
  };
};

type JoinErr = {
  ok: false;
  message?: string;
};

export async function POST(req: NextRequest): Promise<NextResponse<JoinOk | JoinErr>> {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value ?? null;
    if (!uid) {
      return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });
    }

    const raw = (await req.json().catch(() => null)) as unknown;
    if (!raw || typeof raw !== "object" || typeof (raw as JoinBody).code !== "string") {
      return NextResponse.json({ ok: false, message: "Ogiltig body. Förväntade { code: string }." }, { status: 400 });
    }

    const code = (raw as JoinBody).code.trim().toUpperCase();
    if (code.length < 4 || code.length > 12) {
      return NextResponse.json({ ok: false, message: "Ogiltig gruppkod." }, { status: 400 });
    }

    const found = await prisma.group.findUnique({
      where: { code },
      select: { code: true, createdAt: true, createdBy: true },
    });

    if (!found) {
      return NextResponse.json({ ok: false, message: "Grupp hittades inte." }, { status: 404 });
    }

    // Medlemstak (lib/groupLimits) — gratisgrupper är små, premiumgrupper stora.
    // Redan medlem släpps alltid igenom, så en dubbelklickad kod aldrig nekas.
    const gate = await canJoinGroup(found.code, uid);
    if (!gate.allowed) {
      return NextResponse.json({ ok: false, message: gate.message }, { status: 403 });
    }

    await prisma.groupMember.upsert({
      where: { groupCode_userId: { groupCode: found.code, userId: uid } },
      update: {},
      create: { groupCode: found.code, userId: uid },
    });

    const group = {
      code: found.code,
      createdAt: found.createdAt.toISOString(),
      createdBy: found.createdBy,
    };

    const res = NextResponse.json<JoinOk>({
      ok: true,
      group,
      membership: { userId: uid, groupCode: found.code },
    });

    // Klientläsbar cookie så UI direkt ser aktiv grupp
    res.cookies.set({
      name: "nw_group",
      value: found.code,
      httpOnly: false,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 14, // 14 dagar
    });

    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internt fel.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
