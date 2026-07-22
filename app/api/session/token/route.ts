// app/api/session/token/route.ts
//
// Ger den inloggade anroparen sitt EGET signerade sessionsvärde (samma
// "<uid>.<hmac>" som cookien bär). Används av iOS-appen för att spara sessionen
// i native storage (@capacitor/preferences): WKWebView/ITP raderar cookies för
// remote-laddade Capacitor-appar efter ~7 dagars inaktivitet, och utan
// native-backup tvingades användare logga in om och om igen (869e69y3q).
//
// Säkerhet: endpointen läcker inget nytt — värdet är exakt det anroparens
// cookie redan innehåller, och HMAC:en gör det oförfalskbart. Token utfärdas
// bara till konton som är värda att rädda (user-rad + profil finns).
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { signUid } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  // Middleware har normaliserat till bare-uid.
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!uid) return NextResponse.json({ ok: false }, { status: 401 });

  const profile = await prisma.profile.findUnique({
    where: { userId: uid },
    select: { userId: true },
  });
  if (!profile) return NextResponse.json({ ok: false, message: "Ingen profil." }, { status: 404 });

  try {
    return NextResponse.json({ ok: true, token: await signUid(uid) });
  } catch {
    // SESSION_SECRET saknas — hellre inget token än ett osignerat.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
