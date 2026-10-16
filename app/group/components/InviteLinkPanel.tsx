"use client";

// "Bjud in med länk" i Grupp-fliken. Samma länk som bjud in-kortet i första
// sessionen (POST /api/group/share → /g/<kod>): vännen swipar i webbläsaren
// utan app eller konto, värdens gillade följer med och båda får AI-val när
// vännen swipat klart (lib/referral.ts). Förr fanns länken BARA i det kortet —
// tryckte man förbi det gick det inte att bjuda in någon med länk i efterhand
// (Oskar 2026-10-16). "Bjud in" i gruppen räckte inte: den når bara vänner som
// redan har appen.
//
// /api/group/share återanvänder den aktiva gruppen (nw_group) eller skapar en
// ny och sätter cookien — `onGroupReady` låter Grupp-fliken visa den direkt.

import { useState } from "react";
import { Copy, Link2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { notify } from "@/app/components/lib/notify";
import { funnel } from "@/lib/funnel";
import { copyText, shareLink, type ShareOutcome } from "@/lib/shareLink";

const REWARD_PICKS = 5; // = REFERRAL_PICKS i lib/referral.ts (servern avgör)
const REWARD_VOTES = 10; // = REFERRAL_VOTES i lib/referral.ts

type ShareResp = { ok: true; code: string; url: string; seeded: number } | { ok: false; message?: string };

export default function InviteLinkPanel({
  variant = "card",
  onGroupReady,
}: {
  /** "card" = eget kort (ingen grupp än), "inline" = överst i Bjud in-rutan. */
  variant?: "card" | "inline";
  onGroupReady?: (code: string) => void;
}) {
  const t = useTranslations("invite");
  const [busy, setBusy] = useState(false);

  async function go(mode: "share" | "copy") {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/group/share", { method: "POST", cache: "no-store" });
      const j = (await res.json().catch(() => null)) as ShareResp | null;
      if (!res.ok || !j || !j.ok) throw new Error("share_failed");
      onGroupReady?.(j.code);
      const out: ShareOutcome =
        mode === "copy"
          ? (await copyText(j.url))
            ? { done: true, via: "copy" }
            : { done: false, cancelled: false }
          : await shareLink(j.url, t("share.title"), t("share.text"));
      if (!out.done) {
        if (!out.cancelled) notify(t("card.failed"));
        return;
      }
      if (out.via === "copy") notify(t("card.copied"));
      funnel("invite_shared", { via: out.via, seeded: j.seeded, from: "group_tab" });
    } catch {
      notify(t("card.failed"));
    } finally {
      setBusy(false);
    }
  }

  const buttons = (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void go("share")}
        className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-500 py-2.5 text-sm font-semibold text-black hover:bg-cyan-400 disabled:opacity-50"
      >
        <Send className="h-4 w-4" /> {busy ? t("card.busy") : t("later.share")}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void go("copy")}
        aria-label={t("card.copy")}
        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 px-3 py-2.5 text-sm hover:bg-white/5 disabled:opacity-50"
      >
        <Copy className="h-4 w-4" /> {t("later.copy")}
      </button>
    </div>
  );

  if (variant === "inline") {
    return (
      <div className="mb-4 rounded-xl border border-cyan-400/25 bg-cyan-500/[0.07] p-3">
        <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-white">
          <Link2 className="h-4 w-4 text-cyan-300" /> {t("later.inlineTitle")}
        </p>
        <p className="mb-3 text-xs text-white/60">{t("later.body")}</p>
        {buttons}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-cyan-400/25 bg-gradient-to-br from-cyan-500/[0.12] to-cyan-500/[0.03] p-5">
      <h3 className="mb-1 flex items-center gap-1.5 font-semibold">
        <Link2 className="h-4 w-4 text-cyan-300" /> {t("later.title")}
      </h3>
      <p className="mb-1 text-sm text-white/60">{t("later.body")}</p>
      <p className="mb-4 text-xs text-white/45">
        {t("later.reward", { picks: REWARD_PICKS, votes: REWARD_VOTES })}
      </p>
      {buttons}
    </div>
  );
}
