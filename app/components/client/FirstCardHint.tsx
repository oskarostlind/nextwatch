"use client";

// Gesttips direkt på FÖRSTA riktiga kortet — ersätter swipe-genomgången som
// startade automatiskt (intro + fyra övningskort + betyg + sammanfattning) och
// navigeringsarket som lades ovanpå första kortet. Tratten 2026-10-12: en ny
// gäst mötte nio steg innan första riktiga swipen och 16 % av dem som fick fram
// kortet swipade aldrig.
//
// 2026-10-15 (Oskar): alla fyra gesterna ska synas LIKA tydligt — ← Nej,
// Gilla →, ↑ Sett och Tryck (vänd kortet). Fyra likvärdiga riktningsmarkörer
// runt ett litet demokort som lugnt nickar åt höger, vänster, upp och vänds,
// två varv och sedan stilla. prefers-reduced-motion → helt stilla.
//
// Ren presentation, pointer-events-none: kortet under går att dra och trycka
// på som vanligt. Tipset tonar bort i takt med att fingret drar kortet (och
// tillbaka om kortet släpps i mitten), döljs när kortet vänds och försvinner
// för gott efter första swipen. Genomgången finns kvar under Profil →
// Genomgång (?tour=swipe-gestures).
//
// Inga backdrop-filter här: tipset ligger på kortet som dras, och filter
// tvingar WKWebView att rita om hela kortet varje bildruta.
import { useEffect, useState, type ReactNode } from "react";
import { motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from "framer-motion";
import { ArrowLeft, ArrowRight, ArrowUp, Film, Hand, Pointer } from "lucide-react";
import { useTranslations } from "next-intl";

const DONE_KEY = "nw_first_card_hint_done";

/** Ska tipset visas? Bara tills enheten gjort sin första riktiga swipe. */
export function shouldShowFirstCardHint(): boolean {
  try {
    if (localStorage.getItem(DONE_KEY) === "1") return false;
    // Swipat förut (räknaren i lib/funnel.ts) → kan redan gesterna.
    if (Number(localStorage.getItem("nw_fx_swipes") ?? 0) > 0) return false;
    return true;
  } catch {
    return false;
  }
}

export function markFirstCardHintDone(): void {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    /* privat läge — tipset kommer tillbaka nästa sidladdning, ofarligt */
  }
}

type Gesture = "like" | "nope" | "seen" | "tap";

// Demots ordning och takt. Lugnt: ett steg i taget med paus emellan, två varv,
// sedan står allt still (långsamma eviga loopar stör mer än de hjälper).
const ORDER: Gesture[] = ["like", "nope", "seen", "tap"];
const START_DELAY_MS = 900;
const STEP_MS = 1900;
const ROUNDS = 2;

// Demokortets rörelse per gest. Keyframes tillbaka till vila så varje steg
// börjar och slutar i mitten — inget hopp mellan stegen.
const CARD_MOTION: Record<Gesture, Record<string, number[]>> = {
  like: { x: [0, 26, 0], y: [0, 0, 0], rotate: [0, 9, 0], rotateY: [0, 0, 0] },
  nope: { x: [0, -26, 0], y: [0, 0, 0], rotate: [0, -9, 0], rotateY: [0, 0, 0] },
  seen: { x: [0, 0, 0], y: [0, -22, 0], rotate: [0, 0, 0], rotateY: [0, 0, 0] },
  // Vänd fram och tillbaka: tryck → baksidan (handling, tjänster) → tryck igen.
  tap: { x: [0, 0, 0], y: [0, 0, 0], rotate: [0, 0, 0], rotateY: [0, 180, 0] },
};
const HAND_MOTION: Record<Gesture, Record<string, number[]>> = {
  like: { x: [0, 26, 0], y: [0, 0, 0], scale: [1, 1, 1] },
  nope: { x: [0, -26, 0], y: [0, 0, 0], scale: [1, 1, 1] },
  seen: { x: [0, 0, 0], y: [0, -22, 0], scale: [1, 1, 1] },
  tap: { x: [0, 0, 0], y: [0, -3, 0], scale: [1, 0.82, 1] },
};
const STEP_TRANSITION = { duration: 1.2, ease: "easeInOut" as const, times: [0, 0.45, 1] };

const TONE: Record<Gesture, { idle: string; active: string; icon: string }> = {
  // Samma färger som swipe-stämplarna (SwipeStampOverlays): gilla grön, nej
  // röd, sett himmelsblå. Tryck/vänd får nya flödets violetta accent.
  like: { idle: "border-emerald-400/60", active: "border-emerald-300 bg-emerald-400/20", icon: "text-emerald-300" },
  nope: { idle: "border-rose-400/60", active: "border-rose-300 bg-rose-400/20", icon: "text-rose-300" },
  seen: { idle: "border-sky-400/60", active: "border-sky-300 bg-sky-400/20", icon: "text-sky-300" },
  tap: { idle: "border-violet-400/60", active: "border-violet-300 bg-violet-400/20", icon: "text-violet-300" },
};

function GesturePill({
  gesture,
  label,
  sub,
  icon,
  iconAfter,
  active,
}: {
  gesture: Gesture;
  label: string;
  sub: string;
  icon: ReactNode;
  iconAfter?: boolean;
  active: boolean;
}) {
  const tone = TONE[gesture];
  return (
    <motion.div
      className={`flex min-w-[80px] flex-col items-center rounded-2xl border bg-black/70 px-2.5 py-1.5 text-center shadow-[0_4px_16px_rgba(0,0,0,0.35)] transition-colors duration-300 ${
        active ? tone.active : tone.idle
      }`}
      animate={{ scale: active ? 1.06 : 1 }}
      transition={{ type: "spring", bounce: 0, duration: 0.35 }}
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold leading-tight text-white">
        {iconAfter ? null : <span className={tone.icon}>{icon}</span>}
        {label}
        {iconAfter ? <span className={tone.icon}>{icon}</span> : null}
      </span>
      <span className="mt-0.5 text-[11px] font-medium leading-tight tracking-[0.01em] text-white/80">{sub}</span>
    </motion.div>
  );
}

