// app/api/share/ack/route.ts — markera mottagna tips som lästa (alla oläst).
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const jar = await cookies();
  const me = jar.get("nw_uid")?.value ?? null;
  if (!me) return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });

  await prisma.sharedTitle.updateMany({
    where: { toUserId: me, seenAt: null },
    data: { seenAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
