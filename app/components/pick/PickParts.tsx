"use client";

// "Välj åt mig" — delade byggstenar för arket (PickSheet) och historiken
// (PickHistory): affisch, valkortet med motivering + knappar, "Eller kanske"-
// raderna, användarens fråga som en liten pratbubbla och AI:ns svar (i den
// aktuella turen står motiveringen som ett chattsvar ovanför kortet).
//
// Kortet finns i två storlekar: "full" för det aktuella förslaget och
// "compact" för äldre förslag (uppfällda rader i tråden och historiken). Båda
// har samma knappar — att öppna tjänsten eller spara kostar aldrig ett val.
//
// AI-looken (2.0, 2026-10-15): det ska synas direkt att det är AI — ✦ som
// signatur i en roterande konisk ring (AiMark), "tänker"-fasen där gillade
// affischer skannas av ett ljussvep (ThinkingScan), svaret skrivs fram ord för
// ord (AiReply typing) och förslaget ligger i ett glödande kort. Keyframes i
// AiStyles; allt respekterar prefers-reduced-motion.

import { useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { Bookmark, BookmarkCheck, ChevronRight, Heart, Info, PlayCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PickChipId, PickItem } from "@/lib/aiPick/types";
import { providerWatchUrl } from "@/lib/watchLinks";

export type T = ReturnType<typeof useTranslations>;

const TMDB_IMG = "https://image.tmdb.org/t/p";

/** TMDB-sökväg (/abc.jpg) eller färdig URL → URL. */
export function imgUrl(src: string | null | undefined, size: "w92" | "w342"): string | null {
  if (!src) return null;
  if (src.startsWith("http")) return src;
  if (src.startsWith("/")) return `${TMDB_IMG}/${size}${src}`;
  return null;
}

export const itemKey = (it: Pick<PickItem, "tmdbId" | "mediaType">) => `${it.mediaType}-${it.tmdbId}`;

export const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60";

/* ---------- AI-looken ---------- */

/** Keyframes för arket — renderas en gång inuti arkets portal. */
const AI_CSS = `
@keyframes nwaiScan{0%{transform:translateX(-120%)}100%{transform:translateX(420%)}}
@keyframes nwaiPulse{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes nwaiSpin{to{transform:rotate(360deg)}}
@keyframes nwaiRise{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}
@keyframes nwaiGlow{0%,100%{box-shadow:0 0 28px rgba(34,211,238,.10),0 0 0 1px rgba(165,243,252,.18)}50%{box-shadow:0 0 42px rgba(167,139,250,.20),0 0 0 1px rgba(196,181,253,.28)}}
.nwai-scan{animation:nwaiScan 1.25s cubic-bezier(.4,0,.2,1) infinite}
.nwai-pulse{animation:nwaiPulse 1.4s ease-in-out infinite}
.nwai-spin{animation:nwaiSpin 3.2s linear infinite}
.nwai-rise{animation:nwaiRise .42s cubic-bezier(.2,.8,.2,1) both}
.nwai-glow{animation:nwaiGlow 3.6s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.nwai-scan,.nwai-pulse,.nwai-spin,.nwai-rise,.nwai-glow{animation:none!important}.nwai-scan{display:none}}
`;

export function AiStyles() {
  return <style>{AI_CSS}</style>;
}

/** Arkets färger — tunn cyan→violett kant och ytan innanför. */
export const aiGradientText = "bg-gradient-to-r from-cyan-200 to-violet-300 bg-clip-text text-transparent";
export const aiGradientBg = "bg-gradient-to-br from-cyan-400 to-violet-400";

/** ✦ i en roterande konisk ring — AI-signaturen i arkets rubrik. */
export function AiMark({ size = 30 }: { size?: number }) {
  const inner = size - 6;
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} aria-hidden>
      <span
        className="nwai-spin absolute inset-0 rounded-full"
        style={{ background: "conic-gradient(from 0deg, #22d3ee, #a78bfa, #22d3ee)" }}
      />
      <span
        className="relative grid place-items-center rounded-full bg-[#0b0b10] text-[13px] text-cyan-50"
        style={{ width: inner, height: inner }}
      >
        ✦
      </span>
    </span>
  );
}

function subscribeReducedMotion(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener?.("change", cb);
  return () => mq.removeEventListener?.("change", cb);
}

