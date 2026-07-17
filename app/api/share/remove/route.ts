// app/api/share/remove/route.ts — mottagaren tar bort ett tips ur sin inbox.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const jar = await cookies();
  const me = jar.get("nw_uid")?.value ?? null;
  if (!me) return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { id?: string };
  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ ok: false, message: "id saknas." }, { status: 400 });
  }

  // deleteMany med toUserId=me: bara mottagaren kan ta bort, och ett id som
  // inte är ens eget blir en tyst no-op i stället för en läcka.
  await prisma.sharedTitle.deleteMany({ where: { id: body.id, toUserId: me } });
  return NextResponse.json({ ok: true });
}
