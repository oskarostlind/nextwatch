// lib/email.ts — ALL e-post från NextWatch går härifrån, via Resend.
//
// Bytte från Strato SMTP (nodemailer) 2026-10-10. Innan dess fanns samma
// SMTP-kod kopierad på fyra ställen (register, request-verify, forgot,
// admin/users/action) med tre olika mallar, och ett oanvänt
// sendVerificationMail här som lovade "30 minuter" när länken gäller 24 h.
// Nu: en avsändarväg, en mall (renderEmail), html + textversion.
//
// Resend anropas med fetch mot REST-API:t i stället för SDK:t — inget nytt
// npm-beroende (repot byggs på Windows, och node_modules rörs helst inte).
//
// DNS (Strato): DKIM på resend._domainkey, SPF/bounce på send., och
// rotdomänens MX pekar på Resend inbound — så support@/allt@nextwatch.se
// landar i Resend och läses i /admin → Mejl (se lib/adminMail.ts).
//
// Env:
//   RESEND_API_KEY    — full access (inkorgen i /admin läser mottagna mejl)
//   EMAIL_FROM        — systemutskick, default "NextWatch <noreply@nextwatch.se>"
//   ADMIN_EMAIL_FROM  — det du skickar själv från /admin, default "NextWatch <support@…>"
//   SUPPORT_EMAIL     — reply-to + mottagare för anmälningar

import { getTranslations } from "next-intl/server";
import { normalizeLocale } from "@/lib/i18nConfig";

const RESEND_API = "https://api.resend.com";

