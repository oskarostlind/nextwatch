// app/api/share/react/route.ts — mottagarens fasta reaktion på ett tips.
// Ingen fritext (chattens scope): reaktionen ÄR svaret. Null tar bort.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REACTIONS = new Set(["seen", "want", "skip"]);

export async function POST(req: NextRequest) {
  const jar = await cookies();
  const me = jar.get("nw_uid")?.value ?? null;
  if (!me) return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { id?: string; reaction?: string | null };
  const reaction = body.reaction === null ? null : REACTIONS.has(body.reaction ?? "") ? body.reaction! : undefined;
  if (typeof body.id !== "string" || !body.id || reaction === undefined) {
    return NextResponse.json({ ok: false, message: "Ogiltig reaktion." }, { status: 400 });
  }

  // updateMany med toUserId=me: bara mottagaren kan reagera; främmande id = tyst no-op.
  await prisma.sharedTitle.updateMany({
    where: { id: body.id, toUserId: me },
    data: { reaction },
  });

  return NextResponse.json({ ok: true });
}
