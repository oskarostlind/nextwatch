// app/api/group/settings/route.ts
//
// Gruppinställningar (kugghjulet). GET: alla medlemmar kan läsa. PATCH: endast
// gruppens skapare. Tomma/null-värden = automatik (union av medlemmarnas
// profiler, yngsta medlemmens åldersgräns, 60 % matchtröskel).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import {
  DEFAULT_MATCH_THRESHOLD,
  isValidCert,
  isValidThreshold,
  parseProvidersJson,
  sanitizeGenres,
  type GroupSettings,
} from "@/lib/groupSettings";

type Ok = {
  ok: true;
  code: string;
  isCreator: boolean;
  settings: GroupSettings;
  defaults: { matchThreshold: number };
};
type Err = { ok: false; message: string };

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, message } as Err, { status });
}

function toSettingsDto(g: {
  favoriteGenres: string[];
  dislikedGenres: string[];
  providers: unknown;
  maxCert: string | null;
  matchThreshold: number | null;
}): GroupSettings {
  return {
    favoriteGenres: g.favoriteGenres,
    dislikedGenres: g.dislikedGenres,
    providers: parseProvidersJson(g.providers),
    maxCert: isValidCert(g.maxCert) ? g.maxCert : null,
    matchThreshold: g.matchThreshold,
  };
}

export async function GET(req: NextRequest) {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!uid) return bad("Ingen session.", 401);

  const code = (new URL(req.url).searchParams.get("code") || "").toUpperCase();
  if (!code) return bad("Gruppkod saknas.");

  const group = await prisma.group.findUnique({
    where: { code },
    select: {
      code: true,
      createdBy: true,
      favoriteGenres: true,
      dislikedGenres: true,
      providers: true,
      maxCert: true,
      matchThreshold: true,
      members: { where: { userId: uid }, select: { userId: true } },
    },
  });
  if (!group) return bad("Gruppen finns inte.", 404);
  if (group.members.length === 0) return bad("Du är inte medlem i gruppen.", 403);

  return NextResponse.json({
    ok: true,
    code: group.code,
    isCreator: group.createdBy === uid,
    settings: toSettingsDto(group),
    defaults: { matchThreshold: DEFAULT_MATCH_THRESHOLD },
  } as Ok);
}

type PatchBody = {
  code?: string;
  favoriteGenres?: unknown;
  dislikedGenres?: unknown;
  providers?: unknown;
  maxCert?: unknown;
  matchThreshold?: unknown;
};

export async function PATCH(req: NextRequest) {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!uid) return bad("Ingen session.", 401);

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return bad("Ogiltig payload.");
  }

  const code = (body.code || "").toUpperCase();
  if (!code) return bad("Gruppkod saknas.");

  const group = await prisma.group.findUnique({
    where: { code },
    select: { code: true, createdBy: true },
  });
  if (!group) return bad("Gruppen finns inte.", 404);
  if (group.createdBy !== uid) {
    return bad("Endast gruppens skapare kan ändra inställningarna.", 403);
  }

  const data: {
    favoriteGenres?: string[];
    dislikedGenres?: string[];
    providers?: string[];
    maxCert?: string | null;
    matchThreshold?: number | null;
  } = {};

  if ("favoriteGenres" in body) {
    const g = sanitizeGenres(body.favoriteGenres);
    if (g === null) return bad("Ogiltiga genrer.");
    data.favoriteGenres = g;
  }
  if ("dislikedGenres" in body) {
    const g = sanitizeGenres(body.dislikedGenres);
    if (g === null) return bad("Ogiltiga genrer.");
    data.dislikedGenres = g;
  }
  if ("providers" in body) {
    if (!Array.isArray(body.providers) || body.providers.some((p) => typeof p !== "string")) {
      return bad("Ogiltiga streamingtjänster.");
    }
    data.providers = body.providers as string[];
  }
  if ("maxCert" in body) {
    if (body.maxCert !== null && !isValidCert(body.maxCert)) return bad("Ogiltig åldersgräns.");
    data.maxCert = body.maxCert as string | null;
  }
  if ("matchThreshold" in body) {
    if (body.matchThreshold !== null && !isValidThreshold(body.matchThreshold)) {
      return bad("Ogiltig matchtröskel (1–100).");
    }
    data.matchThreshold = body.matchThreshold as number | null;
  }

  if (Object.keys(data).length === 0) return bad("Inget att uppdatera.");

  const updated = await prisma.group.update({
    where: { code },
    data,
    select: {
      code: true,
      favoriteGenres: true,
      dislikedGenres: true,
      providers: true,
      maxCert: true,
      matchThreshold: true,
    },
  });

  return NextResponse.json({
    ok: true,
    code: updated.code,
    isCreator: true,
    settings: toSettingsDto(updated),
    defaults: { matchThreshold: DEFAULT_MATCH_THRESHOLD },
  } as Ok);
}
