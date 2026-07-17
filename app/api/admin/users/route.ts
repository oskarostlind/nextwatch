// app/api/admin/users/route.ts — sökbar användarlista för admin-vyn.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export async function GET(req: NextRequest) {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!(await isAdmin(uid))) {
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);

  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" as const } },
          { username: { contains: q, mode: "insensitive" as const } },
          { profile: { displayName: { contains: q, mode: "insensitive" as const } } },
        ],
      }
    : {};

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        email: true,
        username: true,
        plan: true,
        emailVerified: true,
        createdAt: true,
        lastActiveAt: true,
        profile: { select: { displayName: true, avatarId: true } },
        _count: { select: { ratings: true } },
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    total,
    page,
    pageSize: PAGE_SIZE,
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      username: u.username,
      displayName: u.profile?.displayName ?? null,
      avatarId: u.profile?.avatarId ?? null,
      plan: u.plan,
      verified: Boolean(u.emailVerified),
      createdAt: u.createdAt.toISOString(),
      lastActiveAt: u.lastActiveAt ? u.lastActiveAt.toISOString() : null,
      ratings: u._count.ratings,
    })),
  });
}
