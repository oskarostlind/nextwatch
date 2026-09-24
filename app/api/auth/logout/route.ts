// app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiMsg } from "@/lib/apiMessages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const jar = await cookies();

  // Nollställ våra cookies (klientlästa, ej httpOnly)
  const past = new Date(0);
  const opts = { path: "/", expires: past, httpOnly: false, sameSite: "lax" as const, secure: true };

  ["nw_uid", "nw_region", "nw_locale", "nw_group"].forEach((name) => {
    if (jar.get(name)) jar.set(name, "", opts);
  });

  return NextResponse.json({ ok: true, message: await apiMsg("loggedOut") });
}
