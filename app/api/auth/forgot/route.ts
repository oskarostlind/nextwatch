// app/api/auth/forgot/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { rateLimitAllow, getRateLimitKey, AUTH_LIMIT } from "../../../../lib/rateLimit";
import { randomBytes } from "crypto";
import nodemailer from "nodemailer";
import { getTranslations } from "next-intl/server";
import { normalizeLocale } from "@/lib/i18nConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Markör i verifications.name som skiljer lösenordsåterställning från e-postverifiering. */
const RESET_MARKER = "pwreset";

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
    return { sent: false as const, reason: "missing_smtp_env" as const };
  }
  const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  const info = await transporter.sendMail({ from, to, subject, html });
  return { sent: true as const, provider: { messageId: info.messageId, response: info.response } };
}

export async function POST(req: NextRequest) {
  try {
    const key = getRateLimitKey(req, null);
    if (!rateLimitAllow(key, "auth-forgot", { limit: AUTH_LIMIT })) {
      return NextResponse.json(
        { ok: false, message: "För många förfrågningar. Försök igen senare." },
        { status: 429 },
      );
    }

    const body = (await req.json()) as { email?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ ok: false, message: "E-post krävs." }, { status: 400 });
    }

    // Generiskt svar oavsett om kontot finns – läcker inte vilka adresser som är registrerade.
    const genericOk = NextResponse.json({
      ok: true,
      message: "Om kontot finns har vi skickat en återställningslänk till din e-post.",
    });

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, profile: { select: { uiLanguage: true } } },
    });
    if (!user?.email) return genericOk;

    // Rensa gamla reset-tokens för användaren (rör inte ev. e-postverifieringstoken)
    await prisma.verification.deleteMany({ where: { userId: user.id, name: RESET_MARKER } });

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 timme
    await prisma.verification.create({
      data: { token, userId: user.id, email: user.email, name: RESET_MARKER, expiresAt },
    });

    const origin = computeOrigin(req);
    const link = `${origin}/auth/reset?token=${token}`;
    // Mejlet skrivs på kontots språk (Profile.uiLanguage), inte på avsändarens.
    const t = await getTranslations({
      locale: normalizeLocale(user.profile?.uiLanguage),
      namespace: "email.reset",
    });
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
        <h2>${t("heading")}</h2>
        <p>${t("intro")}</p>
        <p><a href="${link}" style="display:inline-block;padding:10px 14px;background:#0ea5e9;color:#fff;border-radius:8px;text-decoration:none">${t("cta")}</a></p>
        <p>${t("fallback")}</p>
        <p><code>${link}</code></p>
        <p>${t("validity")}</p>
      </div>
    `;
    await sendEmailSMTP(user.email, t("subject"), html);

    return genericOk;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internt fel.";
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}
