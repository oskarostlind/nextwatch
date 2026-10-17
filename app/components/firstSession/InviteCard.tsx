"use client";

// Nya flödet steg "invite" (del 6): ett kort i leken, lika stort som filmkortet
// och ovanpå kortytan — "Vem tittar du med ikväll?".
//
//   Bjud in någon → POST /api/group/share (återanvänder aktiv grupp eller
//   skapar en ny, lägger värdens gillade i gruppen) → förhandsvisning av vad
//   vännen ser + "Skicka länken" (delningsarket) / "Kopiera länken".
//   Delat eller kopierat → advanceFs("invite"). "Jag tittar själv" → samma.
//
// Varför två tryck i stället för att dela direkt: navigator.share kräver en
// färsk användargest i Safari/WKWebView, och den hinner gå ut medan gruppen
// skapas. Det andra trycket ger en ny gest — och prototypen har samma
// förhandsvisning (steg 8, "DELA").
//
// Delning, i ordning: Capacitors Share-plugin OM det finns i den installerade
// app-builden (vi lägger inte till native-plugins — det kräver nya builds; vi
// tittar bara efter det vid körning), annars navigator.share (Safari, iOS
// WKWebView, mobil-Chrome), annars kopiera + bekräftelse (Android WebView,
// desktop). Avbrutet delningsark = stanna kvar på kortet.
//
// Montering: FirstSessionHost ligger inuti kortytans relativa behållare i
// app/swipe/page_client.tsx (samma yta som kortleken, slutar 38 px ovanför
// knappraden). Kortet tar exakt samma geometri som tjänstekortet
// (ServicesAgeCard) och filmkortet: inset-x-1 top-2 bottom-0, max 420 px,
// rounded-2xl — det täcker alltså aldrig toppraden (Båda/Film/Serier).
// Knappraden döljs av leken medan kortet visas.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { advanceFs, type FsState } from "@/lib/firstSession";
import { funnel } from "@/lib/funnel";
import { notify } from "@/app/components/lib/notify";
import { copyText, shareLink, type ShareOutcome } from "@/lib/shareLink";

const REWARD_PICKS = 5; // = REFERRAL_PICKS i lib/referral.ts (servern avgör)
const REWARD_VOTES = 10; // = REFERRAL_VOTES i lib/referral.ts

function posterSrc(p: string | null | undefined): string | null {
  if (!p) return null;
  if (p.startsWith("http")) return p;
  return p.startsWith("/") ? `https://image.tmdb.org/t/p/w185${p}` : null;
}

type Link = { code: string; url: string; seeded: number };

