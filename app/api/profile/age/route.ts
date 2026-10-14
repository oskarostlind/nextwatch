// app/api/profile/age/route.ts
//
// Sparar BARA åldern, som ett åldersspann från tjänstekortet i leken ("nya
// flödet", app/components/firstSession/deck/ServicesAgeCard.tsx): "Under 15",
// "15–17" eller "18+", ett tryck. Ingen befintlig route går att använda:
// PUT /api/profile skriver över hela profilen (genrer, tjänster … blir tomma om
// de inte skickas med) och /api/profile/providers tar bara tjänsterna.
//
// Profile.dob är en obligatorisk DateTime och läses av den svenska
// åldersgränsen (seMaxCert(ageFromDob(dob)) i lib/tasteModel.ts — solo, och
// YNGSTA medlemmen i en grupp — samt i lib/aiPick/candidates.ts). Spannet
// sparas därför som ett REPRESENTATIVT födelsedatum, räknat från idag på
// servern (aldrig klientens klocka):
//
//   u15  → 12,5 år → certMax "11". Mitt i "från 11 år"-spannet (11–14): ligger
//          kvar där ~2,5 år innan personen naturligt åldras till 15. Inte "7":
//          onboardingen tillåter 7+ men en mobilanvändare under 15 är i regel
//          11–14, och "7" tömmer leken på det mesta.
//   15_17 → 16,5 år → certMax "15" (Sveriges högsta gräns — samma lek som för
//          vuxna), men profilen förblir ärligt omyndig om något senare behöver
//          en 18-gräns.
//   18p   → 25,5 år → samma vuxna standardålder som gästprofilen redan har
//          (app/api/profile/guest, 25 år).
//
// Halvåret gör att ageFromDob ger samma heltal året runt (onboardingens
// "år − ålder, 15 juni" glider ett år beroende på datum).
//
// Ett befintligt datum som redan ligger i det valda spannet skrivs INTE över —
// ett riktigt födelsedatum från onboardingen/profilen bevaras.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { apiMsg } from "@/lib/apiMessages";
import { ageFromDob, seMaxCert } from "@/lib/tasteModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AgeBand = "u15" | "15_17" | "18p";

/** Representativ ålder (hela år) per spann — se kommentaren överst. */
const BAND_AGE: Record<AgeBand, number> = { u15: 12, "15_17": 16, "18p": 25 };

function isBand(v: unknown): v is AgeBand {
  return v === "u15" || v === "15_17" || v === "18p";
}

function bandOf(age: number): AgeBand {
  if (age < 15) return "u15";
  if (age < 18) return "15_17";
  return "18p";
}

/** Idag − ålder år − 6 månader, kl. 12 UTC. */
function representativeDob(band: AgeBand, now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
  d.setUTCFullYear(d.getUTCFullYear() - BAND_AGE[band]);
  d.setUTCMonth(d.getUTCMonth() - 6);
  return d;
}

export async function POST(req: Request) {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!uid) {
    return NextResponse.json({ ok: false, message: await apiMsg("noSession") }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { band?: unknown };
  if (!isBand(body.band)) {
    return NextResponse.json({ ok: false, message: await apiMsg("invalidRequest") }, { status: 400 });
  }
  const band = body.band;

  const profile = await prisma.profile.findUnique({ where: { userId: uid }, select: { dob: true } });
  if (!profile) {
    return NextResponse.json({ ok: false, message: await apiMsg("invalidRequest") }, { status: 404 });
  }

  const current = profile.dob ? ageFromDob(new Date(profile.dob)) : null;
  if (current !== null && Number.isFinite(current) && bandOf(current) === band) {
    return NextResponse.json({ ok: true, band, changed: false, certMax: seMaxCert(current) });
  }

  const dob = representativeDob(band);
  await prisma.profile.update({ where: { userId: uid }, data: { dob, updatedAt: new Date() } });
  return NextResponse.json({ ok: true, band, changed: true, certMax: seMaxCert(ageFromDob(dob)) });
}
