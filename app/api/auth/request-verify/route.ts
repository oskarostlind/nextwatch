// app/api/auth/request-verify/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "../../../../lib/prisma";
import { randomBytes } from "crypto";
import nodemailer from "nodemailer";
import { getTranslations } from "next-intl/server";
import { uiLocaleFromCookies } from "@/lib/serverLocale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  const info = await transporter.sendMail({ from, to, subject, html });
  return { sent: true as const, provider: { messageId: info.messageId, response: info.response } };
}

export async function GET(req: NextRequest) {
  return NextResponse.redirect(new URL("/auth/verify/sent", req.url));
}

export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value ?? null;
    if (!uid) return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });

    const u = await prisma.user.findUnique({ where: { id: uid }, select: { id: true, email: true } });
    if (!u?.email) return NextResponse.json({ ok: false, message: "Ingen e-post registrerad." }, { status: 400 });

    await prisma.verification.deleteMany({ where: { userId: uid } });

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.verification.create({ data: { token, userId: uid, email: u.email, name: null, expiresAt } });

    const origin = computeOrigin(req);
    const link = `${origin}/auth/verify?token=${token}`;
    const t = await getTranslations({ locale: await uiLocaleFromCookies(), namespace: "email.verify" });
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
        <h2>${t("heading")}</h2>
        <p><a href="${link}" style="display:inline-block;padding:10px 14px;background:#0ea5e9;color:#fff;border-radius:8px;text-decoration:none">${t("cta")}</a></p>
        <p>${t("validity")}</p>
      </div>
    `;
    const mailRes = await sendEmailSMTP(u.email, t("subject"), html);

    return NextResponse.json({
      ok: true,
      message: mailRes.sent ? "Verifieringslänk skickad." : "Länk skapad men e-post kunde inte skickas.",
      verifyUrl: link,
      emailSent: mailRes.sent,
      emailProvider: mailRes.provider ?? mailRes.reason ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internt fel.";
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}
