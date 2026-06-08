// app/api/push/register/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? "";
  if (!uid) {
    return NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });
  }

  let token = "";
  let platform = "ios";
  try {
    const body = (await req.json()) as { token?: unknown; platform?: unknown };
    if (typeof body.token === "string") token = body.token.trim();
    if (typeof body.platform === "string" && body.platform.trim()) {
      platform = body.platform.trim();
    }
  } catch {
    /* ignore – valideras nedan */
  }

  if (!token) {
    return NextResponse.json({ ok: false, message: "token required" }, { status: 400 });
  }

  // Identiteten är cookie-baserad; säkerställ att user-raden finns.
  await prisma.user.upsert({
    where: { id: uid },
    update: {},
    create: { id: uid, plan: "free" },
  });

  // En token tillhör alltid senast registrerande användare (enhet kan byta konto).
  await prisma.pushToken.upsert({
    where: { token },
    update: { userId: uid, platform },
    create: { token, userId: uid, platform },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  let token = "";
  try {
    const body = (await req.json()) as { token?: unknown };
    if (typeof body.token === "string") token = body.token.trim();
  } catch {
    /* ignore */
  }
  if (token) {
    await prisma.pushToken.deleteMany({ where: { token } });
  }
  return NextResponse.json({ ok: true });
}
