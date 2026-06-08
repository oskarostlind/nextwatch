import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ok = { ok: true };
type Err = { ok: false; message: string };

const FIVE_MINUTES_MS = 5 * 60 * 1000;

function nowPlusFiveMinutes(): Date {
  return new Date(Date.now() + FIVE_MINUTES_MS);
}

async function cleanup(): Promise<void> {
  // 1) ta bort expired pending
  await prisma.groupInvite.deleteMany({
    where: {
      status: "pending",
      expiresAt: { lt: new Date() },
    },
  });

  // 2) ta bort pending vars grupp inte längre finns
  const allGroups = await prisma.group.findMany({ select: { code: true } });
  const existing = new Set(allGroups.map((g) => g.code));
  if (existing.size === 0) {
    await prisma.groupInvite.deleteMany({ where: { status: "pending" } });
    return;
  }
  await prisma.groupInvite.deleteMany({
    where: {
      status: "pending",
      NOT: { groupCode: { in: Array.from(existing) } },
    },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse<Ok | Err>> {
  const jar = await cookies();
  const fromUserId = jar.get("nw_uid")?.value ?? "";
  const groupCode = jar.get("nw_group")?.value ?? "";

  try {
    const body = (await req.json()) as { toUserId?: string } | unknown;
    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as { toUserId?: string }).toUserId !== "string"
    ) {
      return NextResponse.json(
        { ok: false, message: "Missing toUserId." },
        { status: 400 }
      );
    }
    const toUserId = (body as { toUserId: string }).toUserId;

    if (!fromUserId) {
      return NextResponse.json(
        { ok: false, message: "Not authenticated." },
        { status: 401 }
      );
    }
    if (fromUserId === toUserId) {
      return NextResponse.json(
        { ok: false, message: "Cannot add yourself." },
        { status: 400 }
      );
    }
    if (!groupCode) {
      return NextResponse.json(
        { ok: false, message: "No active group." },
        { status: 400 }
      );
    }

    // cleanup innan vi skapar
    await cleanup();

    // grupp måste finnas
    const group = await prisma.group.findUnique({ where: { code: groupCode } });
    if (!group) {
      // städa bort eventuella orphans från denna code
      await prisma.groupInvite.deleteMany({
        where: { status: "pending", groupCode },
      });
      return NextResponse.json(
        { ok: false, message: "Group does not exist (gone)." },
        { status: 410 }
      );
    }

    // validera att toUser finns
    const toUser = await prisma.user.findUnique({ where: { id: toUserId } });
    if (!toUser) {
      return NextResponse.json(
        { ok: false, message: "User not found." },
        { status: 404 }
      );
    }

    // säkerställ att fromUser är medlem i gruppen
    const member = await prisma.groupMember.findUnique({
      where: { groupCode_userId: { groupCode, userId: fromUserId } },
    });
    if (!member) {
      return NextResponse.json(
        { ok: false, message: "Not a member of the active group." },
        { status: 403 }
      );
    }

    // Inbjudarens namn för notistexten (best-effort).
    const inviter = await prisma.user.findUnique({
      where: { id: fromUserId },
      select: { username: true },
    });
    const fromName = inviter?.username ?? "Någon";
    const notify = () => {
      void sendPushToUser(toUserId, {
        title: "Gruppinbjudan",
        body: `${fromName} bjöd in dig till en grupp`,
        data: { type: "group_invite", groupCode, fromUserId },
      });
    };

    // Upsert: om pending mellan samma par finns, uppdatera den; annars skapa
    const existingPending = await prisma.groupInvite.findFirst({
      where: {
        fromUserId,
        toUserId,
        status: "pending",
      },
    });

    if (existingPending) {
      await prisma.groupInvite.update({
        where: { id: existingPending.id },
        data: {
          groupCode,
          expiresAt: nowPlusFiveMinutes(),
          createdAt: new Date(), // bump sort
        },
      });
      notify();
      return NextResponse.json({ ok: true });
    }

    await prisma.groupInvite.create({
      data: {
        groupCode,
        fromUserId,
        toUserId,
        status: "pending",
        expiresAt: nowPlusFiveMinutes(),
      },
    });

    notify();
    return NextResponse.json({ ok: true });
  } catch (e) {
    // fånga Prisma P2002 → returnera 409 (aldrig 500)
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { ok: false, message: "Invite already pending." },
        { status: 409 }
      );
    }
    console.error("invite POST failed", e);
    return NextResponse.json(
      { ok: false, message: "Internal error." },
      { status: 500 }
    );
  }
}
