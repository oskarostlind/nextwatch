// app/api/auth/register/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "../../../../lib/prisma";
import { rateLimitAllow, getRateLimitKey, AUTH_LIMIT } from "../../../../lib/rateLimit";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import nodemailer from "nodemailer";

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

function asBool(v?: string | null, def = false) {
  if (!v) return def;
  return ["true", "1", "yes", "on"].includes(String(v).toLowerCase());
}
function asNum(v?: string | null, def = 587) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

async function sendEmailSMTP(to: string, subject: string, html: string) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = asNum(process.env.SMTP_PORT, 587);
  const secure = asBool(process.env.SMTP_SECURE, port === 465);
  const from = process.env.SMTP_FROM || `NextWatch <${user ?? "noreply@localhost"}>`;

  if (!host || !user || !pass) {
    return { sent: false as const, reason: "missing_smtp_env" as const, detail: { host, user, pass } };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure, // true = 465 (SMTPS), false = STARTTLS 587
    auth: { user, pass },
  });

  const info = await transporter.sendMail({ from, to, subject, html });
  // nodemailer ger id/response
  return { sent: true as const, provider: { messageId: info.messageId, response: info.response } };
}

export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value ?? null;
    if (!uid) return jsonRes(401, "Ingen session. Logga in igen.");

    const key = getRateLimitKey(req, uid);
    const rateOk = rateLimitAllow(key, "auth-register", { limit: AUTH_LIMIT });
    if (!rateOk) {
      return jsonRes(429, "För många förfrågningar. Försök igen senare.");
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
    if (!email || !password) return jsonRes(400, "E-post och lösenord krävs.");
    // Guideline 1.2: kontot får inte skapas utan godkända villkor. Kryssrutan
    // i UI:t är gaten, men servern litar inte på klienten.
    if (body.termsAccepted !== true) {
      return jsonRes(400, "Du behöver godkänna villkoren för att skapa konto.");
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
    if (taken) return jsonRes(409, "E-postadressen används redan.");

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

    const origin = computeOrigin(req);
    const link = `${origin}/auth/verify?token=${token}${fromApp ? "&from=app" : ""}`;

    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
        <h2>Bekräfta din e-post</h2>
        <p>Klicka på knappen för att verifiera din e-postadress.</p>
        <p><a href="${link}" style="display:inline-block;padding:10px 14px;background:#0ea5e9;color:#fff;border-radius:8px;text-decoration:none">Verifiera e-post</a></p>
        <p>Om knappen inte fungerar, kopiera länken:</p>
        <p><code>${link}</code></p>
        <p>Giltig i 24 timmar.</p>
      </div>
    `;
    const mailRes = await sendEmailSMTP(email, "Bekräfta din e-post", html);

    return NextResponse.json({
      ok: true,
      message: mailRes.sent
        ? "Konto uppdaterat. Verifieringslänk skickad."
        : "Konto uppdaterat. Kunde inte skicka e-post – kopiera länken nedan.",
      verifyUrl: link,
      emailSent: mailRes.sent,
      emailProvider: mailRes.provider ?? mailRes.reason ?? null,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      return jsonRes(500, `Databasfel (${err.code}).`, { code: err.code, meta: err.meta });
    }
    const msg = err instanceof Error ? err.message : "Internt fel.";
    return jsonRes(500, msg);
  }
}