export default function FirstCardHint({
  visible,
  x,
  y,
}: {
  visible: boolean;
  /** Toppkortets drag-värden — tipset tonar bort medan fingret drar. */
  x?: MotionValue<number>;
  y?: MotionValue<number>;
}) {
  const t = useTranslations("swipe.firstHint");
  const reduce = useReducedMotion();
  const fallbackX = useMotionValue(0);
  const fallbackY = useMotionValue(0);
  // Fullt synligt i vila, borta efter ~70 px drag. Följer fingret 1:1 i båda
  // riktningarna, så ett avbrutet drag tar tillbaka tipset utan hopp.
  const dragFade = useTransform([x ?? fallbackX, y ?? fallbackY], (v: number[]) =>
    Math.max(0, 1 - (Math.abs(v[0]) + Math.abs(v[1])) / 70),
  );

  // Vilken gest demot visar just nu (null = vila, alla lika).
  const [active, setActive] = useState<Gesture | null>(null);

  useEffect(() => {
    if (!visible || reduce) {
      setActive(null);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const total = ORDER.length * ROUNDS;
    for (let i = 0; i < total; i++) {
      timers.push(
        // ORDER har fyra olika gester → två steg i rad är aldrig samma, så
        // ett nytt animate-mål startar alltid om rörelsen.
        setTimeout(() => setActive(ORDER[i % ORDER.length]), START_DELAY_MS + i * STEP_MS),
      );
    }
    timers.push(setTimeout(() => setActive(null), START_DELAY_MS + total * STEP_MS));
    return () => timers.forEach(clearTimeout);
  }, [visible, reduce]);

  if (!visible) return null;

  const cardAnim = active ? CARD_MOTION[active] : { x: 0, y: 0, rotate: 0, rotateY: 0 };
  const handAnim = active ? HAND_MOTION[active] : { x: 0, y: 0, scale: 1 };

  return (
    <motion.div
      role="note"
      aria-label={t("aria")}
      data-first-card-hint
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-0.5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: reduce ? 0 : 0.35, duration: 0.3 }}
    >
      <motion.div
        aria-hidden
        style={{ opacity: dragFade }}
        className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-2xl bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.8)_0%,rgba(0,0,0,0.55)_55%,rgba(0,0,0,0.05)_88%)] px-3 text-center"
      >
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-white/90">{t("title")}</p>

        <div className="grid w-full max-w-[340px] grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-3">
          {/* ↑ Sett */}
          <div className="col-span-3 justify-self-center">
            <GesturePill
              gesture="seen"
              label={t("seen")}
              sub={t("seenSub")}
              icon={<ArrowUp className="h-4 w-4" strokeWidth={3} />}
              active={active === "seen"}
            />
          </div>

          {/* ← Nej */}
          <div className="justify-self-end">
            <GesturePill
              gesture="nope"
              label={t("nope")}
              sub={t("nopeSub")}
              icon={<ArrowLeft className="h-4 w-4" strokeWidth={3} />}
              active={active === "nope"}
            />
          </div>

          {/* Demokortet + handen */}
          <div className="relative mx-1 h-[92px] w-[66px]" style={{ perspective: 600 }}>
            <motion.div
              className="absolute inset-0"
              style={{ transformStyle: "preserve-3d" }}
              animate={cardAnim}
              transition={active ? STEP_TRANSITION : { duration: 0 }}
            >
              {/* Framsida */}
              <div className="absolute inset-0 flex items-center justify-center rounded-xl border border-white/45 bg-gradient-to-b from-white/30 to-white/10 [-webkit-backface-visibility:hidden] [backface-visibility:hidden]">
                <Film className="h-6 w-6 text-white/90" strokeWidth={1.8} />
              </div>
              {/* Baksida: handling + var den streamas */}
              <div className="absolute inset-0 flex flex-col justify-center gap-1.5 rounded-xl border border-violet-300/70 bg-gradient-to-b from-cyan-400/35 to-violet-400/35 px-2 [-webkit-backface-visibility:hidden] [backface-visibility:hidden] [transform:rotateY(180deg)]">
                <span className="h-1 w-full rounded-full bg-white/80" />
                <span className="h-1 w-4/5 rounded-full bg-white/70" />
                <span className="h-1 w-3/5 rounded-full bg-white/60" />
                <span className="mt-1 h-2.5 w-2/3 rounded-full bg-white/85" />
              </div>
            </motion.div>
            <motion.span
              className="absolute -bottom-4 -right-3 text-white"
              animate={handAnim}
              transition={active ? STEP_TRANSITION : { duration: 0 }}
            >
              <Hand className="h-8 w-8" strokeWidth={1.8} />
            </motion.span>
          </div>

          {/* Gilla → */}
          <div className="justify-self-start">
            <GesturePill
              gesture="like"
              label={t("like")}
              sub={t("likeSub")}
              icon={<ArrowRight className="h-4 w-4" strokeWidth={3} />}
              iconAfter
              active={active === "like"}
            />
          </div>

          {/* Tryck → vänd kortet */}
          <div className="col-span-3 justify-self-center">
            <GesturePill
              gesture="tap"
              label={t("tap")}
              sub={t("tapSub")}
              icon={<Pointer className="h-4 w-4" strokeWidth={2.5} />}
              active={active === "tap"}
            />
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
