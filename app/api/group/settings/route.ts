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
  groupMatchNeed,
  isValidCert,
  isValidThreshold,
  parseProvidersJson,
  sanitizeGenres,
  sanitizeKeywordIds,
  type GroupSettings,
} from "@/lib/groupSettings";
import { isValidSwipeMediaFilter } from "@/lib/swipeMediaFilter";

type Ok = {
  ok: true;
  code: string;
  isCreator: boolean;
  settings: GroupSettings;
  /** Aktuellt antal medlemmar — styr slaidern för anpassad matchtröskel i UI:t. */
  memberCount: number;
  /** Vad matchtröskeln (antal personer) faktiskt blir just nu om ingen anpassad är satt. */
  defaults: { matchNeed: number };
};
type Err = { ok: false; message: string };

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, message } as Err, { status });
}

function toSettingsDto(g: {
  favoriteGenres: string[];
  dislikedGenres: string[];
  favoriteKeywordIds: number[];
  providers: unknown;
  maxCert: string | null;
  matchThreshold: number | null;
  mediaFilter: string;
}): GroupSettings {
  return {
    favoriteGenres: g.favoriteGenres,
    dislikedGenres: g.dislikedGenres,
    favoriteKeywordIds: g.favoriteKeywordIds,
    providers: parseProvidersJson(g.providers),
    maxCert: isValidCert(g.maxCert) ? g.maxCert : null,
    matchThreshold: g.matchThreshold,
    mediaFilter: isValidSwipeMediaFilter(g.mediaFilter) ? g.mediaFilter : "both",
  };
}

export async function GET(req: NextRequest) {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!uid) return bad("Ingen session.", 401);

  const code = (new URL(req.url).searchParams.get("code") || "").toUpperCase();
  if (!code) return bad("Gruppkod saknas.");

  const [group, memberCount] = await Promise.all([
    prisma.group.findUnique({
      where: { code },
      select: {
        code: true,
        createdBy: true,
        favoriteGenres: true,
        dislikedGenres: true,
        favoriteKeywordIds: true,
        providers: true,
        maxCert: true,
        matchThreshold: true,
        mediaFilter: true,
        members: { where: { userId: uid }, select: { userId: true } },
      },
    }),
    prisma.groupMember.count({ where: { groupCode: code } }),
  ]);
  if (!group) return bad("Gruppen finns inte.", 404);
  if (group.members.length === 0) return bad("Du är inte medlem i gruppen.", 403);

  return NextResponse.json({
    ok: true,
    code: group.code,
    isCreator: group.createdBy === uid,
    settings: toSettingsDto(group),
    memberCount,
    defaults: { matchNeed: groupMatchNeed(memberCount, null) },
  } as Ok);
}

type PatchBody = {
  code?: string;
  favoriteGenres?: unknown;
  dislikedGenres?: unknown;
  favoriteKeywordIds?: unknown;
  providers?: unknown;
  maxCert?: unknown;
  matchThreshold?: unknown;
  mediaFilter?: unknown;
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
    favoriteKeywordIds?: number[];
    providers?: string[];
    maxCert?: string | null;
    matchThreshold?: number | null;
    mediaFilter?: string;
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
  if ("favoriteKeywordIds" in body) {
    const k = sanitizeKeywordIds(body.favoriteKeywordIds);
    if (k === null) return bad("Ogiltiga sub-genrer.");
    data.favoriteKeywordIds = k;
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
      return bad("Ogiltig matchtröskel (minst 2 personer).");
    }
    data.matchThreshold = body.matchThreshold as number | null;
  }
  if ("mediaFilter" in body) {
    if (!isValidSwipeMediaFilter(body.mediaFilter)) {
      return bad("Ogiltigt innehållsfilter (movie, tv eller both).");
    }
    data.mediaFilter = body.mediaFilter;
  }

  if (Object.keys(data).length === 0) return bad("Inget att uppdatera.");

  const [updated, memberCount] = await Promise.all([
    prisma.group.update({
      where: { code },
      data,
      select: {
        code: true,
        favoriteGenres: true,
        dislikedGenres: true,
        favoriteKeywordIds: true,
        providers: true,
        maxCert: true,
        matchThreshold: true,
        mediaFilter: true,
      },
    }),
    prisma.groupMember.count({ where: { groupCode: code } }),
  ]);

  return NextResponse.json({
    ok: true,
    code: updated.code,
    isCreator: true,
    settings: toSettingsDto(updated),
    memberCount,
    defaults: { matchNeed: groupMatchNeed(memberCount, null) },
  } as Ok);
}
