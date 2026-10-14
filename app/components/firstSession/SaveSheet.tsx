"use client";

// Nya flödet, steg "save" (del 4, docs/nya-flodet.md): "Spara dina N filmer
// och kvällens val". Visas när användaren har något att förlora — efter AI:ns
// kvällsval — och gör gästen till ett konto utan onboarding:
//
//   iOS:          Fortsätt med Apple (AppleSignInButton, oförändrad). Servern
//                 (/api/auth/apple) adopterar gästkontot — samma user-id, så
//                 profil, swipes och watchlist följer med — och svarar
//                 redirect "/swipe" eftersom gästprofilen redan finns. Knappen
//                 laddar om /swipe; arket ser då att kontot finns och går vidare.
//   Android/webb: Spara med e-post direkt i arket via /api/auth/register (samma
//                 route som registreringssidan, samma user-id). Ingen navigering
//                 — man står kvar i leken.
//
// App Store-krav som gäller här:
//   - 1.2: kryssrutan för villkoren måste vara ikryssad innan någon knapp
//     fungerar. E-post: termsAccepted i bodyn (registreringen avvisar utan).
//     Apple: cookien nw_terms_ok (se fsSaveShared.ts) → User.termsAcceptedAt.
//   - 4: namnet från Apple förifylls av servern (ersätter gästens "Gäst") och
//     efterfrågas aldrig här.
//
// "Senare" → advanceFs("save", { skipPaywall: true }) (betalväggen kräver konto).
// Lyckat sparande → advanceFs("save", { isPremium }).

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import AppleSignInButton from "@/app/components/auth/AppleSignInButton";
import { notify } from "@/app/components/lib/notify";
import { advanceFs, type FsLike, type FsState } from "@/lib/firstSession";
import { funnel } from "@/lib/funnel";
import { getAccountStatus, invalidateAccountStatus } from "@/lib/accountStatus";
import { isNativeIos, isNativeStoreApp } from "@/lib/premiumPurchase";
import {
  fetchIsPremium,
  markSavePending,
  posterSrc,
  savedLikes,
  setTermsConsentCookie,
  takeSavePending,
  tonightPick,
} from "./fsSaveShared";

type Phase = "checking" | "open" | "done";

