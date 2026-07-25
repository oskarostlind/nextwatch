// app/api/session/restore/route.ts
//
// Återställer sessionen från iOS-appens native-sparade token (se
// session/token). HMAC-verifiering + krav på att kontot fortfarande finns —
// ett stulet/gammalt token för en raderad användare ger ingenting.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyUid } from "@/lib/session";
import { attachSessionCookies } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { token?: string };
  const token = typeof body.token === "string" ? body.token : null;
  if (!token) return NextResponse.json({ ok: false, message: "Token saknas." }, { status: 400 });

  const uid = await verifyUid(token);
  if (!uid) {
    return NextResponse.json({ ok: false, message: "Ogiltigt token." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { id: true, profile: { select: { userId: true } } },
  });
  if (!user?.profile) {
    // Kontot raderat sedan token sparades — säg åt klienten att slänga det.
    return NextResponse.json({ ok: false, message: "Kontot finns inte längre.", discard: true }, { status: 410 });
  }

  const res = NextResponse.json({ ok: true });
  await attachSessionCookies(res, uid, { remember: true });
  return res;
}
