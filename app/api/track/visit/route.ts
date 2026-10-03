// app/api/track/visit/route.ts — registrerar ETT första besök med källa.
//
// Middleware sätter källcookien (nw_src) och flaggan nw_src_new på första
// sidvisningen; AcquisitionBeacon postar hit en gång. Crawlers kör inte JS
// och räknas därför inte. Se lib/acquisition.ts.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { ACQ_NEW_FLAG } from "@/lib/acquisition";
import { readAcquisitionCookie, stampAcquisition } from "@/lib/acquisitionServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Flaggan tas alltid bort, även om något nedan misslyckas — annars postar
  // klienten igen på varje sidvisning i ett dygn.
  res.cookies.set(ACQ_NEW_FLAG, "", { path: "/", maxAge: 0 });

  try {
    const jar = await cookies();
    if (!jar.get(ACQ_NEW_FLAG)) return res;
    const visitorId = jar.get("nw_uid")?.value ?? null;
    const acq = await readAcquisitionCookie();
    if (!visitorId || !acq) return res;

    const already = await prisma.acquisitionVisit.findFirst({ where: { visitorId }, select: { id: true } });
    if (!already) {
      await prisma.acquisitionVisit.create({
        data: {
          visitorId,
          source: acq.source,
          medium: acq.medium,
          campaign: acq.campaign,
          content: acq.content,
          referrer: acq.referrer,
          landing: acq.landing,
        },
      });
    }
    // Finns redan en användarrad (t.ex. inloggad i appen) — stämpla den också.
    await stampAcquisition(visitorId, acq);
  } catch (e) {
    console.warn("[track/visit]", e instanceof Error ? e.message : e);
  }
  return res;
}
