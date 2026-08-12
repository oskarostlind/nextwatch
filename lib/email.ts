// lib/email.ts
import nodemailer from "nodemailer";

const secure = (process.env.SMTP_SECURE ?? "true").toLowerCase() === "true";
const port = Number(process.env.SMTP_PORT ?? (secure ? 465 : 587));

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure,                  // true => 465 (implicit TLS), false => 587 (STARTTLS)
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  requireTLS: !secure,     // tvinga STARTTLS när secure=false
  connectionTimeout: 15000,
});

export async function sendVerificationMail(to: string, link: string) {
  await transporter.verify();
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "",
    to,
    subject: "Aktivera ditt NextWatch-konto",
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
        <h2>Aktivera ditt konto</h2>
        <p>Klicka på länken för att bekräfta din e-post:</p>
        <p>
          <!-- OBS: inget target="_blank" längre -->
          <a href="${link}" style="background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">
            Bekräfta e-post
          </a>
        </p>
        <p>Länken gäller i 30 minuter.</p>
      </div>
    `,
  });
}

// alias så din nuvarande import fortsätter funka
export { sendVerificationMail as sendVerificationEmail };

/** Supportadressen som visas i appen (app/support) — dit går anmälningar. */
const SUPPORT_TO = process.env.SUPPORT_EMAIL ?? "support@nextwatch.se";

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
 * Anmälan av en användare (App Store Guideline 1.2). Skickas till supporten så
 * att ärendet hamnar i samma inkorg som allt annat — ingen egen tabell behövs.
 */
export async function sendReportMail(r: ReportMail) {
  const esc = (v: string | null) =>
    (v ?? "—").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "",
    to: SUPPORT_TO,
    subject: `[NextWatch] Anmäld användare – ${esc(r.reason)}`,
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
        <h2>Anmäld användare</h2>
        <table cellpadding="6" style="border-collapse:collapse">
          <tr><td><b>Anmäld</b></td><td>${esc(r.targetDisplayName)} (@${esc(r.targetUsername)})<br><code>${esc(r.targetId)}</code></td></tr>
          <tr><td><b>Anmälare</b></td><td>@${esc(r.reporterUsername)} · ${esc(r.reporterEmail)}<br><code>${esc(r.reporterId)}</code></td></tr>
          <tr><td><b>Skäl</b></td><td>${esc(r.reason)}</td></tr>
          <tr><td><b>Beskrivning</b></td><td>${esc(r.details) || "—"}</td></tr>
          <tr><td><b>Blockerad</b></td><td>${r.blocked ? "Ja, av anmälaren" : "Nej"}</td></tr>
          <tr><td><b>Tid</b></td><td>${new Date().toISOString()}</td></tr>
        </table>
        <p style="color:#666;font-size:12px">Hantera i /admin. Åtgärda inom 24 timmar enligt Guideline 1.2.</p>
      </div>
    `,
  });
}