export default function SaveSheet({ fs }: { fs: FsState }) {
  const t = useTranslations("fsSave");
  const [phase, setPhase] = useState<Phase>("checking");
  // Komponenten renderas bara på klienten (stegmaskinen läser localStorage),
  // så plattformen kan avgöras direkt.
  const [ios] = useState(() => isNativeIos());
  const [terms, setTerms] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shownRef = useRef(false);

  const likes = savedLikes(fs);
  const pick = tonightPick(fs);
  const minis: FsLike[] = [...likes.slice(-(pick ? 5 : 6)), ...(pick ? [pick] : [])];

  // Har användaren redan ett konto (typiskt: tillbaka efter Fortsätt med Apple,
  // som laddar om /swipe) → inget att spara, gå vidare. Annars visa arket.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const status = await getAccountStatus();
      if (!alive) return;
      if (status?.hasAccount) {
        const via = takeSavePending();
        const isPremium = await fetchIsPremium();
        if (!alive) return;
        if (via) notify(t("save.saved"));
        setPhase("done");
        advanceFs("save", { isPremium });
        return;
      }
      setPhase("open");
      if (!shownRef.current) {
        shownRef.current = true;
        funnel("save_card_shown", { likes: likes.length, pick: Boolean(pick), apple: ios });
      }
    })();
    return () => {
      alive = false;
    };
    // Körs en gång per montering — fs ändras inte medan steget är "save".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Samtycket får inte ligga kvar om arket stängs utan inloggning.
  useEffect(() => () => setTermsConsentCookie(false), []);

  function onTermsChange(on: boolean) {
    setTerms(on);
    setErr(null);
    // Apple-vägen: servern läser samtycket ur cookien (AppleSignInButton
    // skickar inget villkorsfält). Sätts bara när rutan faktiskt är ikryssad.
    if (ios) setTermsConsentCookie(on);
  }

  function later() {
    if (busy) return;
    setTermsConsentCookie(false);
    funnel("save_card_later");
    setPhase("done");
    advanceFs("save", { skipPaywall: true });
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!terms || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          email,
          password: pwd,
          termsAccepted: terms,
          from: isNativeStoreApp() ? "app" : undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!res.ok || !data?.ok) {
        setErr(data?.message || t("save.error"));
        return;
      }
      funnel("signup_email");
      takeSavePending();
      invalidateAccountStatus();
      notify(t("save.emailSent"));
      const isPremium = await fetchIsPremium();
      setPhase("done");
      advanceFs("save", { isPremium });
    } catch {
      setErr(t("save.error"));
    } finally {
      setBusy(false);
    }
  }

  const count = likes.length;
  const title = pick ? t("save.titleWithPick", { count }) : t("save.title", { count });

  return (
    <AnimatePresence>
      {phase === "open" ? (
        <div
          key="fs-save"
          data-blocking-sheet
          className="fixed inset-0 z-[68] flex items-end justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fs-save-title"
        >
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
          <motion.div
            className="relative w-full max-w-md"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34, mass: 0.9 }}
          >
            <div className="flex max-h-[92dvh] flex-col overflow-y-auto overscroll-contain rounded-t-[28px] border border-b-0 border-white/10 bg-[#141416] px-[22px] pb-[calc(env(safe-area-inset-bottom)+20px)] pt-3 shadow-[0_-18px_60px_rgba(0,0,0,0.6)]">
              <div className="flex justify-center">
                <span className="h-1 w-[38px] rounded-full bg-white/20" />
              </div>

              {minis.length > 0 ? (
                <div className="mt-4 flex gap-1.5" aria-hidden>
                  {minis.map((m) => {
                    const src = posterSrc(m.poster);
                    const isPick = pick && m.tmdbId === pick.tmdbId && m.mediaType === pick.mediaType;
                    return (
                      <span
                        key={`${m.mediaType}:${m.tmdbId}`}
                        className={[
                          "relative h-[69px] w-[46px] shrink-0 overflow-hidden rounded-lg bg-neutral-800",
                          isPick
                            ? "shadow-[0_0_0_1.5px_rgba(34,211,238,0.8),0_0_14px_rgba(139,92,246,0.35)]"
                            : "shadow-[0_0_0_1px_rgba(255,255,255,0.12)]",
                        ].join(" ")}
                      >
                        {src ? (
                          <Image src={src} alt="" width={46} height={69} className="h-full w-full object-cover" unoptimized />
                        ) : (
                          <span className="grid h-full w-full place-items-center px-1 text-center text-[9px] leading-tight text-neutral-400">
                            {m.title}
                          </span>
                        )}
                        {isPick ? (
                          <span className="absolute right-0.5 top-0.5 text-[10px] text-cyan-300">✦</span>
                        ) : null}
                      </span>
                    );
                  })}
                </div>
              ) : null}

              <h2 id="fs-save-title" className="mt-4 text-[26px] font-extrabold leading-[1.12] tracking-[-0.02em] text-white">
                {title}
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-neutral-400">
                {ios ? t("save.bodyApple") : t("save.bodyEmail")}
              </p>

              {/* Guideline 1.2: uttryckligt godkännande krävs innan kontot skapas. */}
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/30 p-3 text-sm leading-snug text-neutral-300">
                <input
                  type="checkbox"
                  checked={terms}
                  onChange={(e) => onTermsChange(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-400"
                />
                <span>
                  {t.rich("save.terms", {
                    terms: (chunks) => (
                      <Link href="/legal/terms" className="text-cyan-300 underline underline-offset-2">
                        {chunks}
                      </Link>
                    ),
                    privacy: (chunks) => (
                      <Link href="/legal/privacy" className="text-cyan-300 underline underline-offset-2">
                        {chunks}
                      </Link>
                    ),
                  })}
                </span>
              </label>

              <div className="mt-4 flex flex-col gap-2">
                {ios ? (
                  // AppleSignInButton är avstängd tills rutan är ikryssad. Capture-
                  // fasen hinner före knappens egen onClick: lägg samtycket och
                  // markören innan Apple-dialogen öppnas.
                  <div
                    className="[&_button]:h-[54px] [&_button]:rounded-[14px] [&_button]:text-[17px] [&_button]:font-bold"
                    onClickCapture={() => {
                      if (!terms) return;
                      setTermsConsentCookie(true);
                      markSavePending("apple");
                      funnel("save_card_apple");
                    }}
                  >
                    <AppleSignInButton disabled={!terms} />
                  </div>
                ) : showEmail ? (
                  <form onSubmit={(e) => void submitEmail(e)} className="flex flex-col gap-2.5">
                    <label className="sr-only" htmlFor="fs-save-email">
                      {t("save.emailLabel")}
                    </label>
                    <input
                      id="fs-save-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t("save.emailPlaceholder")}
                      className="h-12 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-[15px] text-white outline-none focus:ring-2 focus:ring-white/20"
                    />
                    <label className="sr-only" htmlFor="fs-save-pwd">
                      {t("save.passwordLabel")}
                    </label>
                    <input
                      id="fs-save-pwd"
                      type="password"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={pwd}
                      onChange={(e) => setPwd(e.target.value)}
                      placeholder={t("save.passwordPlaceholder")}
                      className="h-12 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-[15px] text-white outline-none focus:ring-2 focus:ring-white/20"
                    />
                    <button
                      type="submit"
                      disabled={!terms || busy}
                      className="h-[54px] w-full rounded-[14px] bg-cyan-500 text-[17px] font-bold text-neutral-950 transition hover:bg-cyan-400 active:scale-[0.98] disabled:bg-white/10 disabled:text-neutral-500"
                    >
                      {busy ? t("save.saving") : t("save.submit")}
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    disabled={!terms}
                    onClick={() => {
                      markSavePending("email");
                      funnel("save_card_email");
                      setShowEmail(true);
                    }}
                    className="h-[54px] w-full rounded-[14px] bg-cyan-500 text-[17px] font-bold text-neutral-950 transition hover:bg-cyan-400 active:scale-[0.98] disabled:bg-white/10 disabled:text-neutral-500"
                  >
                    {t("save.emailCta")}
                  </button>
                )}
                {!terms ? <p className="text-center text-xs text-neutral-500">{t("save.termsHint")}</p> : null}
                {err ? <p className="text-center text-sm text-red-400">{err}</p> : null}
                <button
                  type="button"
                  onClick={later}
                  disabled={busy}
                  className="h-11 w-full text-center text-[15px] text-neutral-400 transition hover:text-neutral-200"
                >
                  {t("save.later")}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
