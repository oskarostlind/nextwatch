// app/api/group/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "../../../lib/prisma";

function genCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/** GET /api/group?code=XXXXXX */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code")?.toUpperCase() ?? null;
  if (!code) return NextResponse.json({ ok: false, error: "Missing ?code" }, { status: 400 });
  const group = await prisma.group.findUnique({ where: { code } });
  if (!group) return NextResponse.json({ ok: false, error: "Group not found" }, { status: 404 });
  return NextResponse.json({ ok: true, group }, { status: 200 });
}

/** POST /api/group  -> skapar grupp + lägger in skaparen som medlem */
export async function POST() {
  const cookieStore = await cookies();
  let uid = cookieStore.get("nw_uid")?.value;
  const mustSetCookie = !uid;
  if (!uid) {
    uid = crypto.randomUUID();
  }

  // se till att User finns (User.id saknar default)
  const user = await prisma.user.upsert({
    where: { id: uid },
    update: {},
    create: { id: uid, plan: "free" },
    select: { id: true },
  });

  // unik kod
  let code = genCode();
  for (let i = 0; i < 5; i++) {
    const exists = await prisma.group.findUnique({ where: { code } });
    if (!exists) break;
    code = genCode();
  }

  // skapa grupp och koppla creator
  const group = await prisma.group.create({
    data: { code, creator: { connect: { id: user.id } } },
    select: { code: true },
  });

  // lägg även in skaparen som medlem
  await prisma.groupMember.upsert({
    where: { groupCode_userId: { groupCode: group.code, userId: user.id } },
    update: {},
    create: { groupCode: group.code, userId: user.id },
  });

  const res = NextResponse.json({ ok: true, group }, { status: 201 });
  if (mustSetCookie && uid) {
    res.cookies.set("nw_uid", uid, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}