/** prefers-reduced-motion: reduce (false på servern). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    () => false
  );
}

/**
 * "Tänker": upp till fem affischer (användarens gillade) som ett ljussvep
 * glider över, en pulserande rubrik och en rad om vad som händer. Saknas
 * affischer fylls raden med tomma, toner rutor.
 */
export function ThinkingScan({
  posters,
  title,
  sub,
  label,
}: {
  posters: (string | null)[];
  title: React.ReactNode;
  sub?: React.ReactNode;
  label: string;
}) {
  const tiles = [...posters.filter(Boolean).slice(0, 5)] as (string | null)[];
  while (tiles.length < 5) tiles.push(null);
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className="flex flex-col items-center justify-center gap-6 px-2 py-10"
    >
      <div className="relative flex gap-2.5 overflow-hidden rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-3.5">
        {tiles.map((src, i) => {
          const url = imgUrl(src, "w92");
          return (
            <span
              key={i}
              className="relative h-[75px] w-[50px] overflow-hidden rounded-[9px] ring-1 ring-white/[0.12]"
              style={
                url
                  ? undefined
                  : { background: `linear-gradient(${150 + i * 25}deg, rgba(34,211,238,0.16), rgba(167,139,250,0.10))` }
              }
            >
              {url ? <Image src={url} alt="" fill sizes="50px" className="object-cover" draggable={false} /> : null}
            </span>
          );
        })}
        <span
          aria-hidden
          className="nwai-scan pointer-events-none absolute inset-y-0 left-0 w-[70px] mix-blend-screen"
          style={{ background: "linear-gradient(90deg, rgba(34,211,238,0), rgba(165,243,252,0.55), rgba(167,139,250,0))" }}
        />
      </div>
      <div className="flex flex-col items-center gap-2 text-center" aria-live="polite">
        <span className="nwai-pulse text-[17px] font-bold text-cyan-50">{title}</span>
        {sub ? <span className="max-w-xs text-sm leading-relaxed text-white/50">{sub}</span> : null}
      </div>
    </div>
  );
}

