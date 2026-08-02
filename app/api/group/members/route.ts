// app/api/group/members/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

type MemberDto = {
  id: string;
  displayName: string | null;
  username: string | null;
};

type Ok = {
  ok: true;
  code: string;
  members: MemberDto[];
};

type Err = { ok: false; message: string };

function bad(message: string, status = 200) {
  return NextResponse.json({ ok: false, message } as Err, { status });
}

export async function GET(req: NextRequest) {
  const jar = await cookies(); // projektregel: alltid await cookies() i App Router (server)
  try {
    const u = new URL(req.url);
    const code = (u.searchParams.get("code") || "").toUpperCase();

    if (!code) {
      return bad("Missing group code.");
    }

    // Gruppen kan ha gallrats bort av cron/cleanup (ett dygn utan aktivitet)
    // medan nw_group-cookien lever i 14 dagar. Utan den här kontrollen skulle
    // klienten fortsätta polla en spökgrupp: matchpollningen var 8:e sekund och
    // en GroupBar som visar en grupp med noll medlemmar. Rensa cookien i stället
    // så klienten faller tillbaka till solo av sig själv.
    const groupExists = await prisma.group.findUnique({
      where: { code },
      select: { code: true },
    });
    if (!groupExists) {
      if (jar.get("nw_group")?.value === code) {
        jar.set("nw_group", "", { path: "/", maxAge: 0, sameSite: "lax", secure: true, httpOnly: false });
      }
      return bad("Group no longer exists.", 404);
    }

    // Hämta alla medlemmar med minimalt fälturval (bakåtkompatibelt mot UI:t)
    const rows = await prisma.groupMember.findMany({
      where: { groupCode: code },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            profile: { select: { displayName: true } },
          },
        },
      },
      orderBy: { joinedAt: "asc" },
    });

    const members: MemberDto[] = rows.map((r) => ({
      id: r.user.id,
      displayName: r.user.profile?.displayName ?? null,
      username: r.user.username ?? null,
    }));

    // Om den som anropar ÄR medlem i denna grupp men saknar/har fel cookie,
    // sätt nw_group så klientens polling m.m. blir konsekvent.
    const uid = jar.get("nw_uid")?.value ?? null;
    const isMember = Boolean(uid) && members.some((m) => m.id === uid);
    if (uid && isMember) {
      const existing = jar.get("nw_group")?.value;
      if (existing !== code) {
        jar.set("nw_group", code, {
          path: "/",
          maxAge: 60 * 60 * 24 * 14, // 14 dagar
          sameSite: "lax",
          secure: true,
          httpOnly: false, // läsbar av klient-hooken (useGroupMatchPolling)
        });
      }
    } else if (uid && !isMember && jar.get("nw_group")?.value === code) {
      // Gruppen finns kvar men den här användaren är inte längre medlem — de
      // lämnade själva, eller blev borttagna av en admin (som aldrig rör DERAS
      // cookie, bara sin egen). Utan den här grenen låg nw_group kvar signerad
      // mot en grupp de inte längre är med i, och swipe/gruppvyn fortsatte visa
      // gruppläget tills cookien gick ut av sig själv efter 14 dagar.
      jar.set("nw_group", "", { path: "/", maxAge: 0, sameSite: "lax", secure: true, httpOnly: false });
      return bad("Not a member of this group.", 404);
    }

    return NextResponse.json({ ok: true, code, members } as Ok, { status: 200 });
  } catch (e: unknown) {
    console.error("group/members GET error:", e);
    return bad("Internal error.");
  }
}
