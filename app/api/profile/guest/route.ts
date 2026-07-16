// app/api/profile/guest/route.ts
//
// Gästläge: skapar en MINIMAL profil för det anonyma uid:t så att användaren kan
// börja swipa direkt utan att gå igenom onboardingen — och kan gå med i grupper
// (både solo-recs och grupp-recs kräver att den inloggade har en profil, och
// group_members har en FK till users).
//
// Gästens smak är avsiktligt tom: inga genrer, inga providers (→ inget
// providerfilter, populära titlar visas) och en vuxen standardålder så att en
// gäst inte råkar strypa åldersgränsen i en grupp. Fyller man i onboardingen /
// profilen senare skrivs allt över.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guestDob(): Date {
  const year = new Date().getFullYear() - 25; // vuxen standardålder
  return new Date(`${year}-06-15`);
}

export async function POST() {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value ?? null;
    if (!uid) {
      return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });
    }

    // Säkerställ användarrad (middleware sätter bara cookie).
    await prisma.user.upsert({ where: { id: uid }, update: {}, create: { id: uid } });

    // Har redan en profil (gäst eller riktig)? Rör den inte — bara fortsätt.
    const existing = await prisma.profile.findUnique({
      where: { userId: uid },
      select: { userId: true },
    });
    if (existing) {
      return NextResponse.json({ ok: true, alreadyHadProfile: true });
    }

    const regionRaw = jar.get("nw_region")?.value ?? "";
    const region = /^[A-Z]{2}$/.test(regionRaw) ? regionRaw : "SE";
    const localeRaw = jar.get("nw_locale")?.value ?? "";
    const locale = /^[a-z]{2}(-[A-Z]{2})?$/.test(localeRaw) ? localeRaw : "sv-SE";
    const uiLanguage = locale.split("-")[0] || "sv";

    await prisma.profile.create({
      data: {
        userId: uid,
        displayName: "Gäst",
        dob: guestDob(),
        region,
        locale,
        uiLanguage,
        // Resten (providers, genrer, notisinställningar m.m.) får schema-defaults.
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[profile/guest]", e);
    return NextResponse.json(
      { ok: false, message: "Kunde inte starta gästläge." },
      { status: 500 },
    );
  }
}
