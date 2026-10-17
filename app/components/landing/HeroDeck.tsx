"use client";

import * as React from "react";
import Image from "next/image";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useAnimation,
  type MotionValue,
} from "framer-motion";
import { pose, spreadForWidth, type Pose } from "@/lib/deckVisuals";
import { addAnonLike } from "@/lib/anonLikes";
import type { HeroCard } from "@/lib/curatedHero";
import LoginSheet from "../auth/LoginSheet";
import StartSwipingButton from "./StartSwipingButton";
import { useTranslations } from "next-intl";
import { funnel } from "@/lib/funnel";

const VISIBLE_BEHIND = 4;

// Trösklarna är lyfta rakt ur app/swipe/page_client.tsx — de är intunade och
// ska inte uppfinnas igen här.
const DIST_THRESHOLD = 110;
const VELOCITY_THRESHOLD = 700;

// Ingen spärr längre ("nya flödet", 2026-10-15, docs/nya-flodet.md). Fram till
// dess låstes demoleken efter fyra kort med ett "skapa konto / fortsätt som
// gäst"-kort — 63 % swipade aldrig ett demokort och 15 % lämnade startsidan
// utan att välja. Nu går demokorten runt så länge man vill, och huvudknappen
// "Börja swipa" tar en rakt in i den riktiga leken som gäst. I apparna visas
// startsidan inte alls (AuthGate skapar gästen tyst).

/* ------------------------------------------------------------------ */

