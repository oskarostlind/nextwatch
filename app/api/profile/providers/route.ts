// app/api/profile/providers/route.ts
//
// Sparar BARA streamingtjänsterna. Finns för ProviderPromptSheet (arket som
// frågar gäster efter tjänster inne i swipen): PUT /api/profile skriver över
// hela profilen — genrer, favoriter m.m. blir tomma om de inte skickas med —
// så den går inte att använda för en delsparning.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { apiMsg } from "@/lib/apiMessages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!uid) {
    return NextResponse.json({ ok: false, message: await apiMsg("noSession") }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { providers?: unknown };
  const providers = Array.isArray(body.providers)
    ? Array.from(
        new Set(
          body.providers
            .filter((v): v is string => typeof v === "string")
            .map((v) => v.trim())
            .filter((v) => v.length > 0 && v.length <= 40),
        ),
      ).slice(0, 20)
    : null;
  if (!providers) {
    return NextResponse.json({ ok: false, message: await apiMsg("invalidRequest") }, { status: 400 });
  }

  const res = await prisma.profile.updateMany({
    where: { userId: uid },
    data: { providers, updatedAt: new Date() },
  });
  if (res.count === 0) {
    return NextResponse.json({ ok: false, message: await apiMsg("invalidRequest") }, { status: 404 });
  }
  return NextResponse.json({ ok: true, providers });
}