export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "support@nextwatch.se";
const SYSTEM_FROM = process.env.EMAIL_FROM ?? "NextWatch <noreply@nextwatch.se>";
export const ADMIN_FROM = process.env.ADMIN_EMAIL_FROM ?? `NextWatch <${SUPPORT_EMAIL}>`;
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nextwatch.se").replace(/\/$/, "");

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export class ResendError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Låg nivå: anropa Resend. Kastar ResendError vid fel. */
export async function resendApi<T>(
  path: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new ResendError("RESEND_API_KEY saknas", 503);

  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;

  const res = await fetch(`${RESEND_API}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as { message?: string } | null;
  if (!res.ok) throw new ResendError(json?.message ?? `Resend ${res.status}`, res.status);
  return json as T;
}

export type SendResult = { sent: true; id: string } | { sent: false; reason: string };

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  cc?: string[];
  headers?: Record<string, string>;
  /** Samma nyckel inom 24 h skickar inte igen — skydd mot webhook-omförsök. */
  idempotencyKey?: string;
  category?: string;
};

/** Skickar ett mejl. Kastar aldrig — ett mejlfel får inte fälla flödet runt omkring. */
export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  if (!isEmailConfigured()) {
    console.warn("[email] RESEND_API_KEY saknas — skickade inte:", input.subject);
    return { sent: false, reason: "missing_resend_key" };
  }
  try {
    const r = await resendApi<{ id: string }>("/emails", {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: {
        from: input.from ?? SYSTEM_FROM,
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text ?? htmlToText(input.html),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.cc?.length ? { cc: input.cc } : {}),
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.category ? { tags: [{ name: "category", value: input.category }] } : {}),
      },
    });
    return { sent: true, id: r.id };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "unknown";
    console.error("[email] send failed:", input.subject, reason);
    return { sent: false, reason };
  }
}

// ── Mall ─────────────────────────────────────────────────────────────────────

export function escapeHtml(v: string): string {
  return v.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** Grov html→text för text/plain-delen (spamfilter vill ha båda). */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h\d|tr|li)>/gi, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type EmailContent = {
  lang: string;
  subject: string;
  /** Förhandsvisningen i inkorgslistan. */
  preheader?: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  /** "Om knappen inte fungerar…" + länken i klartext. */
  fallbackLabel?: string;
  footnote?: string;
  footer: string;
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Den gemensamma mallen. All text escapas — skicka aldrig in färdig HTML. */
export function renderEmail(c: EmailContent): { subject: string; html: string; text: string } {
  const e = escapeHtml;
  const p = (s: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3f3f46">${e(s)}</p>`;

  const cta = c.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 20px"><tr>
        <td style="border-radius:10px;background:#06b6d4">
          <a href="${e(c.cta.url)}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:15px;font-weight:600;color:#04131a;text-decoration:none;border-radius:10px">${e(c.cta.label)}</a>
        </td></tr></table>`
    : "";
  const fallback =
    c.cta && c.fallbackLabel
      ? `<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#71717a">${e(c.fallbackLabel)}<br>
         <a href="${e(c.cta.url)}" style="color:#0891b2;word-break:break-all">${e(c.cta.url)}</a></p>`
      : "";
  const footnote = c.footnote
    ? `<p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#71717a">${e(c.footnote)}</p>`
    : "";

  const html = `<!doctype html>
<html lang="${e(c.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${e(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5">
${c.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${e(c.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
    <tr><td style="background:#0a0a0a;padding:18px 28px">
      <img src="${APP_URL}/app-icon-120.png" width="32" height="32" alt="" style="border-radius:8px;vertical-align:middle;border:0">
      <span style="font-family:${FONT};font-size:18px;font-weight:700;color:#ffffff;vertical-align:middle;margin-left:10px">NextWatch</span>
    </td></tr>
    <tr><td style="padding:32px 28px 12px;font-family:${FONT};color:#18181b">
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:#18181b">${e(c.heading)}</h1>
      ${c.paragraphs.map(p).join("\n      ")}
      ${cta}
      ${fallback}
      ${footnote}
    </td></tr>
    <tr><td style="padding:16px 28px 26px;font-family:${FONT};font-size:12px;line-height:1.5;color:#a1a1aa;border-top:1px solid #f4f4f5">
      ${e(c.footer)} · <a href="${APP_URL}" style="color:#a1a1aa">nextwatch.se</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [
    c.heading,
    "",
    ...c.paragraphs.flatMap((s) => [s, ""]),
    ...(c.cta ? [`${c.cta.label}: ${c.cta.url}`, ""] : []),
    ...(c.footnote ? [c.footnote, ""] : []),
    "—",
    `${c.footer} · ${APP_URL}`,
  ].join("\n");

  return { subject: c.subject, html, text };
}

// ── Utskick ──────────────────────────────────────────────────────────────────

/** Bekräfta e-post. Används av register, request-verify och admin. */
export async function sendVerificationEmail(to: string, link: string, locale: unknown): Promise<SendResult> {
  const lang = normalizeLocale(locale);
  const t = await getTranslations({ locale: lang, namespace: "email" });
  const mail = renderEmail({
    lang,
    subject: t("verify.subject"),
    preheader: t("verify.intro"),
    heading: t("verify.heading"),
    paragraphs: [t("verify.intro")],
    cta: { label: t("verify.cta"), url: link },
    fallbackLabel: t("verify.fallback"),
    footnote: t("verify.validity"),
    footer: t("common.footer"),
  });
  return sendEmail({ to, ...mail, replyTo: SUPPORT_EMAIL, category: "verify" });
}

/** Återställ lösenord (länken gäller 1 h). */
export async function sendPasswordResetEmail(to: string, link: string, locale: unknown): Promise<SendResult> {
  const lang = normalizeLocale(locale);
  const t = await getTranslations({ locale: lang, namespace: "email" });
  const mail = renderEmail({
    lang,
    subject: t("reset.subject"),
    preheader: t("reset.intro"),
    heading: t("reset.heading"),
    paragraphs: [t("reset.intro")],
    cta: { label: t("reset.cta"), url: link },
    fallbackLabel: t("reset.fallback"),
    footnote: t("reset.validity"),
    footer: t("common.footer"),
  });
  return sendEmail({ to, ...mail, replyTo: SUPPORT_EMAIL, category: "password-reset" });
}

/**
 * "Välkommen till Premium" efter ett köp. Inget kvitto — Apple respektive
 * Stripe skickar själva kvittot; det här bekräftar att premium är aktivt och
 * säger var prenumerationen sägs upp (krav-nära: användaren ska hitta det).
 * idempotencyKey hindrar dubbletter när Stripe/StoreKit skickar samma köp igen.
 */
export async function sendPremiumWelcomeEmail(
  to: string,
  locale: unknown,
  opts: { provider: "stripe" | "apple"; idempotencyKey: string },
): Promise<SendResult> {
  const lang = normalizeLocale(locale);
  const t = await getTranslations({ locale: lang, namespace: "email" });
  const mail = renderEmail({
    lang,
    subject: t("premium.subject"),
    preheader: t("premium.intro"),
    heading: t("premium.heading"),
    paragraphs: [t("premium.intro"), t("premium.perks")],
    cta: { label: t("premium.cta"), url: `${APP_URL}/swipe` },
    footnote: opts.provider === "apple" ? t("premium.manageApple") : t("premium.manageStripe"),
    footer: t("common.footer"),
  });
  return sendEmail({
    to,
    ...mail,
    replyTo: SUPPORT_EMAIL,
    category: "premium-welcome",
    idempotencyKey: opts.idempotencyKey,
  });
}

/** Supportadressen som visas i appen (app/support) — dit går anmälningar. */
export type ReportMail = {
  reporterId: string;
  reporterUsername: string | null;
  reporterEmail: string | null;
  targetId: string;
  targetUsername: string | null;
  targetDisplayName: string | null;
  reason: string;
  details: string;
  blocked: boolean;
};

/**
 * Anmälan av en användare (App Store Guideline 1.2). Skickas till supporten,
 * som numera landar i /admin → Mejl. Svara-till = anmälaren.
 */
export async function sendReportMail(r: ReportMail): Promise<SendResult> {
  const esc = (v: string | null) => escapeHtml(v ?? "—");
  return sendEmail({
    to: SUPPORT_EMAIL,
    subject: `[NextWatch] Anmäld användare – ${r.reason}`,
    replyTo: r.reporterEmail ?? undefined,
    category: "report",
    html: `
      <div style="font-family:${FONT}">
        <h2>Anmäld användare</h2>
        <table cellpadding="6" style="border-collapse:collapse">
          <tr><td><b>Anmäld</b></td><td>${esc(r.targetDisplayName)} (@${esc(r.targetUsername)})<br><code>${esc(r.targetId)}</code></td></tr>
          <tr><td><b>Anmälare</b></td><td>@${esc(r.reporterUsername)} · ${esc(r.reporterEmail)}<br><code>${esc(r.reporterId)}</code></td></tr>
          <tr><td><b>Skäl</b></td><td>${esc(r.reason)}</td></tr>
          <tr><td><b>Beskrivning</b></td><td>${esc(r.details || null)}</td></tr>
          <tr><td><b>Blockerad</b></td><td>${r.blocked ? "Ja, av anmälaren" : "Nej"}</td></tr>
          <tr><td><b>Tid</b></td><td>${new Date().toISOString()}</td></tr>
        </table>
        <p style="color:#666;font-size:12px">Hantera i /admin. Åtgärda inom 24 timmar enligt Guideline 1.2.</p>
      </div>
    `,
  });
}
