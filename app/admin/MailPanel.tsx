"use client";
// app/admin/MailPanel.tsx — fliken "Mejl" i /admin: inkorg + skickat för
// nextwatch.se via Resend (lib/adminMail.ts), läsvy och skriv/svara.
//
// Läst/oläst sparas per enhet i localStorage — det är en bekvämlighet, inte
// data som måste överleva (Resend har ingen läst-status för mottagen post).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Box = "inbox" | "sent";

type MailListItem = {
  id: string;
  from: string;
  to: string[];
  subject: string;
  createdAt: string;
  attachments: number;
  status: string | null;
};

type MailDetail = MailListItem & {
  cc: string[];
  replyTo: string[];
  html: string | null;
  text: string | null;
  messageId: string | null;
  auth: { spf?: string; dkim?: string; dmarc?: string } | null;
  attachmentList: { id: string; filename: string; size: number; contentType: string }[];
};

export type ComposeDraft = {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
};

const READ_KEY = "nw_admin_mail_read";

function loadRead(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function saveRead(s: Set<string>) {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...s].slice(-500)));
  } catch {
    /* privat läge o.dyl. — strunt samma */
  }
}

/** "Namn <a@b.se>" → { name: "Namn", addr: "a@b.se" } */
function parseAddr(s: string): { name: string; addr: string } {
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2], addr: m[2] };
  return { name: s.trim(), addr: s.trim() };
}

function when(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "nyss";
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  const today = new Date();
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  if (diff < 6 * 86400) return d.toLocaleDateString("sv-SE", { weekday: "short" });
  return d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" });
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  delivered: { label: "Levererat", cls: "bg-emerald-500/15 text-emerald-300" },
  opened: { label: "Öppnat", cls: "bg-cyan-500/15 text-cyan-300" },
  clicked: { label: "Klickat", cls: "bg-cyan-500/15 text-cyan-300" },
  sent: { label: "Skickat", cls: "bg-white/10 text-white/60" },
  queued: { label: "I kö", cls: "bg-white/10 text-white/60" },
  scheduled: { label: "Schemalagt", cls: "bg-white/10 text-white/60" },
  delivery_delayed: { label: "Fördröjt", cls: "bg-amber-500/15 text-amber-300" },
  bounced: { label: "Studsade", cls: "bg-rose-500/15 text-rose-300" },
  complained: { label: "Spam-anmält", cls: "bg-rose-500/15 text-rose-300" },
  failed: { label: "Misslyckades", cls: "bg-rose-500/15 text-rose-300" },
};

