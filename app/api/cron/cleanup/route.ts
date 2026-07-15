// app/api/cron/cleanup/route.ts
//
// Schemalagd städning av data ingen läser. Körs dagligen via vercel.json.
//
// Bakgrund: allt utom det här växer i evighet. Grupper är den stora posten —
// inte grupperna själva utan deras GroupVote (medlemmar × swipade titlar), som
// ligger kvar för en filmkväll ingen öppnar igen. Kaskaderna i schemat gör
// jobbet: raderas gruppen följer röster, medlemskap, inbjudningar och
// matchhistorik med.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * En grupp anses död efter ett dygn utan aktivitet. Grupperna är avsedda att
 * vara tillfälliga — inbjudningarna lever bara 5 minuter — så en grupp som
 * ingen rört på ett dygn är en filmkväll som tagit slut.
 *
 * OBS: cronen kör en gång om dygnet, så den faktiska livslängden blir 24–48h
 * beroende på när gruppen somnade i förhållande till körningen.
 */
const GROUP_IDLE_HOURS = 24;

/**
 * Nådetid för utgångna verifieringstokens. Utan den skulle en användare som
 * precis klickat på en för gammal länk få "ogiltig länk" i stället för
 * "länken har gått ut" — samma utfall, sämre besked.
 */
const VERIFICATION_GRACE_DAYS = 7;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false;
  // Vercel Cron skickar "Authorization: Bearer <CRON_SECRET>"; x-cron-secret
  // finns kvar för manuella körningar. Samma mönster som daily-recs.
  const header = req.headers.get("x-cron-secret") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  return header === secret || authHeader === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const groupCutoff = new Date(now.getTime() - GROUP_IDLE_HOURS * 60 * 60 * 1000);
  const verificationCutoff = new Date(now.getTime() - VERIFICATION_GRACE_DAYS * 24 * 60 * 60 * 1000);

  try {
    // Grupper: senaste aktivitet = senaste rösten, annars senaste medlem som
    // gick med, annars när gruppen skapades. Group saknar egen updatedAt, och
    // "max över två relationer" går inte att uttrycka i deleteMany — därför rå
    // SQL. Cascade i schemat städar barnen.
    const groupsDeleted = await prisma.$executeRaw`
      DELETE FROM "groups" g
      WHERE GREATEST(
        g."created_at",
        COALESCE((SELECT MAX(v."decided_at") FROM "group_votes" v WHERE v."group_code" = g."code"), g."created_at"),
        COALESCE((SELECT MAX(m."joined_at") FROM "group_members" m WHERE m."group_code" = g."code"), g."created_at")
      ) < ${groupCutoff}
    `;

    // Inbjudningar som gått ut utan svar. Skapas städas opportunistiskt i
    // invite-routen, men bara när någon råkar bjuda in — inte annars.
    const expiredInvites = await prisma.groupInvite.deleteMany({
      where: { status: "pending", expiresAt: { lt: now } },
    });

    // Besvarade inbjudningar läses aldrig av någon — invite/list returnerar
    // enbart pending. De ligger kvar och krockar dessutom med
    // uq_group_invites_pair_status. Sedan invite/respond raderar i stället för
    // att uppdatera status skapas inga nya; det här rensar de gamla.
    const respondedInvites = await prisma.groupInvite.deleteMany({
      where: { status: { not: "pending" } },
    });

    const verifications = await prisma.verification.deleteMany({
      where: { expiresAt: { lt: verificationCutoff } },
    });

    // PushToken städas inte här: lib/push.ts raderar tokens redan när Apple
    // svarar 410/BadDeviceToken, vilket är den enda pålitliga signalen om att
    // en enhet är borta.

    return NextResponse.json({
      ok: true,
      deleted: {
        groups: groupsDeleted,
        expiredInvites: expiredInvites.count,
        respondedInvites: respondedInvites.count,
        verifications: verifications.count,
      },
    });
  } catch (e) {
    console.error("[cron/cleanup]", e);
    return NextResponse.json({ ok: false, message: "Cleanup failed." }, { status: 500 });
  }
}
