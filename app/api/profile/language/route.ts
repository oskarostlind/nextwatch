// app/api/profile/language/route.ts
//
// Persisterar gränssnittsspråket. Klienten har redan skrivit nw_lang-cookien
// när den här anropas (lib/uiLanguage.ts) — routen finns för att valet ska
// följa med kontot till nästa enhet, och den sätter cookien igen som
// httpOnly:false så att server och klient garanterat är överens.
//
// En saknad profil är inte ett fel här: anonyma besökare som ännu inte gjort
// onboarding ska också kunna byta språk. Då lever valet bara i cookien.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { LANG_COOKIE, LANG_COOKIE_OPTS, normalizeLocale } from "@/lib/i18nConfig";

export async function PUT(req: NextRequest) {
  let body: { uiLanguage?: unknown } = {};
  try {
    body = (await req.json()) as { uiLanguage?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }

  const uiLanguage = normalizeLocale(body.uiLanguage);

  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value;

  let persisted = false;
  if (uid) {
    try {
      const existing = await prisma.profile.findUnique({
        where: { userId: uid },
        select: { userId: true },
      });
      if (existing) {
        await prisma.profile.update({ where: { userId: uid }, data: { uiLanguage } });
        persisted = true;
      }
    } catch {
      // Databasfel får inte blockera språkbytet — cookien nedan räcker för
      // att appen ska byta språk direkt.
    }
  }

  const res = NextResponse.json({ ok: true, uiLanguage, persisted });
  res.cookies.set(LANG_COOKIE, uiLanguage, LANG_COOKIE_OPTS);
  return res;
}