function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[110] flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Stäng" onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative flex h-full w-full flex-col bg-neutral-950 sm:max-w-2xl sm:border-l sm:border-white/10">
        <div
          className="flex items-center gap-3 border-b border-white/10 px-4 pb-3"
          style={{ paddingTop: "max(env(safe-area-inset-top), 12px)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full text-white/70 hover:bg-white/10"
            aria-label="Tillbaka"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="truncate text-sm font-semibold text-white/80">{title}</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">{children}</div>
        {footer && (
          <div
            className="border-t border-white/10 bg-neutral-950 px-4 pt-3"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Skriv / svara ────────────────────────────────────────────────────────────

export function MailComposer({
  initial,
  onClose,
  onSent,
}: {
  initial: ComposeDraft;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc ?? "");
  const [showCc, setShowCc] = useState(Boolean(initial.cc));
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Svar: markören överst, ovanför citatet.
    const el = bodyRef.current;
    if (el && initial.inReplyTo) {
      el.focus();
      el.setSelectionRange(0, 0);
      el.scrollTop = 0;
    }
  }, [initial.inReplyTo]);

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          to,
          cc,
          subject,
          body,
          inReplyTo: initial.inReplyTo,
          references: initial.references,
        }),
      });
      const j = (await res.json()) as { ok?: boolean; message?: string };
      if (!j.ok) {
        setErr(j.message ?? "Kunde inte skicka.");
        return;
      }
      onSent?.();
      onClose();
    } catch {
      setErr("Nätverksfel.");
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full bg-transparent py-3 text-[15px] text-white placeholder:text-white/30 focus:outline-none";
  return (
    <Sheet
      title={initial.inReplyTo ? "Svara" : "Nytt mejl"}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-3">
          {err ? <p className="min-w-0 flex-1 text-sm text-rose-300">{err}</p> : <p className="min-w-0 flex-1 truncate text-xs text-white/40">Från support@nextwatch.se</p>}
          <button
            type="button"
            onClick={send}
            disabled={busy || !to.trim() || !subject.trim() || !body.trim()}
            className="shrink-0 rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-neutral-950 transition active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? "Skickar…" : "Skicka"}
          </button>
        </div>
      }
    >
      <div className="px-4">
        <div className="flex items-center gap-2 border-b border-white/10">
          <span className="w-12 shrink-0 text-sm text-white/40">Till</span>
          <input
            className={field}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            type="email"
            inputMode="email"
            autoCapitalize="off"
            autoCorrect="off"
            multiple
            placeholder="namn@exempel.se"
            autoFocus={!initial.to}
          />
          {!showCc && (
            <button type="button" onClick={() => setShowCc(true)} className="shrink-0 text-xs font-semibold text-white/50">
              Kopia
            </button>
          )}
        </div>
        {showCc && (
          <div className="flex items-center gap-2 border-b border-white/10">
            <span className="w-12 shrink-0 text-sm text-white/40">Kopia</span>
            <input
              className={field}
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              type="email"
              inputMode="email"
              autoCapitalize="off"
              autoCorrect="off"
              multiple
            />
          </div>
        )}
        <div className="flex items-center gap-2 border-b border-white/10">
          <span className="w-12 shrink-0 text-sm text-white/40">Ämne</span>
          <input className={field} value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus={Boolean(initial.to) && !initial.subject} />
        </div>
      </div>
      <textarea
        ref={bodyRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Skriv ditt meddelande…"
        className="min-h-[50vh] w-full flex-1 resize-none bg-transparent px-4 py-4 text-[15px] leading-relaxed text-white placeholder:text-white/30 focus:outline-none"
      />
    </Sheet>
  );
}

function replyDraft(m: MailDetail): ComposeDraft {
  const target = m.replyTo[0] ?? m.from;
  const quoted = (m.text ?? "")
    .split("\n")
    .slice(0, 200)
    .map((l) => `> ${l}`)
    .join("\n");
  return {
    to: parseAddr(target).addr,
    subject: /^(re|sv):/i.test(m.subject) ? m.subject : `Re: ${m.subject}`,
    body: `\n\n\nDen ${fullDate(m.createdAt)} skrev ${m.from}:\n${quoted}`,
    inReplyTo: m.messageId ?? undefined,
    references: m.messageId ?? undefined,
  };
}

// ── Läsvy ────────────────────────────────────────────────────────────────────

