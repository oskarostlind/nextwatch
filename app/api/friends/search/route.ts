// app/api/friends/search/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

type Row = {
  id: string;
  username: string | null;
  display_name: string | null;
  is_friend: boolean;
};

type Ok = { ok: true; results: Row[] };
type Err = { ok: false; message: string };

export async function GET(req: NextRequest) {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!uid) return NextResponse.json({ ok: false, message: "Ingen session." } as Err, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const like = `%${q}%`;

  try {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        u.id,
        u.username,
        p.display_name,
        EXISTS(
          SELECT 1
          FROM friendships f
          WHERE (f.user_id = u.id AND f.friend_id = ${uid}) 
             OR (f.user_id = ${uid} AND f.friend_id = u.id)
        ) AS is_friend
      FROM users u
      LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.id <> ${uid}
        AND (
          (u.username IS NOT NULL AND LOWER(u.username) LIKE LOWER(${like}))
          OR
          (p.display_name IS NOT NULL AND LOWER(p.display_name) LIKE LOWER(${like}))
        )
      ORDER BY 
        (CASE WHEN EXISTS(
          SELECT 1
          FROM friendships f
          WHERE (f.user_id = u.id AND f.friend_id = ${uid}) 
             OR (f.user_id = ${uid} AND f.friend_id = u.id)
        ) THEN 1 ELSE 0 END), 
        LOWER(COALESCE(u.username, p.display_name, '')) ASC
      LIMIT 20
    `;

    const body: Ok = { ok: true, results: rows };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[Search Error]:", error);
    return NextResponse.json({ ok: false, message: "Databasfel." } as Err, { status: 500 });
  }
}