// lib/adminMail.ts — läser in- och utkorgen för nextwatch.se ur Resend, för
// /admin → Mejl. Ingen egen tabell: Resend ÄR brevlådan (rotdomänens MX
// pekar på Resend inbound sedan 2026-10-10). Resend-kontot delas med andra
// projekt (kundnytt, avyracards …), därför filtreras allt på domänen.

import { resendApi } from "@/lib/email";

export const MAIL_DOMAIN = (process.env.MAIL_DOMAIN ?? "nextwatch.se").toLowerCase();

export type MailBox = "inbox" | "sent";

export type MailListItem = {
  id: string;
  from: string;
  to: string[];
  subject: string;
  createdAt: string;
  attachments: number;
  /** Bara utkorgen: delivered / bounced / opened … */
  status: string | null;
};

export type MailAttachment = { id: string; filename: string; size: number; contentType: string };

export type MailDetail = MailListItem & {
  cc: string[];
  replyTo: string[];
  html: string | null;
  text: string | null;
  messageId: string | null;
  /** Bara inkorgen: SPF/DKIM/DMARC — "fail" är en varningsflagga för spoofing. */
  auth: { spf?: string; dkim?: string; dmarc?: string } | null;
  attachmentList: MailAttachment[];
};

type RawAttachment = { id: string; filename?: string; size?: number; content_type?: string };
type RawEmail = {
  id: string;
  from: string;
  to?: string[] | null;
  cc?: string[] | null;
  reply_to?: string[] | null;
  received_for?: string[] | null;
  subject?: string | null;
  created_at: string;
  html?: string | null;
  text?: string | null;
  message_id?: string | null;
  last_event?: string | null;
  attachments?: RawAttachment[] | null;
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
};
type RawList = { data: RawEmail[]; has_more: boolean };

const ours = (addrs: (string | null | undefined)[]) =>
  addrs.some((a) => (a ?? "").toLowerCase().includes(`@${MAIL_DOMAIN}`));

function toItem(e: RawEmail, box: MailBox): MailListItem {
  return {
    id: e.id,
    from: e.from,
    to: e.to ?? [],
    subject: e.subject || "(inget ämne)",
    createdAt: e.created_at,
    attachments: e.attachments?.length ?? 0,
    status: box === "sent" ? e.last_event ?? null : null,
  };
}

export async function listMail(
  box: MailBox,
  after?: string | null,
): Promise<{ items: MailListItem[]; nextCursor: string | null }> {
  const qs = new URLSearchParams({ limit: "100" });
  if (after) qs.set("after", after);
  const path = box === "inbox" ? `/emails/receiving?${qs}` : `/emails?${qs}`;
  const r = await resendApi<RawList>(path);
  const raw = r.data ?? [];
  const mine = raw.filter((e) =>
    box === "inbox" ? ours([...(e.to ?? []), ...(e.cc ?? []), ...(e.received_for ?? [])]) : ours([e.from]),
  );
  return {
    items: mine.map((e) => toItem(e, box)),
    nextCursor: r.has_more && raw.length ? raw[raw.length - 1].id : null,
  };
}

export async function getMail(box: MailBox, id: string): Promise<MailDetail | null> {
  const safeId = encodeURIComponent(id);
  const e = await resendApi<RawEmail>(box === "inbox" ? `/emails/receiving/${safeId}` : `/emails/${safeId}`);
  // Släpp aldrig igenom andra projekts post, även om någon gissar ett id.
  const isOurs =
    box === "inbox" ? ours([...(e.to ?? []), ...(e.cc ?? []), ...(e.received_for ?? [])]) : ours([e.from]);
  if (!isOurs) return null;
  return {
    ...toItem(e, box),
    cc: e.cc ?? [],
    replyTo: e.reply_to ?? [],
    html: e.html ?? null,
    text: e.text ?? null,
    messageId: e.message_id ?? null,
    auth: box === "inbox" ? e.authentication ?? null : null,
    attachmentList: (e.attachments ?? []).map((a) => ({
      id: a.id,
      filename: a.filename ?? "bilaga",
      size: a.size ?? 0,
      contentType: a.content_type ?? "application/octet-stream",
    })),
  };
}

/** Tillfällig nedladdningslänk för en bilaga (Resend signerar och låter den gå ut). */
export async function getAttachmentUrl(box: MailBox, emailId: string, attachmentId: string): Promise<string | null> {
  const base = box === "inbox" ? "/emails/receiving" : "/emails";
  const a = await resendApi<{ download_url?: string }>(
    `${base}/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
  return a.download_url ?? null;
}
