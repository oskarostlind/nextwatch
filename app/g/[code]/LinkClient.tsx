"use client";

// Vännens vy av /g/<KOD>: ansluter tyst (/api/group/link-join — gästprofil,
// medlemskap, nw_group) och visar sedan den befintliga gruppleken
// (app/group/swipe/_legacy) med en kort hälsning ovanför. Värdens gillade
// ligger först i leken (app/api/recs/unified → lib/referral pendingGroupLikes).
//
// Mätning (lib/funnel, en gång per enhet): web_swipe vid första rösten via
// länken, group_match_link när en match kommer här, referral_reward när
// servern delat ut belöningen, web_to_install vid klick på App Store-rutan.

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { funnel } from "@/lib/funnel";
import { GROUP_VOTED_EVENT } from "@/lib/groupVoteEvent";
import { refreshSocial } from "@/lib/socialStore";
import { notify } from "@/app/components/lib/notify";
import { CardSkeleton } from "@/app/components/ui/Skeletons";
import InstallNudge from "./InstallNudge";

const GroupSwipe = dynamic(() => import("@/app/group/swipe/_legacy"), { ssr: false });

type Props = { code: string; hostName: string | null; hostLikes: number; appStoreHref: string };

type JoinResp =
  | { ok: true; code: string; joined: boolean }
  | { ok: false; reason: "invalid" | "full" | "session" | "error"; message: string };

function platform(): "ios" | "android" | "web" {
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } })
      .Capacitor;
    if (cap?.isNativePlatform?.()) return cap.getPlatform?.() === "android" ? "android" : "ios";
  } catch {
    /* webb */
  }
  return "web";
}

export default function LinkClient({ code, hostName, hostLikes, appStoreHref }: Props) {
  const t = useTranslations("invite");
  const [state, setState] = useState<"joining" | "ready" | "error">("joining");
  const [failure, setFailure] = useState<{ reason: string; message: string } | null>(null);
  const [voted, setVoted] = useState(false);

  const join = useCallback(async () => {
    setState("joining");
    setFailure(null);
    try {
      const res = await fetch("/api/group/link-join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ code }),
      });
      const j = (await res.json().catch(() => null)) as JoinResp | null;
      if (!j || !j.ok) {
        setFailure({ reason: j && !j.ok ? j.reason : "error", message: j && !j.ok ? j.message : "" });
        setState("error");
        return;
      }
      // Social-store:n (GroupBar, matchlistor) ska se den nya gruppen direkt.
      void refreshSocial();
      setState("ready");
    } catch {
      setFailure({ reason: "error", message: "" });
      setState("error");
    }
  }, [code]);

  useEffect(() => {
    void join();
  }, [join]);

  useEffect(() => {
    if (state !== "ready") return;
    const p = platform();
    const onVote = () => {
      setVoted(true);
      funnel("web_swipe", { platform: p });
    };
    const onMatch = () => funnel("group_match_link", { platform: p });
    const onReward = (e: Event) => {
      const picks = (e as CustomEvent<{ picks?: number }>).detail?.picks ?? 5;
      funnel("referral_reward", { picks });
      notify(t("link.rewardToast", { picks }));
    };
    window.addEventListener(GROUP_VOTED_EVENT, onVote);
    window.addEventListener("nw:group-match", onMatch);
    window.addEventListener("nw:referral-reward", onReward);
    return () => {
      window.removeEventListener(GROUP_VOTED_EVENT, onVote);
      window.removeEventListener("nw:group-match", onMatch);
      window.removeEventListener("nw:referral-reward", onReward);
    };
    // t() är stabil per språk/namnrymd.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const hello =
    hostLikes > 0
      ? hostName
        ? t("link.hello", { name: hostName, count: hostLikes })
        : t("link.helloNoName", { count: hostLikes })
      : t("link.helloEmpty");

  if (state === "error") {
    // Fullt/ogiltigt hinner normalt fångas av servern (page.tsx); det här är
    // kapplöpningen där gruppen fylldes/raderades mellan sidladdning och anslutning.
    const terminal = failure?.reason === "full" || failure?.reason === "invalid";
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight">
          {failure?.reason === "full" ? t("full.title") : failure?.reason === "invalid" ? t("invalid.title") : t("link.error")}
        </h1>
        {failure?.message && <p className="max-w-sm text-[15px] leading-relaxed text-neutral-300">{failure.message}</p>}
        {terminal ? (
          <Link
            href="/"
            className="inline-flex h-12 items-center justify-center rounded-[14px] bg-cyan-400 px-6 font-extrabold text-neutral-950"
          >
            {t("invalid.cta")}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => void join()}
            className="h-12 rounded-[14px] bg-cyan-400 px-6 font-extrabold text-neutral-950"
          >
            {t("link.retry")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 px-5 pb-2 pt-4">
        <span className="text-[13px] font-bold text-cyan-400">{hello}</span>
        <h1 className="text-[22px] font-extrabold leading-tight tracking-tight">{t("link.title")}</h1>
      </header>
      <InstallNudge visible={voted} href={appStoreHref} />
      {state === "joining" ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
          <CardSkeleton />
          <span className="sr-only">{t("link.joining")}</span>
        </div>
      ) : (
        <GroupSwipe code={code} />
      )}
    </div>
  );
}