export default function InviteCard({ fs }: { fs: FsState }) {
  const t = useTranslations("invite");
  const [phase, setPhase] = useState<"ask" | "creating" | "ready">("ask");
  const [link, setLink] = useState<Link | null>(null);
  const [sharing, setSharing] = useState(false);
  const shownRef = useRef(false);

  const likes = fs.likes.slice(-5).reverse();
  const likeCount = fs.likes.length;

  useEffect(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    funnel("invite_shown", { likes: likeCount });
  }, [likeCount]);

  async function createLink() {
    if (phase === "creating") return;
    setPhase("creating");
    try {
      const res = await fetch("/api/group/share", { method: "POST", cache: "no-store" });
      const j = (await res.json().catch(() => null)) as
        | { ok: true; code: string; url: string; seeded: number }
        | { ok: false; message?: string }
        | null;
      if (!res.ok || !j || !j.ok) throw new Error((j && "message" in j && j.message) || "share_failed");
      setLink({ code: j.code, url: j.url, seeded: j.seeded });
      setPhase("ready");
    } catch {
      notify(t("card.failed"));
      setPhase("ask");
    }
  }

  async function send(mode: "share" | "copy") {
    if (!link || sharing) return;
    setSharing(true);
    try {
      const out: ShareOutcome =
        mode === "copy"
          ? (await copyText(link.url))
            ? { done: true, via: "copy" }
            : { done: false, cancelled: false }
          : await shareLink(link.url, t("share.title"), t("share.text"));
      if (!out.done) {
        if (!out.cancelled) notify(t("card.failed"));
        return;
      }
      if (out.via === "copy") notify(t("card.copied"));
      funnel("invite_shared", { via: out.via, seeded: link.seeded });
      advanceFs("invite");
    } finally {
      setSharing(false);
    }
  }

  const shell =
    "pointer-events-auto absolute inset-0 flex flex-col gap-3.5 overflow-y-auto [&>*]:shrink-0 overscroll-contain rounded-2xl px-[22px] pb-[22px] pt-[26px] text-neutral-100 shadow-[0_0_0_1px_rgba(34,211,238,0.30),0_20px_50px_rgba(0,0,0,0.55)]";

  return (
    <div className="absolute inset-x-1 top-2 bottom-0 z-30 mx-auto max-w-[min(100%,420px)] p-0.5">
      <div
        className={shell}
        style={{ background: "radial-gradient(120% 80% at 50% 0%, #10303a 0%, #121214 60%)" }}
        role="dialog"
        aria-labelledby="nw-invite-title"
      >
        {phase !== "ready" ? (
          <>
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-400">{t("card.eyebrow")}</span>
            <h2 id="nw-invite-title" className="text-[30px] font-extrabold leading-[1.08] tracking-tight">
              {t("card.title")}
            </h2>
            <p className="text-[15px] leading-relaxed text-neutral-300">{t("card.body")}</p>

            {likeCount > 0 && (
              <div className="flex items-center gap-2">
                {likes.map((l) => {
                  const src = posterSrc(l.poster);
                  return src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={`${l.mediaType}_${l.tmdbId}`}
                      src={src}
                      alt={l.title}
                      className="h-[60px] w-10 rounded-lg object-cover ring-1 ring-white/10"
                    />
                  ) : (
                    <span
                      key={`${l.mediaType}_${l.tmdbId}`}
                      className="h-[60px] w-10 rounded-lg bg-neutral-800 ring-1 ring-white/10"
                      aria-hidden="true"
                    />
                  );
                })}
                <span className="ml-1 text-[13px] text-neutral-400">{t("card.likesFollow", { count: likeCount })}</span>
              </div>
            )}

            <div className="flex items-center gap-2.5 rounded-[14px] border border-violet-400/35 bg-violet-400/10 px-3.5 py-3">
              <span className="text-lg text-violet-300" aria-hidden="true">
                ✦
              </span>
              <span className="text-sm leading-snug text-violet-50">
                {t.rich("card.reward", {
                  picks: REWARD_PICKS,
                  votes: REWARD_VOTES,
                  b: (chunks) => <b>{chunks}</b>,
                })}
              </span>
            </div>

            <div className="flex-1" />
            <button
              type="button"
              onClick={() => void createLink()}
              disabled={phase === "creating"}
              className="h-[54px] rounded-[14px] bg-cyan-400 text-[17px] font-extrabold text-neutral-950 transition active:scale-[0.98] disabled:opacity-70"
            >
              {phase === "creating" ? t("card.busy") : t("card.cta")}
            </button>
            <button
              type="button"
              onClick={() => advanceFs("invite")}
              className="h-11 text-sm text-neutral-400"
            >
              {t("card.solo")}
            </button>
          </>
        ) : (
          <>
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-400">{t("card.preview")}</span>
            <div className="overflow-hidden rounded-[18px] border border-white/10 bg-neutral-950">
              <div
                className="flex h-[132px] items-end gap-2 p-3.5"
                style={{ background: "linear-gradient(120deg, #0e3a44 0%, #1d1238 60%, #0a0a0a 100%)" }}
              >
                {likes.map((l) => {
                  const src = posterSrc(l.poster);
                  return src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={`p_${l.mediaType}_${l.tmdbId}`}
                      src={src}
                      alt=""
                      className="h-[72px] w-12 rounded-lg object-cover ring-1 ring-white/15"
                    />
                  ) : null;
                })}
              </div>
              <div className="flex flex-col gap-1 px-3.5 py-3">
                <span id="nw-invite-title" className="text-[15px] font-bold">
                  {t("share.title")}
                </span>
                <span className="text-[13px] text-neutral-400">{t("share.text")}</span>
                <span className="truncate text-xs text-neutral-500">{link?.url.replace(/^https?:\/\//, "")}</span>
              </div>
            </div>

            <div className="flex-1" />
            <button
              type="button"
              onClick={() => void send("share")}
              disabled={sharing}
              className="h-[54px] rounded-[14px] bg-cyan-400 text-[17px] font-extrabold text-neutral-950 transition active:scale-[0.98] disabled:opacity-70"
            >
              {t("card.send")}
            </button>
            <button
              type="button"
              onClick={() => void send("copy")}
              disabled={sharing}
              className="h-11 rounded-[14px] border border-white/15 text-sm font-semibold text-neutral-100"
            >
              {t("card.copy")}
            </button>
            <button type="button" onClick={() => advanceFs("invite")} className="h-10 text-sm text-neutral-400">
              {t("card.solo")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
