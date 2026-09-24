// app/api/group/create/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import crypto from "node:crypto";
import { apiMsg } from "@/lib/apiMessages";

type CreateOk = {
  ok: true;
  group: {
    code: string;
    createdAt: string; // <- serialiserad ISO-sträng
    createdBy: string;
  };
};

type CreateErr = {
  ok: false;
  message?: string;
};

function genCode(length: number = 6): string {
  // A–Z + 2–9, utan lättförväxlade tecken
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(length);
  let s = "";
  for (let i = 0; i < length; i += 1) {
    const idx = bytes[i] % alphabet.length;
    s += alphabet[idx] ?? "A";
  }
  return s;
}

export async function POST(): Promise<NextResponse<CreateOk | CreateErr>> {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value ?? null;
    if (!uid) {
      return NextResponse.json({ ok: false, message: await apiMsg("noSession") }, { status: 401 });
    }

    // Generera (praktiskt taget) unik kod med skydd mot extremt osannolik kollision
    let code = genCode();
    for (let i = 0; i < 5; i += 1) {
      const exists = await prisma.group.findUnique({ where: { code } });
      if (!exists) break;
      code = genCode();
    }

    const created = await prisma.group.create({
      data: { code, createdBy: uid },
      select: { code: true, createdAt: true, createdBy: true },
    });

    // Skaparen blir medlem
    await prisma.groupMember.upsert({
      where: { groupCode_userId: { groupCode: created.code, userId: uid } },
      update: {},
      create: { groupCode: created.code, userId: uid },
    });

    // Serialisera createdAt -> string för att matcha dina typer/DTO
    const group = {
      code: created.code,
      createdAt: created.createdAt.toISOString(),
      createdBy: created.createdBy,
    };

    // Klientläsbar cookie så UI direkt ser aktiv grupp
    const res = NextResponse.json<CreateOk>({ ok: true, group });
    res.cookies.set({
      name: "nw_group",
      value: group.code,
      httpOnly: false,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 14, // 14 dagar
    });
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : await apiMsg("internalError");
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
