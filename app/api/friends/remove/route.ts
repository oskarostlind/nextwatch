// app/api/friends/remove/route.ts
//
// Tar bort en vänrelation i båda riktningar och städar bort eventuella
// pending-förfrågningar mellan de två. Utan detta fanns ingen väg tillbaka
// när man väl lagt till någon — App Store-riktlinje 1.2 vill att användare
// ska kunna ta sig ur oönskad kontakt.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const me = jar.get("nw_uid")?.value ?? "";
    if (!me) return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });

    let userId = "";
    try {
      const body = (await req.json()) as { userId?: string };
      userId = (body.userId ?? "").trim();
    } catch {
      /* ignore */
    }
    if (!userId) return NextResponse.json({ ok: false, message: "userId krävs." }, { status: 400 });
    if (userId === me) return NextResponse.json({ ok: false, message: "Ogiltig mottagare." }, { status: 400 });

    await prisma.$transaction(async (tx) => {
      await tx.friendship.deleteMany({
        where: {
          OR: [
            { userId: me, friendId: userId },
            { userId, friendId: me },
          ],
        },
      });
      // Pending-förfrågningar i båda riktningar bort, annars ligger en gammal
      // förfrågan kvar och återskapar relationen vid nästa accept.
      await tx.friendRequest.deleteMany({
        where: {
          status: "pending",
          OR: [
            { fromUserId: me, toUserId: userId },
            { fromUserId: userId, toUserId: me },
          ],
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, message: "Internt fel." }, { status: 500 });
  }
}
