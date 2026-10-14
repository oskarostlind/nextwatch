"use client";

// "Nya flödet" steg 4 — ✦ AI väljer kvällens film (docs/nya-flodet.md).
//
// När fs.step === "ai" (10 swipes) öppnas Välj åt mig-arket av sig självt med
// dagens GRATIS auto-förslag (POST /api/pick { auto: true } — räknas aldrig mot
// kvoten, högst ett per användare och dygn, samma svar igen samma dygn).
//
// Väntan ska inte synas: förslaget förhämtas redan vid AUTO_PREFETCH_AT swipes
// (lyssnaren nedan, på FS_EVENT) och cachas i minnet + sessionStorage
// (lib/aiPick/client.ts fetchAutoPick). Finns svaret när arket öppnas hoppas
// "tänker"-fasen över; annars syns den tills svaret kommer.
//
// "Spara kvällens film" sparar titeln i watchlisten (samma väg som
// detaljarkets Spara) och går vidare; att stänga arket går också vidare.
// Förslaget som gäller (även efter chips/inbytt alternativ) skrivs till
// flödet med setFsAiPick — spara-arket och notisfrågan läser det.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { advanceFs, FS_EVENT, getFs, setFsAiPick, type FsLike, type FsState } from "@/lib/firstSession";
import { cachedPickStatus, fetchAutoPick, getPickStatus, peekAutoPick, trackPickEvent } from "@/lib/aiPick/client";
import type { PickItem } from "@/lib/aiPick/types";
import { funnel } from "@/lib/funnel";
import type { PickReveal } from "@/app/components/pick/PickSheet";

const PickSheet = dynamic(() => import("@/app/components/pick/PickSheet"), { ssr: false });

/** Förhämta auto-förslaget (och arkets chunk) från den här swipen. */
export const AUTO_PREFETCH_AT = 7;
/** Arkets stängningsanimation hinner klart innan steget byts (då avmonteras vi). */
const EXIT_MS = 320;

function toFsLike(item: PickItem): FsLike {
  return { tmdbId: item.tmdbId, mediaType: item.mediaType, title: item.title, poster: item.poster };
}

/* ---------- förhämtning ---------- */

function maybePrefetch(): void {
  const fs = getFs();
  if (!fs.eligible || fs.step !== "deck" || fs.swipes < AUTO_PREFETCH_AT) return;
  // Delar löfte/cache med arket — flera FS_EVENT ger aldrig flera anrop.
  void fetchAutoPick();
  void import("@/app/components/pick/PickSheet");
}

// Modulen importeras statiskt av FirstSessionHost (monterad i solo-leken) —
// lyssnaren lever så länge leken gör det och kostar inget för andra.
let prefetchListening = false;
if (typeof window !== "undefined" && !prefetchListening) {
  prefetchListening = true;
  window.addEventListener(FS_EVENT, maybePrefetch);
}

/* ---------- steget ---------- */

export default function AiReveal({ fs }: { fs: FsState }) {
  const [open, setOpen] = useState(true);
  // Läses EN gång: fanns svaret redan hoppar arket över "tänker".
  const [ready] = useState(() => peekAutoPick());
  const premiumRef = useRef<boolean>(Boolean(cachedPickStatus()?.premium));
  const doneRef = useRef(false);

  useEffect(() => {
    funnel("ai_auto_reveal", { ready: Boolean(ready), swipes: fs.swipes });
    trackPickEvent("auto_reveal", { ready: Boolean(ready), swipes: fs.swipes });
    void getPickStatus().then((q) => {
      if (q) premiumRef.current = q.premium;
    });
    // Bara vid montering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = useCallback((isPremium?: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setOpen(false);
    window.setTimeout(() => advanceFs("ai", { isPremium: isPremium ?? premiumRef.current }), EXIT_MS);
  }, []);

  const onClose = useCallback(() => {
    trackPickEvent("auto_close");
    finish();
  }, [finish]);

  const likes = fs.likes;
  const reveal = useMemo<PickReveal>(
    () => ({
      ready,
      load: () => fetchAutoPick(),
      // Senast gillade först — det är dem AI:n "läser".
      posters: likes
        .slice(-5)
        .reverse()
        .map((l) => l.poster ?? null),
      likes: likes.length,
      onShown: (res) => {
        if (res.quota) premiumRef.current = res.quota.premium;
        funnel("ai_auto_ok", { fromSaved: res.pick.fromSaved, ready: Boolean(ready) });
      },
      onPickChange: (item) => setFsAiPick(toFsLike(item)),
      onSaved: (item, quota) => {
        setFsAiPick(toFsLike(item));
        finish(quota ? quota.premium : undefined);
      },
      // Funktionen är av för användaren: hoppa över steget tyst.
      onDisabled: () => finish(),
    }),
    [ready, likes, finish]
  );

  return <PickSheet open={open} onClose={onClose} initialQuota={cachedPickStatus()} reveal={reveal} />;
}