function MailView({
  box,
  id,
  onClose,
  onReply,
}: {
  box: Box;
  id: string;
  onClose: () => void;
  onReply: (d: ComposeDraft) => void;
}) {
  const [m, setM] = useState<MailDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/mail/${encodeURIComponent(id)}?box=${box}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { ok?: boolean; mail?: MailDetail; message?: string }) => {
        if (!alive) return;
        if (j.ok && j.mail) setM(j.mail);
        else setErr(j.message ?? "Kunde inte läsa mejlet.");
      })
      .catch(() => alive && setErr("Nätverksfel."));
    return () => {
      alive = false;
    };
  }, [box, id]);

  // Mejlets egen HTML i en sandlåda: inga skript, länkar öppnas i ny flik.
  const srcDoc = useMemo(() => {
    if (!m) return "";
    const base = `<base target="_blank"><meta name="color-scheme" content="light"><style>html,body{margin:0;padding:12px;background:#fff;color:#18181b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.5;word-wrap:break-word}img{max-width:100%;height:auto}pre{white-space:pre-wrap}</style>`;
    if (m.html) return base + m.html;
    const esc = (m.text ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);
    return `${base}<pre style="font-family:inherit;margin:0">${esc}</pre>`;
  }, [m]);

  const authFail = m?.auth && Object.values(m.auth).some((v) => v && v !== "pass" && v !== "none");
  const sender = m ? parseAddr(m.from) : null;
  const status = m?.status ? STATUS[m.status] : null;

  return (
    <Sheet
      title={box === "inbox" ? "Inkorg" : "Skickat"}
      onClose={onClose}
      footer={
        m && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onReply(replyDraft(m))}
              className="flex-1 rounded-full bg-cyan-400 py-2.5 text-sm font-semibold text-neutral-950 active:scale-[0.98]"
            >
              {box === "inbox" ? "Svara" : "Skicka igen / följ upp"}
            </button>
          </div>
        )
      }
    >
      {err && <p className="m-4 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{err}</p>}
      {!m && !err && (
        <div className="space-y-3 p-4">
          <div className="h-16 animate-pulse rounded-2xl bg-white/5" />
          <div className="h-64 animate-pulse rounded-2xl bg-white/5" />
        </div>
      )}
      {m && sender && (
        <>
          <div className="space-y-2 px-4 pb-3 pt-4">
            <h2 className="text-lg font-bold leading-snug text-white">{m.subject}</h2>
            <div className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate font-semibold text-white">{sender.name}</span>
                <span className="shrink-0 text-xs text-white/40">{fullDate(m.createdAt)}</span>
              </div>
              {sender.addr !== sender.name && <div className="truncate text-xs text-white/40">{sender.addr}</div>}
              <div className="mt-1 truncate text-xs text-white/40">Till: {m.to.join(", ")}</div>
              {m.cc.length > 0 && <div className="truncate text-xs text-white/40">Kopia: {m.cc.join(", ")}</div>}
              {m.replyTo.length > 0 && m.replyTo[0] !== m.from && (
                <div className="truncate text-xs text-white/40">Svara till: {m.replyTo.join(", ")}</div>
              )}
            </div>
            {status && <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.cls}`}>{status.label}</span>}
            {authFail && (
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Avsändaren kunde inte verifieras (SPF {m.auth?.spf ?? "?"} · DKIM {m.auth?.dkim ?? "?"} · DMARC{" "}
                {m.auth?.dmarc ?? "?"}). Var försiktig med länkar.
              </p>
            )}
          </div>
          <div className="mx-4 min-h-[55vh] flex-1 overflow-hidden rounded-xl bg-white">
            <iframe
              title="Mejlinnehåll"
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcDoc={srcDoc}
              className="h-full min-h-[55vh] w-full border-0"
            />
          </div>
          {m.attachmentList.length > 0 && (
            <div className="space-y-1.5 px-4 py-4">
              {m.attachmentList.map((a) => (
                <a
                  key={a.id}
                  href={`/api/admin/mail/${encodeURIComponent(m.id)}/attachments/${encodeURIComponent(a.id)}?box=${box}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm"
                >
                  <span className="truncate text-white">📎 {a.filename}</span>
                  <span className="shrink-0 text-xs text-white/40">{fmtSize(a.size)}</span>
                </a>
              ))}
            </div>
          )}
          <div className="h-4" />
        </>
      )}
    </Sheet>
  );
}

// ── Listan ───────────────────────────────────────────────────────────────────

