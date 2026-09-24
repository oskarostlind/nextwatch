"use client";

// Global värd för de triggade "skapa konto"-prompterna (lib/signupNudge.ts).
// Monteras en gång i OverlayMount. Visar bara något för gäster — för alla
// andra svarar den direkt (premium-köpet går vidare) och är osynlig.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Modal from "@/app/components/ui/Modal";
import { Button } from "@/app/components/ui/kit";
import { isGuest } from "@/lib/accountStatus";
import {
  SIGNUP_NUDGE_EVENT,
  markNudgeShown,
  nudgeAllowed,
  setSignupNudgeHostMounted,
  type NudgeTrigger,
  type SignupNudgeDetail,
} from "@/lib/signupNudge";

export default function SignupNudge() {
  const t = useTranslations("guestConvert");
  const router = useRouter();
  const pathname = usePathname();
  const [trigger, setTrigger] = useState<NudgeTrigger | null>(null);
  const resolveRef = useRef<SignupNudgeDetail["onResolve"]>(undefined);
  // En prompt i taget — en andra trigger medan arket är öppet ignoreras.
  const openRef = useRef(false);

  useEffect(() => {
    setSignupNudgeHostMounted(true);
    return () => setSignupNudgeHostMounted(false);
  }, []);

  useEffect(() => {
    function onNudge(e: Event) {
      const { trigger: tr, onResolve } = (e as CustomEvent<SignupNudgeDetail>).detail;
      if (openRef.current || !nudgeAllowed(tr)) {
        onResolve?.(true);
        return;
      }
      void isGuest().then((guest) => {
        if (!guest || openRef.current) {
          onResolve?.(true);
          return;
        }
        openRef.current = true;
        resolveRef.current = onResolve;
        markNudgeShown(tr);
        setTrigger(tr);
      });
    }
    window.addEventListener(SIGNUP_NUDGE_EVENT, onNudge);
    return () => window.removeEventListener(SIGNUP_NUDGE_EVENT, onNudge);
  }, []);

  const close = useCallback((continueWithoutAccount: boolean) => {
    openRef.current = false;
    const r = resolveRef.current;
    resolveRef.current = undefined;
    setTrigger(null);
    r?.(continueWithoutAccount);
  }, []);

  // Byter användaren sida medan arket är öppet (t.ex. flikbyte) stängs det.
  useEffect(() => {
    if (openRef.current) close(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!trigger) return null;

  const isPremium = trigger === "premium";

  return (
    <Modal open onClose={() => close(false)} labelledBy="signup-nudge-title">
      <div className="mx-auto max-w-sm px-1 pb-1 pt-6 text-center" data-testid="signup-nudge" data-trigger={trigger}>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/15 text-2xl">
          {EMOJI[trigger]}
        </div>
        <h2 id="signup-nudge-title" className="text-lg font-bold text-white">
          {t(`${trigger}.title`)}
        </h2>
        <p className="mt-2 text-sm text-neutral-300">{t(`${trigger}.body`)}</p>
        <div className="mt-6 grid gap-2">
          <Button
            onClick={() => {
              close(false);
              router.push(`/auth/register?from=nudge-${trigger}`);
            }}
          >
            {t("createAccount")}
          </Button>
          <Button variant="ghost" onClick={() => close(isPremium)}>
            {isPremium ? t("premium.continue") : t("notNow")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const EMOJI: Record<NudgeTrigger, string> = {
  swipes: "🔥",
  watchlist: "🍿",
  group: "👥",
  friend: "🤝",
  premium: "⭐",
};
