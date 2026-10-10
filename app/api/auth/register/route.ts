// app/api/auth/register/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "../../../../lib/prisma";
import { rateLimitAllow, getRateLimitKey, AUTH_LIMIT } from "../../../../lib/rateLimit";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendVerificationEmail } from "@/lib/email";
import { uiLocaleFromCookies } from "@/lib/serverLocale";
import { apiMsg } from "@/lib/apiMessages";
import { stampAcquisition } from "@/lib/acquisitionServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonRes(status: number, message: string, extra?: Record<string, unknown>) {
  const body: Record<string, unknown> = { ok: status >= 200 && status < 300, message };
  if (extra) body.extra = extra;
  return NextResponse.json(body, { status });
}

function computeOrigin(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/$/, "");
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}



export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value ?? null;
    if (!uid) return jsonRes(401, await apiMsg("sessionExpired"));

    const key = getRateLimitKey(req, uid);
    const rateOk = rateLimitAllow(key, "auth-register", { limit: AUTH_LIMIT });
    if (!rateOk) {
      return jsonRes(429, await apiMsg("tooManyRequests"));
    }

    const body = (await req.json()) as {
      email?: string;
      password?: string;
      from?: string;
      termsAccepted?: boolean;
    };
    const email = (body.email ?? "").trim().toLowerCase();
    const password = (body.password ?? "").trim();
    const fromApp = body.from === "app";
    if (!email || !password) return jsonRes(400, await apiMsg("emailPasswordRequired"));
    // Guideline 1.2: kontot får inte skapas utan godkända villkor. Kryssrutan
    // i UI:t är gaten, men servern litar inte på klienten.
    if (body.termsAccepted !== true) {
      return jsonRes(400, await apiMsg("termsRequired"));
    }

    // Preflight: kontrollera att nödvändiga kolumner finns
    const [usersCols, verCols] = await Promise.all([
      prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='users'`,
      prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='verifications'`,
    ]);
    const u = new Set(usersCols.map((r) => r.column_name));
    const v = new Set(verCols.map((r) => r.column_name));
    const missingUsers = ["password_hash", "email_verified", "last_login_at"].filter((c) => !u.has(c));
    const missingVer = ["token", "user_id", "email", "name", "created_at", "expires_at"].filter((c) => !v.has(c));
    if (missingUsers.length || missingVer.length) {
      return jsonRes(500, "DB-schema mismatch (saknade kolumner).", {
        missingUsers,
        missingVerifications: missingVer,
      });
    }

    // Säkerställ att användarrad finns (middleware sätter bara cookie; session/init kanske inte körts)
    await prisma.user.upsert({
      where: { id: uid },
      update: {},
      create: { id: uid },
      select: { id: true },
    });

    const taken = await prisma.user.findFirst({ where: { email, NOT: { id: uid } }, select: { id: true } });
    if (taken) return jsonRes(409, await apiMsg("emailInUse"));

    const hash = await bcrypt.hash(password, 12);
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: uid },
        data: { email, passwordHash: hash, termsAcceptedAt: new Date() },
      }),
      prisma.verification.create({ data: { token, userId: uid, email, name: null, expiresAt } }),
    ]);
    await stampAcquisition(uid);

    const origin = computeOrigin(req);
    const link = `${origin}/auth/verify?token=${token}${fromApp ? "&from=app" : ""}`;

    // Registreringen sker i webbläsaren, så nw_lang-cookien speglar det språk
    // användaren just fyllde i formuläret på.
    const mailRes = await sendVerificationEmail(email, link, await uiLocaleFromCookies());
    // Verifieringslänken skickas ALDRIG tillbaka i svaret — den är beviset på
    // att man äger adressen och får bara finnas i mejlet. (Innan 2026-10-10
    // låg den i JSON:en som verifyUrl, så vem som helst kunde "bekräfta" en
    // adress de inte äger genom att läsa svaret.) Mejlfel loggas server-side.
    if (!mailRes.sent) console.error("[auth/register] verifieringsmejl misslyckades:", mailRes.reason);

    return NextResponse.json({
      ok: true,
      message: mailRes.sent
        ? await apiMsg("accountUpdatedLinkSent")
        : await apiMsg("accountUpdatedMailFailed"),
      emailSent: mailRes.sent,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      return jsonRes(500, `Databasfel (${err.code}).`, { code: err.code, meta: err.meta });
    }
    const msg = err instanceof Error ? err.message : await apiMsg("internalError");
    return jsonRes(500, msg);
  }
}
