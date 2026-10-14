// app/api/pick/selftest/route.ts
//
// GET /api/pick/selftest?uid=…&prompt=…&chips=light,short&media=both&exclude=1,2&lang=sv&session=abc
//     [&followUpOf=<requestId>&focus=tv:1408&markSeen=1] [&auto=1]
//
// Kör HELA "Välj åt mig"-pipelinen för en användare utan att debitera
// (loggas med source 'selftest') och returnerar PickResponse + debug
// (kandidatantal sparade/färska, modell, tokens, kostnad, latens, fallback).
// Fungerar oavsett PICK_ROLLOUT. Utan uid används ADMIN_EMAIL-användaren.
//
// Följdfrågor: kör först med &session=X, sedan med samma session och t.ex.
// &prompt=kortare — selftest-raderna räknas som turer i samtalet (debug.followUp
// visar sammanslagna önskemål, uteslutna id:n och referens). &markSeen=1
// sparar ALDRIG här — debug.followUp.markSeen säger bara vad som skulle markeras.
//
// Skyddad med CRON_SECRET — samma mönster som app/api/cron/*:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     "https://www.nextwatch.se/api/pick/selftest?prompt=n%C3%A5got%20mysigt&chips=short"

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeLocale } from "@/lib/i18nConfig";
import { pickRequestSchema } from "@/lib/aiPick/schema";
import { normalizePickBody, runPick } from "@/lib/aiPick/pick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false;
  const header = req.headers.get("x-cron-secret") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  return header === secret || authHeader === `Bearer ${secret}`;
}

/** "tv:1408" / "movie:603" → focus. */
function parseFocus(v: string | null): { tmdbId: number; mediaType: "movie" | "tv" } | undefined {
  const m = (v ?? "").match(/^(movie|tv):(\d{1,9})$/);
  return m ? { mediaType: m[1] as "movie" | "tv", tmdbId: Number(m[2]) } : undefined;
}

function csv(v: string | null): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const sp = new URL(req.url).searchParams;
  let uid = sp.get("uid")?.trim() || null;
  if (!uid) {
    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    if (adminEmail) {
      const u = await prisma.user.findFirst({
        where: { email: { equals: adminEmail, mode: "insensitive" } },
        select: { id: true },
      });
      uid = u?.id ?? null;
    }
  }
  if (!uid) return NextResponse.json({ ok: false, message: "uid saknas (och ingen ADMIN_EMAIL-användare)" }, { status: 400 });

  const parsed = pickRequestSchema.safeParse({
    prompt: sp.get("prompt") ?? undefined,
    chips: csv(sp.get("chips")),
    mediaFilter: sp.get("media") ?? sp.get("mediaFilter") ?? undefined,
    exclude: csv(sp.get("exclude")).map(Number),
    sessionId: sp.get("session") || undefined,
    followUpOf: sp.get("followUpOf") || undefined,
    focus: parseFocus(sp.get("focus")),
    markSeen: sp.get("markSeen") === "1" || sp.get("markSeen") === "true" ? true : undefined,
    // &auto=1: auto-förslagets prompt (sparade likes först) — loggas ändå som selftest.
    auto: sp.get("auto") === "1" || sp.get("auto") === "true" ? true : undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  }

  const profile = await prisma.profile.findUnique({
    where: { userId: uid },
    select: { uiLanguage: true, region: true },
  });
  const uiLocale = normalizeLocale(sp.get("lang") ?? profile?.uiLanguage);

  const result = await runPick({
    uid,
    body: normalizePickBody(parsed.data),
    region: sp.get("region") ?? profile?.region ?? null,
    uiLocale,
    mode: "selftest",
  });

  return NextResponse.json(
    { httpStatus: result.status, ...result.body, debug: result.debug },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
