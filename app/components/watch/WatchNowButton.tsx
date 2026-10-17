'use client';

// "Kolla nu" när titeln går att se. Annars "Bevaka" (Oskar 2026-10-17): en grå
// "Ej tillgänglig" gav användaren ingenting att göra. Bevakningen sparas som en
// ReleaseFollow med kind="stream" (/api/follow) och cronen
// (app/api/cron/daily-recs) pushar när titeln dyker upp på någon av
// användarens tjänster. Komponenten används överallt där titelkort visas
// (swipe-kortets baksida, Upptäck, Watchlist, gruppmatcher, filmchatten), så
// beteendet blir detsamma på alla ställen.

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Bell, BellRing } from "lucide-react";
import { useTranslations } from "next-intl";
import { notify } from "@/app/components/lib/notify";
import { requestReleasePushAsk } from "@/lib/engagement";

export type FollowItem = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
};

type Props = {
  url?: string;
  disabledText?: string;
  /** Titeln att bevaka när den inte går att se. Utan den: grå knapp som förr. */
  follow?: FollowItem;
};

export default function WatchNowButton({ url, disabledText, follow }: Props) {
  const t = useTranslations("watch");
  const enabled = Boolean(url);
  if (!enabled && follow && follow.tmdbId > 0) {
    return <FollowButton item={follow} />;
  }
  return (
    <a
      href={enabled ? url : undefined}
      target={enabled ? '_blank' : undefined}
      rel={enabled ? 'noopener noreferrer' : undefined}
      aria-disabled={!enabled}
      className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition
        ${enabled ? 'bg-cyan-500 hover:bg-cyan-400 text-black' : 'bg-neutral-700 text-neutral-400 cursor-not-allowed'}
      `}
    >
      {enabled ? t('watchNow') : disabledText ?? t('unavailable')}
    </a>
  );
}

function FollowButton({ item }: { item: FollowItem }) {
  const t = useTranslations("watch");
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const { tmdbId, mediaType, title } = item;

  useEffect(() => {
    let ignore = false;
    setFollowing(null);
    fetch(`/api/follow?tmdbId=${tmdbId}&mediaType=${mediaType}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { following?: boolean } | null) => {
        if (!ignore) setFollowing(Boolean(j?.following));
      })
      .catch(() => {
        if (!ignore) setFollowing(false);
      });
    return () => {
      ignore = true;
    };
  }, [tmdbId, mediaType]);

  async function toggle() {
    if (busy) return;
    const next = !following;
    setBusy(true);
    setFollowing(next); // optimistiskt — återställs vid fel
    try {
      const res = await fetch("/api/follow", {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ tmdbId, mediaType, title }),
      });
      if (!res.ok) throw new Error(String(res.status));
      if (next) {
        // Bekräftelsen direkt. I apparna dessutom samma notisfråga som
        // "Kommer snart"-liken (med tjänste-texter) — men bara om notiser inte
        // redan är på; utan push kan bevakningen aldrig levereras.
        notify(t("follow.done", { title }));
        if (Capacitor.isNativePlatform()) requestReleasePushAsk(title, "stream");
      }
    } catch {
      setFollowing(!next);
      notify(t("follow.failed"));
    } finally {
      setBusy(false);
    }
  }

  const on = following === true;
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy || following === null}
      aria-pressed={on}
      title={on ? t("follow.hintOn") : t("follow.hint")}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition disabled:opacity-60 ${
        on
          ? "border border-cyan-400/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/15"
          : "bg-cyan-500 text-black hover:bg-cyan-400"
      }`}
    >
      {on ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
      {on ? t("follow.following") : t("follow.follow")}
    </button>
  );
}