export default function MailPanel() {
  const [box, setBox] = useState<Box>("inbox");
  const [items, setItems] = useState<MailListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ComposeDraft | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [read, setRead] = useState<Set<string>>(() => new Set());

  useEffect(() => setRead(loadRead()), []);

  const load = useCallback(async (b: Box, after: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ box: b });
      if (after) qs.set("after", after);
      const res = await fetch(`/api/admin/mail?${qs}`, { cache: "no-store" });
      const j = (await res.json()) as { ok?: boolean; items?: MailListItem[]; nextCursor?: string | null; message?: string };
      if (!j.ok) {
        setError(j.message ?? "Kunde inte hämta mejl.");
        if (!after) setItems([]);
        return;
      }
      setItems((prev) => (after ? [...prev, ...(j.items ?? [])] : j.items ?? []));
      setCursor(j.nextCursor ?? null);
    } catch {
      setError("Nätverksfel.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(box, null);
  }, [box, load]);

  // Uppdatera inkorgen när fliken blir synlig igen (t.ex. efter en push).
  useEffect(() => {
    const onVis = () => document.visibilityState === "visible" && void load(box, null);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [box, load]);

  function open(id: string) {
    setOpenId(id);
    if (box === "inbox" && !read.has(id)) {
      const next = new Set(read).add(id);
      setRead(next);
      saveRead(next);
    }
  }

  const unread = box === "inbox" ? items.filter((i) => !read.has(i.id)).length : 0;

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex rounded-lg bg-white/[0.06] p-0.5">
          {(
            [
              ["inbox", "Inkorg"],
              ["sent", "Skickat"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setBox(k)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                box === k ? "bg-white text-neutral-950" : "text-white/60 hover:text-white"
              }`}
            >
              {label}
              {k === "inbox" && box === "inbox" && unread > 0 && (
                <span className="ml-1.5 rounded-full bg-cyan-400 px-1.5 text-[11px] font-bold tabular-nums text-neutral-950">{unread}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load(box, null)}
            aria-label="Uppdatera"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-white/70 hover:bg-white/10"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? "animate-spin" : ""}>
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 3v5h-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setDraft({ to: "", subject: "", body: "" })}
            className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-neutral-950 active:scale-[0.98]"
          >
            Skriv
          </button>
        </div>
      </div>

      {note && (
        <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200" role="status">
          {note}
        </p>
      )}
      {error && <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
        {loading && items.length === 0 && (
          <div className="divide-y divide-white/5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[68px] animate-pulse bg-white/[0.02]" />
            ))}
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-white/40">
            {box === "inbox" ? "Inga mejl till nextwatch.se än." : "Inget skickat från nextwatch.se än."}
          </p>
        )}
        <ul className="divide-y divide-white/5">
          {items.map((it) => {
            const isUnread = box === "inbox" && !read.has(it.id);
            const who = box === "inbox" ? parseAddr(it.from).name : it.to.map((t) => parseAddr(t).name).join(", ");
            const st = it.status ? STATUS[it.status] : null;
            return (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => open(it.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-white/[0.04] active:bg-white/[0.06]"
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isUnread ? "bg-cyan-400" : "bg-transparent"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className={`truncate text-sm ${isUnread ? "font-bold text-white" : "font-medium text-white/80"}`}>
                        {box === "sent" && <span className="text-white/40">Till: </span>}
                        {who || "—"}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-white/40">{when(it.createdAt)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className={`truncate text-sm ${isUnread ? "text-white/90" : "text-white/50"}`}>{it.subject}</span>
                      {it.attachments > 0 && <span className="shrink-0 text-xs text-white/40">📎</span>}
                      {st && <span className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {cursor && (
        <button
          type="button"
          disabled={loading}
          onClick={() => void load(box, cursor)}
          className="mt-3 w-full rounded-xl border border-white/15 py-2.5 text-sm text-white/70 disabled:opacity-40"
        >
          {loading ? "Hämtar…" : "Visa äldre"}
        </button>
      )}

      {openId && (
        <MailView
          box={box}
          id={openId}
          onClose={() => setOpenId(null)}
          onReply={(d) => {
            setOpenId(null);
            setDraft(d);
          }}
        />
      )}
      {draft && (
        <MailComposer
          initial={draft}
          onClose={() => setDraft(null)}
          onSent={() => {
            setNote("Mejlet skickades.");
            setTimeout(() => setNote(null), 4000);
            if (box === "sent") void load("sent", null);
          }}
        />
      )}
    </>
  );
}
