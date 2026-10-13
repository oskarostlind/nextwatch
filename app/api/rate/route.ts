import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSwipeAllowance, swipeLimitPayload } from "../../../lib/swipeLimit";
import { saveSwipeDecision } from "../../../lib/swipeDecision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Decision = "like"|"dislike"|"skip"|"seen";

export async function POST(req: Request) {
  try {
    const c = await cookies();
    const uid = c.get("nw_uid")?.value;
    if (!uid) return NextResponse.json({ ok:false, error:"no cookie" }, { status:400 });

    const body: unknown = await req.json();
    if (typeof body !== "object" || body == null) throw new Error("bad body");
    const { tmdbId, mediaType, decision } = body as { tmdbId:number; mediaType:"movie"|"tv"; decision:Decision };
    if (!tmdbId || (mediaType!=="movie" && mediaType!=="tv")) throw new Error("bad input");

    // Daglig swipegräns för gratisanvändare (premium = obegränsat).
    const allowance = await getSwipeAllowance(uid);
    if (!allowance.allowed) {
      return NextResponse.json(await swipeLimitPayload(allowance), { status: 429 });
    }

    // Samma skrivning som "Har sett den" i Välj åt mig (lib/swipeDecision.ts):
    // upsert av beslutet — rating rörs INTE (se kommentaren där) — plus
    // genrestatistiken fire-and-forget.
    await saveSwipeDecision({ userId: uid, tmdbId, mediaType, decision });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok:false, error: msg }, { status:400 });
  }
}