/** Hela kalenderdagar mellan iso och idag, i användarens tidszon. */
export function daysSince(iso: string): number | null {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const now = new Date();
  const a = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function likedLine(item: PickItem, t: T): string {
  const d = item.likedAt ? daysSince(item.likedAt) : null;
  if (d === null) return t("liked.fromSaved");
  if (d === 0) return t("liked.today");
  if (d === 1) return t("liked.yesterday");
  if (d < 7) return t("liked.days", { count: d });
  if (d < 30) return t("liked.weeks", { count: Math.floor(d / 7) });
  if (d < 365) return t("liked.months", { count: Math.max(1, Math.floor(d / 30)) });
  return t("liked.years", { count: Math.floor(d / 365) });
}

function runtimeText(item: PickItem, t: T): string | null {
  const m = item.runtimeMin;
  if (!m || m <= 0) return null;
  if (item.mediaType === "tv") return t("runtimeEpisode", { min: m });
  if (m < 60) return t("runtime", { min: m });
  return t("runtimeHm", { h: Math.floor(m / 60), m: m % 60 });
}

export function metaLine(item: PickItem, t: T, genres = 2): string {
  return [item.year ? String(item.year) : null, ...item.genres.slice(0, genres), runtimeText(item, t)]
    .filter(Boolean)
    .join(" · ");
}

/** Första tjänsten vi kan direktlänka till (samma hjälpare som kortets baksida). */
function bestService(item: PickItem): { name: string; logo: string | null; url: string } | null {
  for (const p of item.providers) {
    const url = providerWatchUrl(p.name, item.title);
    if (url) return { name: p.name, logo: p.logo, url };
  }
  return null;
}

/* ---------- frågan ---------- */

/** Vad användaren bad om i en tur — visas som pratbubbla ovanför förslaget. */
export type AskEcho =
  | { kind: "prompt"; text: string }
  | { kind: "chips"; ids: PickChipId[] }
  | { kind: "another" }
  | { kind: "any" }
  /** Dagens auto-förslag — användaren frågade inget. */
  | { kind: "auto" };

/** `autoLabel` = texten för auto-förslaget ("✦ Kvällens val", pick2). */
export function askText(ask: AskEcho, t: T, autoLabel?: string): string {
  switch (ask.kind) {
    case "auto":
      return autoLabel ?? t("thread.anyQuery");
    case "prompt":
      return ask.text;
    case "chips":
      return ask.ids.map((id) => t(`chips.${id}`)).join(" · ");
    case "another":
      return t("another");
    default:
      return t("thread.anyQuery");
  }
}

export function AskBubble({ text, lines = 1 }: { text: string; lines?: 1 | 3 }) {
  return (
    <div className="flex justify-end">
      <p
        className={`max-w-[85%] rounded-2xl rounded-br-md bg-white/[0.07] px-3 py-1.5 text-[13px] leading-snug text-white/70 ${
          lines === 1 ? "truncate" : "line-clamp-3"
        }`}
      >
        {text}
      </p>
    </div>
  );
}

/** Takten för "skrivs fram ord för ord". */
const TYPE_WORD_MS = 55;

/** ✦ i en liten gradientcirkel — AI:ns avsändare i tråden. */
function AiDot() {
  return (
    <span
      aria-hidden
      className={`mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full ${aiGradientBg} text-[11px] font-extrabold text-[#0b0b10]`}
    >
      ✦
    </span>
  );
}

/**
 * AI:ns svar i tråden — vänsterställd text, ingen bubbla (lugnare). Med
 * `typing` skrivs svaret fram ord för ord (direkt vid reduced motion); den
 * fulla texten finns hela tiden för skärmläsare.
 */
export function AiReply({ text, typing = false, onTyped }: { text: string; typing?: boolean; onTyped?: () => void }) {
  const reduced = useReducedMotion();
  const words = text.split(/(\s+)/);
  const animate = typing && !reduced && text.length > 0;
  const [shown, setShown] = useState(animate ? 0 : words.length);

  useEffect(() => {
    if (!animate) {
      setShown(words.length);
      return;
    }
    setShown(0);
    let n = 0;
    const id = window.setInterval(() => {
      // Två steg per ord (ordet + mellanrummet efter).
      n = Math.min(words.length, n + 2);
      setShown(n);
      if (n >= words.length) window.clearInterval(id);
    }, TYPE_WORD_MS);
    return () => window.clearInterval(id);
    // words härleds ur text — räcker att lyssna på den.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, animate]);

  const done = shown >= words.length;
  useEffect(() => {
    if (done && typing) onTyped?.();
  }, [done, typing, onTyped]);

  if (!text) return null;
  return (
    <div className="flex items-start gap-2.5">
      <AiDot />
      <p className="min-h-[3em] min-w-0 flex-1 text-[15px] leading-relaxed text-gray-200">
        <span className="sr-only">{text}</span>
        <span aria-hidden>
          {words.slice(0, shown).join("")}
          {!done ? <span className="nwai-pulse text-cyan-300">▍</span> : null}
        </span>
      </p>
    </div>
  );
}

/** "Skriver …" medan ett följdsvar hämtas. */
export function TypingReply({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex items-center gap-2.5">
      <AiDot />
      <span className="inline-flex items-center gap-1 rounded-2xl rounded-bl-md border border-cyan-200/15 bg-cyan-400/[0.06] px-3 py-2.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-200/70 motion-reduce:animate-none"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </span>
    </div>
  );
}

/* ---------- små byggstenar ---------- */

export function Poster({
  src,
  title,
  className,
  sizes = "120px",
  tiny = false,
}: {
  src: string | null;
  title: string;
  className: string;
  sizes?: string;
  tiny?: boolean;
}) {
  const url = imgUrl(src, tiny ? "w92" : "w342");
  return (
    <div className={`relative shrink-0 overflow-hidden bg-white/[0.06] ring-1 ring-white/10 ${className}`}>
      {url ? (
        // Dekorativ: titeln står alltid i klartext bredvid postern.
        <Image src={url} alt="" fill sizes={sizes} className="object-cover" draggable={false} />
      ) : tiny ? null : (
        <div className="flex h-full w-full items-center justify-center p-1 text-center text-[10px] text-white/40">
          {title}
        </div>
      )}
    </div>
  );
}

export function Pulse({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/10 ${className}`} />;
}

function LikedMarker() {
  const t = useTranslations("pick");
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-400/25">
      <Heart className="h-2.5 w-2.5 fill-current" aria-hidden />
      {t("likedMarker")}
    </span>
  );
}

/** "Eller kanske" — kompakta rader; ett tryck byter plats med huvudförslaget. */
export function AltRows({ alts, onSelect }: { alts: PickItem[]; onSelect: (alt: PickItem) => void }) {
  // onSelect öppnar detaljarket (PickDetailSheet) när kortet har onOpenDetail.
  const t = useTranslations("pick");
  if (alts.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-white/40">{t("alternatives")}</p>
      <ul className="-mx-1 space-y-0.5">
        {alts.map((alt) => {
          const meta = metaLine(alt, t, 1);
          return (
            <li key={itemKey(alt)}>
              <button
                type="button"
                onClick={() => onSelect(alt)}
                aria-label={t("altAria", { title: alt.title })}
                className={`flex min-h-[52px] w-full items-center gap-3 rounded-xl p-1 text-left transition hover:bg-white/[0.05] active:scale-[0.99] ${focusRing}`}
              >
                <Poster src={alt.poster} title={alt.title} sizes="40px" className="aspect-[2/3] w-8 rounded-md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white/90">{alt.title}</span>
                  {meta ? <span className="block truncate text-xs text-white/45">{meta}</span> : null}
                </span>
                {alt.fromSaved ? <LikedMarker /> : null}
                <ChevronRight className="h-4 w-4 shrink-0 text-white/25" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- valkortet ---------- */

export type PickCardProps = {
  /** Det som visas i huvudplatsen just nu (kan vara ett utbytt alternativ). */
  main: PickItem;
  /** itemKey för det ursprungliga valet — motiveringen gäller bara det. */
  pickKey: string;
  reason: string;
  alts: PickItem[];
  onAltSelect: (alt: PickItem) => void;
  saved: boolean;
  saving: boolean;
  onSave: (item: PickItem) => void;
  onOpenService: (item: PickItem, provider: string) => void;
  size?: "full" | "compact";
  titleId?: string;
  /**
   * false: motiveringen visas utanför kortet (som AI:ns chattsvar i tråden) —
   * kortet visar då ingen text för originalvalet (sammanfattningen bakom "Visa info").
   */
  reasonInline?: boolean;
  /**
   * Öppnar detaljarket (dela/spara/betygsätt/trailer). När den finns är
   * affisch + titel klickbara och "Eller kanske"-raderna öppnar arket i stället
   * för att byta plats med huvudförslaget.
   */
  onOpenDetail?: (item: PickItem) => void;
  /** Liten etikett ovanför titeln, t.ex. "Kvällens val" (bara full storlek). */
  eyebrow?: string;
};

export function PickCard({
  main,
  pickKey,
  reason,
  alts,
  onAltSelect,
  saved,
  saving,
  onSave,
  onOpenService,
  size = "full",
  titleId,
  reasonInline = true,
  onOpenDetail,
  eyebrow,
}: PickCardProps) {
  const t = useTranslations("pick");
  const [infoOpen, setInfoOpen] = useState(false);
  const full = size === "full";
  const isOriginal = itemKey(main) === pickKey;
  const service = bestService(main);
  const meta = metaLine(main, t);
  // Logotyperna visas bara när det inte finns en "Öppna i …"-knapp (den bär
  // redan tjänstens logga) — färre element, och kortet blir lägre så att
  // alternativen får plats utan scroll.
  const logos = full && !service ? main.providers.filter((p) => imgUrl(p.logo, "w92")).slice(0, 4) : [];
  const serviceLogo = service ? imgUrl(service.logo, "w92") : null;
  const btnH = full ? "min-h-12" : "min-h-11";
  const saveSize = full ? "h-12 w-12" : "h-11 w-11";

  return (
    <div className={full ? "space-y-3" : "space-y-2.5"}>
      <div
        className={`flex ${full ? "gap-4" : "gap-3"} ${
          onOpenDetail ? `-m-1 cursor-pointer rounded-2xl p-1 transition hover:bg-white/[0.04] active:scale-[0.99] ${focusRing}` : ""
        }`}
        {...(onOpenDetail
          ? {
              role: "button",
              tabIndex: 0,
              "aria-label": t("detail.openAria", { title: main.title }),
              onClick: () => onOpenDetail(main),
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenDetail(main);
                }
              },
            }
          : {})}
      >
        <Poster
          src={main.poster}
          title={main.title}
          sizes={full ? "120px" : "80px"}
          className={`aspect-[2/3] ${full ? "w-[92px] rounded-xl" : "w-16 rounded-lg"}`}
        />
        <div className="min-w-0 flex-1">
          {eyebrow && full ? (
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-300">✦ {eyebrow}</p>
          ) : null}
          {main.fromSaved ? (
            <span className="mb-1.5 inline-flex max-w-full items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-400/25">
              <Heart className="h-3 w-3 shrink-0 fill-current" aria-hidden />
              <span className="truncate">{likedLine(main, t)}</span>
            </span>
          ) : null}
          <h3
            id={titleId}
            className={`font-bold leading-tight text-white ${full ? "text-xl" : "text-base"}`}
          >
            {main.title}
          </h3>
          {meta ? <p className="mt-1 text-[13px] leading-snug text-white/50">{meta}</p> : null}
          {onOpenDetail ? (
            <p className="mt-1.5 inline-flex items-center gap-0.5 text-[12px] font-medium text-cyan-300/80">
              {t("detail.more")}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </p>
          ) : null}
          {logos.length > 0 ? (
            <ul aria-label={t("providersAria")} className="mt-2 flex flex-wrap gap-1.5">
              {logos.map((p) => (
                <li key={p.name} title={p.name} className="relative h-7 w-7 overflow-hidden rounded-lg ring-1 ring-white/10">
                  <Image src={imgUrl(p.logo, "w92")!} alt={p.name} fill sizes="28px" className="object-cover" />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {isOriginal && reason ? (
        reasonInline ? (
          <p className={`leading-relaxed text-white/80 ${full ? "text-[15px]" : "text-sm"}`}>{reason}</p>
        ) : null
      ) : main.overview ? (
        <p className={`line-clamp-3 leading-relaxed text-white/70 ${full ? "text-[15px]" : "text-sm"}`}>
          {main.overview}
        </p>
      ) : null}

      {infoOpen && main.overview && isOriginal ? (
        <p className="text-sm leading-relaxed text-white/60">{main.overview}</p>
      ) : null}

      <div className="flex items-stretch gap-2">
        {service ? (
          <a
            href={service.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onOpenService(main, service.name)}
            className={`flex ${btnH} min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-cyan-300 px-4 font-semibold text-black shadow-[0_0_24px_rgba(34,211,238,0.25)] transition hover:from-cyan-300 hover:to-cyan-200 active:scale-[0.98] ${
              full ? "text-[15px]" : "text-sm"
            } ${focusRing}`}
          >
            {serviceLogo ? (
              <span className="relative h-5 w-5 shrink-0 overflow-hidden rounded">
                <Image src={serviceLogo} alt="" fill sizes="20px" className="object-cover" />
              </span>
            ) : (
              <PlayCircle className="h-5 w-5 shrink-0" aria-hidden />
            )}
            <span className="truncate">{t("openIn", { service: service.name })}</span>
          </a>
        ) : main.overview && isOriginal ? (
          <button
            type="button"
            onClick={() => setInfoOpen((v) => !v)}
            aria-expanded={infoOpen}
            className={`flex ${btnH} flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 font-semibold text-white transition hover:bg-white/10 active:scale-[0.98] ${
              full ? "text-[15px]" : "text-sm"
            } ${focusRing}`}
          >
            <Info className="h-4 w-4" aria-hidden />
            {infoOpen ? t("hideInfo") : t("showInfo")}
          </button>
        ) : (
          <div className="flex-1" />
        )}

        <button
          type="button"
          onClick={() => onSave(main)}
          disabled={saved || saving}
          aria-label={saved ? t("saved") : t("save")}
          title={saved ? t("saved") : t("save")}
          className={`flex ${saveSize} shrink-0 items-center justify-center rounded-2xl border transition active:scale-95 disabled:active:scale-100 ${focusRing} ${
            saved
              ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
              : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10 disabled:opacity-60"
          }`}
        >
          {saved ? <BookmarkCheck className="h-5 w-5" aria-hidden /> : <Bookmark className="h-5 w-5" aria-hidden />}
        </button>
      </div>

      <AltRows alts={alts} onSelect={onOpenDetail ?? onAltSelect} />
    </div>
  );
}
