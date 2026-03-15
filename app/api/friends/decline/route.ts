// app/api/friends/decline/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

type Ok = { ok: true };
type Err = { ok: false; message: string };

function json(status: number, body: Ok | Err) {
  return NextResponse.json(body, { status });
}

type Body = { requestId?: string };

export async function POST(req: NextRequest) {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!uid) return json(401, { ok: false, message: "Ingen session." });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(400, { ok: false, message: "Ogiltig JSON." });
  }

  const requestId = body.requestId?.trim();
  if (!requestId) return json(400, { ok: false, message: "requestId krävs." });

  const pending = await prisma.friendRequest.findFirst({
    where: { id: requestId, toUserId: uid, status: "pending" },
    select: { id: true },
  });

  if (!pending) {
    return json(404, { ok: false, message: "Ingen väntande förfrågan hittades." });
  }

  await prisma.friendRequest.update({
    where: { id: pending.id },
    data: { status: "declined", decidedAt: new Date() },
  });

  return json(200, { ok: true });
}
