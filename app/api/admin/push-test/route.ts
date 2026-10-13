// app/api/admin/push-test/route.ts — förhandsvisa och skicka testpushar till admin själv.
//
// GET  ?type=daily_rec|weekly_picks|watchlist_nudge|time_sensitive_demo&angle=<valfri>
//      → komponerar via composeRecPush (samma kod som cronen) och returnerar
//        { ok, composed } UTAN att skicka. GET ?meta=1 → { ok, types, angles } till väljarna.
// POST { type, angle? } → komponerar likadant och skickar på riktigt med
//        sendPushToUser till adminens egna enheter → { ok, sent, pid, composed }.
//
// Skickar bara till inloggade admin (isAdmin på nw_uid) och bara till admin själv, så
// cronens frekvenstak behöver inte respekteras. Notispreferensen (notifyDailyRecs)
// och "har enhet" gäller dock fortfarande → sent:false förklarar det.
//
// time_sensitive_demo: en vanlig daily_rec men med interruptionLevel "time-sensitive",
// så att man kan verifiera entitlementet på enheten. data.type förblir "daily_rec" —
// annars skulle pushen få sidoeffekter (loggning/preferenser för en annan typ).
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAdmin } from "@/lib/adminAuth";
import { sendPushToUser } from "@/lib/push";
import { composeRecPush, REC_ANGLES, type ComposedPush, type RecPushType } from "@/lib/pushRecs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const REC_TYPES: readonly RecPushType[] = ["daily_rec", "weekly_picks", "watchlist_nudge"];
const DEMO = "time_sensitive_demo";

type Parsed = { forceType: RecPushType; forceAngle?: string; demo: boolean };

function parse(type: unknown, angle: unknown): Parsed | { error: string } {
  const t = typeof type === "string" ? type : "";
  const demo = t === DEMO;
  const forceType = (demo ? "daily_rec" : t) as RecPushType;
  if (!demo && !REC_TYPES.includes(forceType)) {
    return { error: `Ogiltig typ. Välj en av ${[...REC_TYPES, DEMO].join(", ")}.` };
  }
  let forceAngle: string | undefined;
  if (typeof angle === "string" && angle.trim()) {
    forceAngle = angle.trim();
    // Vinkeln kan komma med variant ("person.v2") — validera mot basen.
    if (!REC_ANGLES.includes(forceAngle.split(".")[0])) return { error: "Okänd vinkel." };
  }
  return { forceType, forceAngle, demo };
}

async function compose(uid: string, p: Parsed): Promise<ComposedPush | null> {
  const composed = await composeRecPush(uid, { forceType: p.forceType, forceAngle: p.forceAngle });
  if (!composed) return null;
  if (!p.demo) return composed;
  return { ...composed, payload: { ...composed.payload, interruptionLevel: "time-sensitive" } };
}

const NOTHING = "Inget att föreslå för dig just nu (tom watchlist/rekommendationer för den här typen).";

async function adminUid(): Promise<string | null> {
  const uid = (await cookies()).get("nw_uid")?.value ?? null;
  return (await isAdmin(uid)) ? uid : null;
}

export async function GET(req: NextRequest) {
  const uid = await adminUid();
  if (!uid) return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  // ?meta=1: vinkellistan till väljaren i panelen (REC_ANGLES är serverkod och kan
  // inte importeras i klienten utan att dra med prisma/TMDB-koden).
  if (sp.get("meta")) {
    return NextResponse.json({ ok: true, types: [...REC_TYPES, DEMO], angles: [...REC_ANGLES] });
  }
  const p = parse(sp.get("type"), sp.get("angle"));
  if ("error" in p) return NextResponse.json({ ok: false, message: p.error }, { status: 400 });

  try {
    const composed = await compose(uid, p);
    if (!composed) return NextResponse.json({ ok: false, message: NOTHING });
    return NextResponse.json({ ok: true, composed });
  } catch (e) {
    console.error("[admin/push-test GET]", e);
    return NextResponse.json({ ok: false, message: "Kunde inte komponera pushen." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const uid = await adminUid();
  if (!uid) return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { type?: unknown; angle?: unknown } | null;
  const p = parse(body?.type, body?.angle);
  if ("error" in p) return NextResponse.json({ ok: false, message: p.error }, { status: 400 });

  try {
    const composed = await compose(uid, p);
    if (!composed) return NextResponse.json({ ok: false, sent: false, message: NOTHING });
    const res = await sendPushToUser(uid, composed.payload);
    return NextResponse.json({ ok: true, sent: res.sent, pid: res.pid ?? null, composed });
  } catch (e) {
    console.error("[admin/push-test POST]", e);
    return NextResponse.json({ ok: false, sent: false, message: "Kunde inte skicka testpushen." }, { status: 500 });
  }
}
