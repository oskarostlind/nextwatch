// app/api/user/username/check/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

type Ok = { ok: true; available: boolean };
type Err = { ok: false; message: string };

function valid(u: string): boolean {
  return /^[a-z0-9_.]{3,20}$/.test(u);
}

type ExistsRow = { exists: boolean };

export async function GET(req: NextRequest) {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!uid) return NextResponse.json({ ok: false, message: "Ingen session." } as Err, { status: 401 });

  const u = new URL(req.url);
  const username = (u.searchParams.get("u") ?? u.searchParams.get("username") ?? "").trim().toLowerCase();
  if (!username) {
    return NextResponse.json({ ok: false, message: "Saknar 'username'." } as Err, { status: 400 });
  }
  if (!valid(username)) {
    return NextResponse.json({ ok: false, message: "Ogiltigt format." } as Err, { status: 400 });
  }

  const exists = await prisma.$queryRaw<ExistsRow[]>`
    SELECT EXISTS(
      SELECT 1 FROM users
      WHERE username IS NOT NULL
        AND LOWER(username) = LOWER(${username})
        AND id <> ${uid}
    ) AS exists
  `;

  return NextResponse.json({ ok: true, available: !Boolean(exists[0]?.exists) } as Ok);
}
