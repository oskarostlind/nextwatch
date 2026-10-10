// app/api/track/funnel/route.ts — tar emot mätpunkter från lib/funnel.ts.
//
// Första anropet per enhet är "first_open": då avgörs om enheten ska spåras
// alls. En etablerad användare (konto äldre än en timme som redan swipat) på en
// ny enhet eller efter en uppdatering är INTE en ny användare — då svarar vi
// track=false och skriver ingenting, så tratten bara innehåller riktiga nya.
//
// Varje steg sparas en gång per enhet (PK device_id+name, ON CONFLICT DO
// NOTHING) — utom last_exit som skrivs över varje gång appen göms.
// Svarar alltid 200; fel loggas och sväljs.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { readAcquisitionCookie } from "@/lib/acquisitionServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAME_RE = /^[a-z0-9_:/.-]{1,60}$/;
const DEVICE_RE = /^[a-z0-9]{8,64}$/;

type Body = {
  device?: unknown;
  name?: unknown;
  platform?: unknown;
  path?: unknown;
  props?: unknown;
};

/** Platta, små props: bara strängar/tal/booleans, max 12 nycklar. */
function cleanProps(p: unknown): Record<string, string | number | boolean | null> | null {
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(p as Record<string, unknown>).slice(0, 12)) {
    if (!/^[a-zA-Z0-9_]{1,30}$/.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 120);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
    else if (typeof v === "boolean" || v === null) out[k] = v;
  }
  return out;
}

async function isEstablishedUser(uid: string | null): Promise<boolean> {
  if (!uid) return false;
  const u = await prisma.user.findUnique({
    where: { id: uid },
    select: { createdAt: true, _count: { select: { ratings: true } } },
  });
  if (!u) return false;
  return Date.now() - u.createdAt.getTime() > 60 * 60 * 1000 && u._count.ratings > 0;
}

export async function POST(req: Request) {
  let track = true;
  try {
    // sendBeacon kan skicka utan JSON-header — läs alltid som text.
    const body = JSON.parse(await req.text()) as Body;
    const device = typeof body.device === "string" ? body.device.toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name : "";
    if (!DEVICE_RE.test(device) || !NAME_RE.test(name)) {
      return NextResponse.json({ ok: false, track: false });
    }
    const platform = body.platform === "ios" ? "ios" : "web";
    const path = typeof body.path === "string" ? body.path.slice(0, 120) : null;
    const props = cleanProps(body.props);
    const uid = (await cookies()).get("nw_uid")?.value ?? null;

    if (name === "first_open") {
      if (await isEstablishedUser(uid)) {
        return NextResponse.json({ ok: true, track: false });
      }
    } else {
      // Steg från en enhet som aldrig registrerade first_open — ignorera.
      const known = await prisma.$queryRaw<{ ok: number }[]>`
        SELECT 1 AS ok FROM funnel_events WHERE device_id = ${device} AND name = 'first_open' LIMIT 1
      `;
      if (known.length === 0) return NextResponse.json({ ok: true, track: false });
    }

    const acq = name === "first_open" ? await readAcquisitionCookie().catch(() => null) : null;
    await prisma.$executeRaw`
      INSERT INTO funnel_events (device_id, name, user_id, platform, source, path, props)
      VALUES (${device}, ${name}, ${uid}, ${platform}, ${acq?.source ?? null}, ${path},
              ${props ? JSON.stringify(props) : null}::jsonb)
      ON CONFLICT (device_id, name) DO NOTHING
    `;
    // last_exit skrivs över vid varje stängning: var enheten var SISTA gången.
    if (name === "last_exit") {
      await prisma.$executeRaw`
        UPDATE funnel_events
        SET path = ${path}, props = ${props ? JSON.stringify(props) : null}::jsonb,
            created_at = (now() AT TIME ZONE 'UTC'), user_id = COALESCE(${uid}, user_id)
        WHERE device_id = ${device} AND name = 'last_exit'
      `;
    }
  } catch (e) {
    // Tabellen saknas (db push ej körd) eller trasig body — spåra inte.
    track = false;
    console.warn("[track/funnel]", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true, track });
}
