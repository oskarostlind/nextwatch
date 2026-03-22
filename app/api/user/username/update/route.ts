// app/api/user/username/update/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

type Ok = { ok: true; username: string | null };
type Err = { ok: false; message: string };

type Body = { username: string | null };

function valid(u: string): boolean {
  return /^[a-z0-9_.]{3,20}$/.test(u);
}

type ExistsRow = { exists: boolean };

export async function POST(req: NextRequest) {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!uid) return NextResponse.json({ ok: false, message: "Ingen session." } as Err, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, message: "Ogiltig JSON." } as Err, { status: 400 });
  }

  const desiredRaw = body.username;
  const desired =
    desiredRaw === null || typeof desiredRaw === "undefined"
      ? null
      : typeof desiredRaw === "string"
        ? desiredRaw.trim().toLowerCase()
        : null;

  if (desired !== null && desired !== "" && !valid(desired)) {
    return NextResponse.json({ ok: false, message: "Ogiltigt användarnamn." } as Err, { status: 400 });
  }

  const toStore = desired === "" ? null : desired;

  if (toStore !== null) {
    const taken = await prisma.$queryRaw<ExistsRow[]>`
      SELECT EXISTS(
        SELECT 1 FROM users
        WHERE username IS NOT NULL
          AND LOWER(username) = LOWER(${toStore})
          AND id <> ${uid}
      ) AS exists
    `;
    if (taken[0]?.exists) {
      return NextResponse.json({ ok: false, message: "Upptaget." } as Err, { status: 409 });
    }
  }

  await prisma.$executeRaw`
    UPDATE users
    SET username = ${toStore}
    WHERE id = ${uid}
  `;

  return NextResponse.json({ ok: true, username: toStore } as Ok);
}
