// app/api/report/route.ts
//
// Anmälan av en annan användare. App Store Guideline 1.2 kräver att appar med
// användargenererat innehåll (här: visningsnamn, användarnamn och delade
// filmtips mellan vänner) har BÅDE en rapport- och en blockeringsmekanism samt
// en publicerad kontaktväg till utvecklaren. Blockeringen finns i
// /api/friends/block; den här routen är rapportdelen.
//
// Rapporten mailas till supportadressen — ingen ny tabell behövs, och ärendet
// hamnar där vi ändå läser (support@nextwatch.se). Rapporten blockerar också
// den anmälde som standard, så att den som rapporterar slipper fortsatt kontakt
// medan vi tittar på ärendet.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { sendReportMail } from "@/lib/email";
import { rateLimitAllow, getRateLimitKey } from "@/lib/rateLimit";

/** Förvalda skäl i UI:t. Fritexten är valfri och kapas hårt. */
const REASONS = [
  "olämpligt-namn",
  "trakasserier",
  "spam",
  "olämpligt-innehåll",
  "annat",
] as const;

type Reason = (typeof REASONS)[number];

function isReason(v: unknown): v is Reason {
  return typeof v === "string" && (REASONS as readonly string[]).includes(v);
}

export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const me = jar.get("nw_uid")?.value ?? "";
    if (!me) {
      return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });
    }

    // Rapportspam ska inte kunna sänka SMTP-kontot.
    if (!rateLimitAllow(getRateLimitKey(req, me), "report", { limit: 10 })) {
      return NextResponse.json(
        { ok: false, message: "För många rapporter. Försök igen om en stund." },
        { status: 429 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      userId?: string;
      reason?: string;
      details?: string;
      block?: boolean;
    };

    const userId = (body.userId ?? "").trim();
    const reason: Reason = isReason(body.reason) ? body.reason : "annat";
    const details = (body.details ?? "").toString().trim().slice(0, 1000);
    const alsoBlock = body.block !== false;

    if (!userId) {
      return NextResponse.json({ ok: false, message: "userId krävs." }, { status: 400 });
    }
    if (userId === me) {
      return NextResponse.json({ ok: false, message: "Ogiltig mottagare." }, { status: 400 });
    }

    const [reporter, target] = await Promise.all([
      prisma.user.findUnique({
        where: { id: me },
        select: { id: true, email: true, username: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          email: true,
          profile: { select: { displayName: true } },
        },
      }),
    ]);

    if (!target) {
      return NextResponse.json({ ok: false, message: "Användaren finns inte." }, { status: 404 });
    }

    // Blockera först: rapporten får aldrig fastna på ett SMTP-fel och lämna
    // användaren utan skydd.
    if (alsoBlock) {
      await prisma.$transaction(async (tx) => {
        await tx.friendship.deleteMany({
          where: {
            OR: [
              { userId: me, friendId: userId },
              { userId, friendId: me },
            ],
          },
        });
        await tx.friendRequest.deleteMany({
          where: {
            status: "pending",
            OR: [
              { fromUserId: me, toUserId: userId },
              { fromUserId: userId, toUserId: me },
            ],
          },
        });
        await tx.friendRequest.upsert({
          where: { fromUserId_toUserId: { fromUserId: me, toUserId: userId } },
          create: { fromUserId: me, toUserId: userId, status: "blocked", decidedAt: new Date() },
          update: { status: "blocked", decidedAt: new Date() },
        });
      });
    }

    let mailed = false;
    try {
      await sendReportMail({
        reporterId: reporter?.id ?? me,
        reporterUsername: reporter?.username ?? null,
        reporterEmail: reporter?.email ?? null,
        targetId: target.id,
        targetUsername: target.username ?? null,
        targetDisplayName: target.profile?.displayName ?? null,
        reason,
        details,
        blocked: alsoBlock,
      });
      mailed = true;
    } catch (e) {
      // Rapporten är ändå registrerad i loggen och blockeringen är gjord.
      console.error("[report] kunde inte maila supporten:", e instanceof Error ? e.message : e);
    }

    console.warn(
      `[report] ${me} rapporterade ${target.id} (${reason})${alsoBlock ? " + blockerade" : ""}${
        mailed ? "" : " – MAIL MISSLYCKADES"
      }`
    );

    return NextResponse.json({ ok: true, blocked: alsoBlock });
  } catch {
    return NextResponse.json({ ok: false, message: "Internt fel." }, { status: 500 });
  }
}
