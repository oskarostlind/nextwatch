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

/**
 * Övergivna gäster rensas efter så här länge utan aktivitet. En gäst blir en
 * User+Profile först vid "Hoppa in som gäst" (app/api/profile/guest); utan
 * rensning hopar sig raderna. 30 dagar = en gäst som återkommer inom en månad
 * behåller sin swipe-historik, resten städas. Cascade i schemat tar med
 * ratings, watchlist m.m.
 */
const GUEST_IDLE_DAYS = 30;

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
  const guestCutoff = new Date(now.getTime() - GUEST_IDLE_DAYS * 24 * 60 * 60 * 1000);

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

    // Föräldralösa inbjudningar: pending vars grupp inte längre finns. Låg
    // tidigare i invite/list-GET:en och kördes på varje poll — hör hemma här.
    // Relationen GroupInvite→Group är obligatorisk i Prisma-schemat (går inte
    // att filtrera på `group: { is: null }`), därför rå SQL enligt samma
    // mönster som gruppstädningen ovan. FK-kaskaden gör normalt jobbet redan
    // vid gruppradering; det här är hängslen för rader från tiden före den.
    const orphanInvites = await prisma.$executeRaw`
      DELETE FROM "group_invites" gi
      WHERE gi."status" = 'pending'
        AND NOT EXISTS (SELECT 1 FROM "groups" g WHERE g."code" = gi."group_code")
    `;
    if (orphanInvites > 0) {
      console.log(`[cron/cleanup] rensade ${orphanInvites} föräldralösa inbjudningar.`);
    }

    const verifications = await prisma.verification.deleteMany({
      where: { expiresAt: { lt: verificationCutoff } },
    });

    // Övergivna gäster. Signaturen är medvetet konservativ:
    //   - varken e-post eller Apple → inget riktigt konto
    //   - profilens displayName = 'Gäst' → har INTE gått igenom onboardingen
    //     (som sätter ett riktigt namn). Utan detta skulle en fullt onboardad
    //     användare utan registrerad e-post råka flaggas.
    //   - inaktiv > 30 dagar (last_active_at, annars created_at)
    //   - inga sociala band: inte med i någon grupp, inga vänner eller
    //     vänförfrågningar. En gäst mitt i något ska inte försvinna.
    // Räkna och logga FÖRST — aldrig en tyst massradering (samma princip som
    // resten av appen). Cascade i schemat städar ratings/watchlist/tokens.
    const guestWhere = `
      u."email" IS NULL
      AND u."apple_sub" IS NULL
      AND EXISTS (SELECT 1 FROM "profiles" p WHERE p."user_id" = u."id" AND p."display_name" = 'Gäst')
      AND COALESCE(u."last_active_at", u."created_at") < $1
      AND NOT EXISTS (SELECT 1 FROM "group_members" gm WHERE gm."user_id" = u."id")
      AND NOT EXISTS (SELECT 1 FROM "friendships" f WHERE f."user_id" = u."id" OR f."friend_id" = u."id")
      AND NOT EXISTS (SELECT 1 FROM "friend_requests" fr WHERE fr."from_user_id" = u."id" OR fr."to_user_id" = u."id")
    `;
    const guestPreview = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM "users" u WHERE ${guestWhere}`,
      guestCutoff,
    );
    const guestCount = Number(guestPreview[0]?.count ?? 0);
    console.log(`[cron/cleanup] rensar ${guestCount} övergivna gäster (inaktiva > ${GUEST_IDLE_DAYS} dagar).`);
    const guestsDeleted =
      guestCount > 0
        ? await prisma.$executeRawUnsafe(`DELETE FROM "users" u WHERE ${guestWhere}`, guestCutoff)
        : 0;

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
        guests: guestsDeleted,
      },
    });
  } catch (e) {
    console.error("[cron/cleanup]", e);
    return NextResponse.json({ ok: false, message: "Cleanup failed." }, { status: 500 });
  }
}
