import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { prisma } from "../../../../lib/prisma"; // Uppdaterad till named import
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// —— Helpers ——
function newId(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function toNumber(n: unknown): number | null {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string" && n.trim() !== "" && !Number.isNaN(Number(n))) return Number(n);
  return null;
}

function firstAcceptLanguage(h: string | null): string | null {
  if (!h) return null;
  const first = h.split(",")[0]?.trim();
  return first || null;
}

async function inferRegionAndLocale(): Promise<{ region: string; locale: string }> {
  const jar = await cookies();
  const hdr = await headers();
  const ipCountry = hdr.get("x-vercel-ip-country");
  const acceptLang = firstAcceptLanguage(hdr.get("accept-language"));
  
  const region =
    jar.get("nw_region")?.value ||
    (ipCountry && /^[A-Z]{2}$/.test(ipCountry) ? ipCountry : null) ||
    "SE";
    
  const locale =
    jar.get("nw_locale")?.value ||
    (acceptLang && /^[a-z]{2}(-[A-Z]{2})?$/.test(acceptLang) ? acceptLang : null) ||
    "sv-SE";
    
  return { region, locale };
}

function normalizeFavorite(x: unknown): Prisma.InputJsonValue | null {
  if (!x || typeof x !== "object") return null;
  const obj = x as Record<string, unknown>;
  const id = toNumber(obj.id);
  const title = typeof obj.title === "string" ? obj.title : null;
  const year = typeof obj.year === "string" ? obj.year : obj.year === null ? null : undefined;
  const poster = typeof obj.poster === "string" ? obj.poster : obj.poster === null ? null : undefined;
  
  if (!id || !title) return null;
  
  const payload: Record<string, unknown> = { id, title };
  if (typeof year !== "undefined") payload.year = year;
  if (typeof poster !== "undefined") payload.poster = poster;
  
  return payload as unknown as Prisma.InputJsonValue;
}

function toProvidersJson(p: unknown): Prisma.InputJsonValue {
  if (Array.isArray(p)) {
    const norm = p
      .map((x) => {
        if (typeof x === "string" || typeof x === "number") return String(x);
        if (x && typeof x === "object") {
          const rec = x as Record<string, unknown>;
          const id =
            (typeof rec.id === "string" && rec.id) ||
            (typeof rec.id === "number" && String(rec.id)) ||
            null;
          return id ?? null;
        }
        return null;
      })
      .filter((v): v is string => v !== null);
    return norm as unknown as Prisma.InputJsonValue;
  }
  return ([] as string[]) as unknown as Prisma.InputJsonValue;
}

function asStringArray(x: unknown): string[] {
  if (Array.isArray(x)) return x.filter((v): v is string => typeof v === "string");
  return [];
}

function requireString(body: Record<string, unknown>, key: string): string | null {
  const v = body[key];
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return null;
}

function extractDob(body: Record<string, unknown>): string | null {
  const candidates: unknown[] = [body.dob, body.dateOfBirth, body.birthdate, body.birthDate];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "") return c;
  }
  return null;
}

function ok(status: number, message: string, extra?: Record<string, unknown>) {
  const body: Record<string, unknown> = { ok: true, message, ...(extra || {}) };
  return NextResponse.json(body, { status });
}

function fail(status: number, message: string, debug?: boolean, extra?: Record<string, unknown>) {
  const body: Record<string, unknown> = { ok: false, message };
  if (debug && extra) body.debug = extra;
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  const debug = new URL(req.url).searchParams.get("debug") === "1";

  try {
    const jar = await cookies();
    let uid = jar.get("nw_uid")?.value ?? null;

    // Se till att användaren existerar i databasen
    if (!uid) {
      uid = newId();
      await prisma.user.upsert({ where: { id: uid }, update: {}, create: { id: uid } });
    } else {
      await prisma.user.upsert({ where: { id: uid }, update: {}, create: { id: uid } });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const displayName = requireString(body, "displayName");
    const dobStr = extractDob(body);
    const favoriteGenres = asStringArray(body.favoriteGenres);
    const dislikedGenres = asStringArray(body.dislikedGenres);
    const providersJson = toProvidersJson(body.providers);
    const favMovieJson = normalizeFavorite(body.favoriteMovie);
    const favShowJson = normalizeFavorite(body.favoriteShow);

    const { region: finalRegion, locale: finalLocale } = await inferRegionAndLocale();
    const uiLanguageRaw = requireString(body, "uiLanguage");
    const uiLanguage = uiLanguageRaw ? uiLanguageRaw : (finalLocale.split("-")[0] || "sv");

    const missing: string[] = [];
    if (!displayName) missing.push("displayName");
    if (!dobStr) missing.push("dob");
    if (missing.length) {
      return fail(400, `Obligatoriska fält saknas: ${missing.join(", ")}`, debug, {
        receivedKeys: Object.keys(body),
      });
    }

    const dobDate = new Date(dobStr!);

    const dataCommon = {
      displayName,
      dob: dobDate,
      region: finalRegion,
      locale: finalLocale,
      uiLanguage,
      favoriteGenres,
      dislikedGenres,
      providers: providersJson,
      favoriteMovie: favMovieJson ?? Prisma.DbNull,
      favoriteShow: favShowJson ?? Prisma.DbNull,
      updatedAt: new Date(),
    };

    const profile = await prisma.profile.upsert({
      where: { userId: uid },
      create: { userId: uid, ...dataCommon },
      update: { ...dataCommon },
      select: {
        userId: true,
        displayName: true,
        dob: true,
        region: true,
        locale: true,
        uiLanguage: true,
        favoriteGenres: true,
        dislikedGenres: true,
        providers: true,
        favoriteMovie: true,
        favoriteShow: true,
      },
    });

    const res = ok(200, "Profilen sparades.", { profile });
    res.cookies.set("nw_uid", uid, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
    res.cookies.set("nw_region", finalRegion, { path: "/", httpOnly: false, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
    res.cookies.set("nw_locale", finalLocale, { path: "/", httpOnly: false, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
    return res;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      return fail(500, "Prisma-fel.", true, { code: err.code, meta: err.meta });
    }
    console.error("[save-onboarding] error:", err);
    const message = err instanceof Error ? err.message : "Ett fel uppstod.";
    return fail(500, message, true);
  }
}