export default function HeroDeck({ cards }: { cards: HeroCard[] }) {
  const t = useTranslations("landing");
  const [index, setIndex] = React.useState(0);
  const [liked, setLiked] = React.useState<HeroCard[]>([]);
  const [touched, setTouched] = React.useState(false);
  const [loginOpen, setLoginOpen] = React.useState(false);

  const reduce = usePrefersReducedMotion();

  const swipes = index;

  // Efter "Logga ut" (/?login=1) öppnas inloggningen direkt.
  React.useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("login") !== "1") return;
      url.searchParams.delete("login");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      setLoginOpen(true);
    } catch {
      /* ignorera */
    }
  }, []);

  // Tratt: startsidan visad / spelad (lib/funnel.ts).
  React.useEffect(() => funnel("landing_view"), []);
  React.useEffect(() => {
    if (swipes >= 1) funnel("hero_swipe");
  }, [swipes]);

  // Drag-läget som en motion value: allt bakom leken härleds ur den utan
  // att någonsin trigga en React-render under draget.
  const x = useMotionValue(0);
  const controls = useAnimation();
  const rotate = useTransform(x, [-260, 260], [-16, 16]);
  const likeOpacity = useTransform(x, [48, 150], [0, 1]);
  const nopeOpacity = useTransform(x, [-150, -48], [1, 0]);

  // Spridningen från viewporten, som motion value så pose() kan läsa den
  // i samma transformkedja som draget.
  const spreadMV = useMotionValue(0);
  React.useEffect(() => {
    const sync = () => spreadMV.set(spreadForWidth(window.innerWidth));
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [spreadMV]);

  const top = cards[index % cards.length];
  const behind = Array.from({ length: VISIBLE_BEHIND }, (_, i) => cards[(index + i + 1) % cards.length]);

  /* --- spöksvajp: sidan utför gesten själv en gång, så den slipper skrivas ut --- */
  React.useEffect(() => {
    if (reduce || touched) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      void controls.start({
        x: [0, 44, 0],
        rotate: [0, 5, 0],
        transition: { duration: 1.1, times: [0, 0.45, 1], ease: "easeInOut" },
      });
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [reduce, touched, controls]);

  function commit(dir: "left" | "right") {
    const card = top;
    if (!card) return;
    void controls
      .start({
        x: dir === "right" ? 560 : -560,
        rotate: dir === "right" ? 24 : -24,
        opacity: 0,
        transition: { duration: reduce ? 0.12 : 0.32, ease: [0.32, 0.72, 0, 1] },
      })
      .then(() => {
        if (dir === "right") {
          setLiked((p) => [...p, card]);
          // Överlever navigering och spelas upp mot gästprofilen när man
          // trycker "Börja swipa" (createGuestProfile). Se lib/anonLikes.ts.
          addAnonLike({
            tmdbId: card.id,
            mediaType: "movie",
            title: card.title,
            year: card.year,
            poster: card.poster,
          });
        }
        setIndex((i) => i + 1);
        x.set(0);

        // Promotionen. Utan den placerades nya toppkortet direkt i sitt slutläge
        // och poppade upp ur intet — ögat läser det som ett hack i leken, inte
        // som ett kort. Nu startar det i djup 1:s pose och fjädrar fram, så det
        // syns resa sig ur högen. Tunga saker svarar sent: det är viktkänslan.
        const from = pose(1, spreadMV.get(), 0);
        controls.set({ x: 0, rotate: 0, opacity: 1, y: from.y, z: from.z, scale: from.scale });
        if (!reduce) {
          void controls.start({
            y: 0,
            z: 0,
            scale: 1,
            transition: { type: "spring", stiffness: 320, damping: 26 },
          });
        } else {
          controls.set({ y: 0, z: 0, scale: 1 });
        }
      });
  }

  return (
    // AppShell lägger redan pt-[env(safe-area-inset-top)] på <main> för publika
    // routes. Ett min-h på fulla 100dvh här ovanpå den paddingen gör sidan högre
    // än viewporten — därav scrollbaren. Heron ska aldrig scrolla; den är en scen,
    // inte ett dokument.
    <div className="relative flex min-h-[calc(100dvh-env(safe-area-inset-top))] w-full flex-col items-center overflow-hidden bg-[#0a0a0a]">
      {/* Accentglöd. Två staplade lager som korsfadas med opacity — bakgrundsfärg
          animeras aldrig, och blur är förbjuden (fill-rate i WebView). */}
      <AnimatePresence>
        <motion.div
          key={top?.id ?? "none"}
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2"
          style={{
            background: `radial-gradient(circle, ${top?.accent ?? "#666"} 0%, transparent 62%)`,
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.3 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.5, ease: "easeOut" }}
        />
      </AnimatePresence>

      {/* Statisk vinjett — bordskänsla, och garanterar textkontrast oavsett poster. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(circle at 50% 45%, transparent 30%, #0a0a0a 85%)" }}
      />

      {/* Ingen egen safe-area-padding här: AppShell äger den redan, och dubbla
          lager tryckte ner headern långt under notchen.

          I flödet (inte absolute) sedan 2026-10-03: foten har mt-auto, vilket
          äter justify-center — scenen började då på y=0 och rubriken lade sig
          ovanpå "NextWatch"/"Logga in" på telefon. */}
      <header className="relative z-30 flex w-full shrink-0 items-center justify-between px-5 pb-2 pt-4">
        <span className="text-sm font-semibold tracking-tight text-white/90">NextWatch</span>
        {/* Diskret med flit: heron ska äga ytan. Men den här länken är enda vägen
            in för befintliga konton — startsidan är iOS-appens launch-skärm för
            utloggade, så utan den låser vi ute alla som redan har konto. */}
        <button
          type="button"
          onClick={() => setLoginOpen(true)}
          className="rounded-full border border-white/15 px-3.5 py-1.5 text-[13px] font-medium text-white/70 transition hover:border-white/30 hover:text-white"
        >
          {t("signIn")}
        </button>
      </header>

      <LoginSheet open={loginOpen} onClose={() => setLoginOpen(false)} />

      {/* Scenen: tar resten av höjden mellan header och fot och centrerar sig
          där, så luften fördelas jämnt ovanför och under leken. */}
      <div className="relative z-20 flex w-full flex-1 flex-col items-center justify-center py-4">
      <h1 className="relative z-20 mb-6 max-w-[22ch] px-6 text-center text-[clamp(1.6rem,5vw,2.6rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-white">
        {t.rich("headline", {
          accent: (chunks) => (
            <span style={{ color: top?.accent ?? "#fff" }} className="transition-colors duration-500">
              {chunks}
            </span>
          ),
        })}
      </h1>

      {/* EN perspective-wrapper. Nästlade 3d-kontexter spränger lagerantalet i WKWebView. */}
      <div
        className="relative z-20 flex items-center justify-center"
        style={{
          perspective: 1100,
          // Bredden styrs av BÅDE vyns bredd och höjd: ~400px av höjden går till
          // header, rubrik, knappar och fot, resten får kortet (2:3). Tidigare
          // 74vw gav ett ~430px högt kort på iPhone, och sidan blev trång.
          width: "clamp(200px, min(66vw, calc((100dvh - 400px) / 1.5)), 330px)",
          aspectRatio: "2 / 3",
        }}
        onPointerDown={() => setTouched(true)}
      >
        {behind.map((card, i) => (
          <BehindCard
            key={`slot-${i}`}
            card={card}
            depth={i + 1}
            dragX={x}
            spreadMV={spreadMV}
            reduce={reduce}
          />
        ))}

        <motion.div
          className="absolute inset-0 touch-none"
            style={{ x, rotate, zIndex: 10 }}
            animate={controls}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.8}
            onDragEnd={(_, info) => {
              const { offset, velocity } = info;
              if (offset.x > DIST_THRESHOLD || velocity.x > VELOCITY_THRESHOLD) return commit("right");
              if (offset.x < -DIST_THRESHOLD || velocity.x < -VELOCITY_THRESHOLD) return commit("left");
              void controls.start({ x: 0, transition: { type: "spring", stiffness: 500, damping: 30 } });
            }}
          >
            {top ? <Poster card={top} /> : null}
            <motion.div
              style={{ opacity: likeOpacity }}
              className="pointer-events-none absolute left-4 top-5 -rotate-12 rounded-lg border-4 border-emerald-400 px-3 py-1 text-xl font-black uppercase tracking-widest text-emerald-400"
            >
              {t("like")}
            </motion.div>
            <motion.div
              style={{ opacity: nopeOpacity }}
              className="pointer-events-none absolute right-4 top-5 rotate-12 rounded-lg border-4 border-rose-400 px-3 py-1 text-xl font-black uppercase tracking-widest text-rose-400"
            >
              {t("nope")}
            </motion.div>
          </motion.div>
      </div>

      <div className="relative z-20 mt-9 flex w-full max-w-[330px] flex-col items-center gap-3 px-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => commit("left")}
            aria-label={t("nope")}
            className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-white/15 bg-white/5 text-lg text-rose-300 transition hover:bg-white/10"
          >
            ✕
          </button>
          <button
            type="button"
            onClick={() => commit("right")}
            aria-label={t("like")}
            className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-white/15 bg-white/5 text-lg text-emerald-300 transition hover:bg-white/10"
          >
            ♥
          </button>
        </div>
        <p className="text-[13px] text-white/40">
          {top ? `${top.title}${top.year ? ` · ${top.year}` : ""}` : ""}
        </p>
        {/* Huvudknappen: rakt in i den riktiga leken som gäst. Demokorten man
            gillat följer med (createGuestProfile → replayAnonLikesInBackground). */}
        <StartSwipingButton accent={top?.accent ?? "#22d3ee"} />
      </div>
      </div>

      <Pile liked={liked} reduce={reduce} />

      {/* Diskret legal-rad — Apple/AdMob kräver nåbar policy och TMDB kräver
          attribution. Medvetet nästan osynlig: heron äger fortfarande scenen.
          
          Låg fram till 2026-09-24 som `absolute bottom-2`. Heron är centrerad
          (justify-center) i en min-h-behållare, så på ett lågt fönster växte
          det centrerade innehållet ned UNDER den absolut positionerade raden
          och "Hoppa in som gäst" hamnade ovanpå legal-länkarna. Nu ligger raden
          i flödet med mt-auto: den sitter kvar längst ned när det finns plats,
          och knuffas undan i stället för att krocka när det inte gör det. */}
      <footer className="relative z-20 flex w-full shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 px-6 pb-4 pt-6 text-center text-[10px] text-white/25">
        <a href="/legal/privacy" className="transition hover:text-white/60">{t("privacy")}</a>
        <a href="/legal/terms" className="transition hover:text-white/60">{t("terms")}</a>
        <a href="/support" className="transition hover:text-white/60">{t("support")}</a>
        <span>
          {t.rich("tmdbAttribution", {
            tmdb: (chunks) => (
              <a
                href="https://www.themoviedb.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#01b4e4]/60 transition hover:text-[#01b4e4]"
              >
                {chunks}
              </a>
            ),
          })}
        </span>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Korten bakom.
 *
 * Djupet är en spring, draget är en motion value, och pose() läser båda i
 * samma useTransform-kedja. Det ger två saker på en gång: promotionen när ett
 * kort lämnar leken, och Solfjäderns dragdrivna öppning — fjädern blommar ut
 * bakom toppkortet medan du drar och snäpper ihop när du släpper. Noll
 * React-renders under draget.
 * ------------------------------------------------------------------ */

function BehindCard({
  card,
  depth,
  dragX,
  spreadMV,
  reduce,
}: {
  card: HeroCard | undefined;
  depth: number;
  dragX: MotionValue<number>;
  spreadMV: MotionValue<number>;
  reduce: boolean;
}) {
  const depthMV = useSpring(depth, { stiffness: 300, damping: 30 });
  React.useEffect(() => {
    depthMV.set(depth);
  }, [depth, depthMV]);

  const combined = useTransform<number, Pose>(
    [depthMV, dragX, spreadMV],
    ([d, dx, sv]: number[]) => {
      const boost = reduce ? 0 : Math.min(Math.abs(dx) / DIST_THRESHOLD, 1) * 0.25;
      return pose(d, Math.min(sv + boost, 1), card?.jitter ?? 0);
    }
  );

  const x = useTransform(combined, (p) => p.x);
  const y = useTransform(combined, (p) => p.y);
  const z = useTransform(combined, (p) => p.z);
  const rotateY = useTransform(combined, (p) => p.rotateY);
  const rotateZ = useTransform(combined, (p) => p.rotateZ);
  const scale = useTransform(combined, (p) => p.scale);

  if (!card) return null;

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ x, y, z, rotateY, rotateZ, scale, zIndex: 10 - depth }}
    >
      <Poster card={card} />
      {/* Statisk mörkläggning per djup — filter animeras aldrig. */}
      <div
        className="absolute inset-0 rounded-[10px] bg-black"
        style={{ opacity: 0.22 + depth * 0.14 }}
      />
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */

function Poster({ card }: { card: HeroCard }) {
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-[10px] bg-neutral-900"
      style={{
        // Två förbakade skuggor. De animeras aldrig — bara korten rör sig.
        boxShadow: "0 1px 0 rgba(255,255,255,0.14), 0 18px 40px -12px rgba(0,0,0,0.9)",
        border: "3px solid rgba(245,245,245,0.9)",
      }}
    >
      {card.poster ? (
        <Image
          src={card.poster}
          alt={card.title}
          fill
          sizes="(max-width: 640px) 74vw, 330px"
          className="object-cover"
          priority
          draggable={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center p-4 text-center text-sm text-white/50">
          {card.title}
        </div>
      )}
    </div>
  );
}

function Pile({ liked, reduce }: { liked: HeroCard[]; reduce: boolean }) {
  if (liked.length === 0) return null;
  const shown = liked.slice(-4);
  return (
    <div className="absolute bottom-5 right-5 z-30 h-[84px] w-14">
      {shown.map((card, i) => (
        <motion.div
          key={card.id}
          initial={reduce ? false : { scale: 1.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
          className="absolute inset-0 overflow-hidden rounded-[4px] border border-white/20"
          style={{ rotate: `${(i % 2 ? 1 : -1) * (2 + i)}deg` }}
        >
          {card.poster ? (
            <Image src={card.poster} alt="" fill sizes="56px" className="object-cover" />
          ) : null}
        </motion.div>
      ))}
      <span className="absolute -left-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-bold tabular-nums text-black">
        {liked.length}
      </span>
    </div>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduce(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}
