import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PublicUser = { id: string; displayName: string | null; username: string | null };

type InviteItem = {
  id: string;
  groupCode: string;
  status: string;
  createdAt: string;
  from?: PublicUser;
  to?: PublicUser;
};

type Payload = {
  ok: true;
  incoming: InviteItem[];
  outgoing: InviteItem[];
};

export async function GET(): Promise<ReturnType<typeof NextResponse.json<Payload>>> {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? "";

  // Städningen (radera utgångna + föräldralösa invites) låg tidigare HÄR och
  // kördes på varje poll (var 5–15 s per klient): två deleteMany-skrivningar
  // plus en OBEGRÄNSAD group.findMany över alla grupper — tre Neon-queries per
  // tick. Den sköts nu av app/api/cron/cleanup i stället; utgångna invites
  // filtreras bort i where-klausulerna nedan så de aldrig visas ändå.
  const now = new Date();
  // Speglar cleanup():s gamla radering (expiresAt < nu): utgångna döljs, men
  // äldre rader utan TTL (expiresAt null) visas precis som förut.
  const notExpired = { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] };

  // Returnera ENDAST pending – gamla accepted/declined visas inte längre i listan
  const [incoming, outgoing] = await Promise.all([
    prisma.groupInvite.findMany({
      where: { toUserId: uid, status: "pending", ...notExpired },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        fromUser: {
          select: {
            id: true,
            username: true,
            profile: { select: { displayName: true } },
          },
        },
      },
    }),
    prisma.groupInvite.findMany({
      where: { fromUserId: uid, status: "pending", ...notExpired },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        toUser: {
          select: {
            id: true,
            username: true,
            profile: { select: { displayName: true } },
          },
        },
      },
    }),
  ]);

  const mapIncoming: InviteItem[] = incoming.map((r) => ({
    id: r.id,
    groupCode: r.groupCode,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    from: {
      id: r.fromUser.id,
      displayName: r.fromUser.profile?.displayName ?? null,
      username: r.fromUser.username ?? null,
    },
  }));

  const mapOutgoing: InviteItem[] = outgoing.map((r) => ({
    id: r.id,
    groupCode: r.groupCode,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    to: {
      id: r.toUser.id,
      displayName: r.toUser.profile?.displayName ?? null,
      username: r.toUser.username ?? null,
    },
  }));

  return NextResponse.json({ ok: true, incoming: mapIncoming, outgoing: mapOutgoing });
}
