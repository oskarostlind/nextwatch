"use client";

// "Välj åt mig" — bottenarket. Öppnas av PickLauncher (✦ i swipens topprad).
//
// Tillstånd: ask → loading → result, plus paywall, error och historiken
// (history → historyDetail). Servern (/api/pick*) är källan till sanning för
// kvoten; arket läser den cachade kvoten direkt vid öppning och hämtar en
// färsk i bakgrunden.
//
// Ett öppnat ark = en "konversation" (sessionId skickas med varje förfrågan).
// Efter första svaret blir arket en chatt: användarens bubbla (höger) → AI:ns
// svar (motiveringen) → kortet med två alternativ. De två närmast föregående
// turerna ligger som hopfällda rader ("Förra förslaget: …") ovanför. Längst ned
// sitter en fast skrivrad + en rad små snabbsvar ("Har sett den", "Kortare",
// "Lättare", "Mer som den") — varje följdfråga skickas med samma sessionId och
// tolkas av servern i samtalets sammanhang (lib/aiPick/followup.ts). Varje nytt
// förslag kostar ett val, precis som första. "Fortsätt chatten" i historiken
// laddar en gammal session i tråden och fortsätter den.
//
// Tangentbordet (iOS-WebView): arket följer window.visualViewport — overlayn
// får visuella viewportens höjd/offset så att arket (och skrivraden) ligger
// precis ovanför tangentbordet i stället för att knuffas ut ur bild, och
// arkets maxhöjd krymper med den. Utan visualViewport faller det tillbaka på
// dvh + scrollIntoView vid fokus.
//
// Ägarens prioritet: AI:n ska helst välja något användaren REDAN gillat men
// inte sett. Därför visas "Du gillade den för 3 veckor sedan" tydligt när valet
// kommer från de sparade — poängen är att få folk att faktiskt se det de
// swipat ja på.
//
// Layout: på en 390×844-telefon ska de två alternativen ("Eller kanske") synas
// utan att man scrollar, även med två hopfällda tidigare turer ovanför. Därav
// 92 px affisch, tätare mellanrum och arkets max 88dvh.
//
// Monetisering (se PICK_SPEC):
//   - Gratis: 0 val utan vidare. Belöningsvideo (bara native iOS) → +N val.
//     Premium-CTA visas alltid för gratisanvändare (på webben är den enda vägen).
//   - Premium: 20 val/månad. Slut → belöningsvideo som påfyllnad (iOS), annars
//     bara beskedet att månaden nollställs.
// Premium-CTA:n: på webben → /premium (Stripe). I iOS-appen startar knappen i
// paywall-vyn Apple-köpet direkt via goPremium() (samma som PremiumUpsellModal)
// — /premium i appen upplevdes som "webbens premium". Pris/period/förnyelse
// (upsell.legal) står under knappen vid köptillfället (3.1.2c); nudgen under
// ett förslag öppnar därför paywall-vyn i appen i stället för att köpa direkt.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import {
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  Clock,
  Crown,
  History as HistoryIcon,
  PlayCircle,
  RefreshCw,
  Shuffle,
  Smile,
  Sparkles,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type {
  PickChipId,
  PickHistorySession,
  PickItem,
  PickQuickReply,
  PickQuota,
  PickRequestBody,
} from "@/lib/aiPick/types";
import { getPickStatus, newPickSessionId, requestPick, trackPickEvent } from "@/lib/aiPick/client";
import { watchRewardedForPicks } from "@/lib/admobAds";
import { goPremium, isNativeIos } from "@/lib/premiumPurchase";
import { useSwipeSettings } from "@/app/components/client/SwipeSettingsProvider";
import { notify } from "@/app/components/lib/notify";
import {
  AiReply,
  AskBubble,
  askText,
  focusRing,
  itemKey,
  PickCard,
  Poster,
  Pulse,
  TypingReply,
  type AskEcho,
} from "@/app/components/pick/PickParts";
import PickDetailSheet, { type PickDetailFrom } from "@/app/components/pick/PickDetailSheet";
import {
  entryAsk,
  HistoryDetail,
  HistoryList,
  sessionLabel,
  usePickHistory,
} from "@/app/components/pick/PickHistory";

type View = "ask" | "loading" | "result" | "paywall" | "error" | "history" | "historyDetail";
type ErrorKind = "no_candidates" | "unavailable" | "disabled";
type Query = { prompt?: string; chips?: PickChipId[]; mediaFilter: "both" | "movie" | "tv" };

/** Ett svar i tråden. `main`/`alts` ändras när användaren byter in ett alternativ. */
type Turn = {
  id: string;
  ask: AskEcho;
  pick: PickItem;
  main: PickItem;
  alts: PickItem[];
  reason: string;
};

const CHIPS: { id: PickChipId; icon: LucideIcon }[] = [
  { id: "light", icon: Smile },
  { id: "short", icon: Clock },
  { id: "thrilling", icon: Zap },
  { id: "surprise", icon: Shuffle },
];

const LOADING_KEYS = ["saved", "taste", "services", "almost"] as const;
const LOADING_STEP_MS = 1700;

/** Kritiskt dämpad spring (damping = 2·√stiffness vid mass 1) — ingen studs. */
const SHEET_SPRING = { type: "spring" as const, stiffness: 380, damping: 39 };
const VIEW_FADE = { duration: 0.16, ease: "easeOut" as const };

/** Hur många tidigare turer som syns hopfällda ovanför det aktuella förslaget. */
const THREAD_ROWS = 2;

/** Snabbsvaren under tråden — max fyra, i den här ordningen. */
const QUICK_REPLIES: readonly PickQuickReply[] = ["seen", "shorter", "lighter", "similar"];

/** pendingScroll-värde: scrolla så att den aktuella turen börjar överst. */
const SCROLL_TO_CURRENT = -1;
/** pendingScroll-värde: längst ned (t.ex. medan ett följdsvar laddar). */
const SCROLL_TO_END = -2;

/** Scrollar tråden till den aktuella turen (data-pick-current) eller till slutet. */
function scrollThread(el: HTMLDivElement | null, to: "current" | "end", smooth: boolean) {
  if (!el) return;
  let top = el.scrollHeight;
  if (to === "current") {
    const anchor = el.querySelector<HTMLElement>("[data-pick-current]");
    if (!anchor) return;
    top = anchor.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 8;
  }
  el.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
}

/**
 * Sätter scrollytans position när en ny vy monteras (AnimatePresence
 * mode="wait" monterar den först när den gamla tonat ut). Används för att
 * historiklistan ska ligga kvar där man var när man går tillbaka från en session,
 * och för att tråden ska öppna på den aktuella turen.
 */
function ScrollRestore({
  target,
  pending,
}: {
  target: RefObject<HTMLDivElement | null>;
  pending: RefObject<number | null>;
}) {
  useLayoutEffect(() => {
    if (pending.current === null || !target.current) return;
    if (pending.current === SCROLL_TO_CURRENT) scrollThread(target.current, "current", false);
    else if (pending.current === SCROLL_TO_END) scrollThread(target.current, "end", false);
    else target.current.scrollTop = pending.current;
    pending.current = null;
  }, [pending, target]);
  return null;
}

type ViewportBox = { top: number; height: number; keyboard: boolean };

/**
 * Den visuella viewporten medan arket är öppet. På iOS krymper den när
 * tangentbordet visas (layout-viewporten gör det inte) — arket placeras i den
 * så att skrivraden hamnar ovanför tangentbordet. Zoom är låst i appen
 * (app/layout.tsx), så en mindre visuell viewport betyder tangentbord.
 */
function useViewportBox(active: boolean): ViewportBox | null {
  const [box, setBox] = useState<ViewportBox | null>(null);
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const keyboard = window.innerHeight - vv.height > 120;
        setBox((prev) =>
          prev && prev.top === vv.offsetTop && prev.height === vv.height && prev.keyboard === keyboard
            ? prev
            : { top: vv.offsetTop, height: vv.height, keyboard }
        );
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);
  return active ? box : null;
}

/* ---------- arket ---------- */

export default function PickSheet({
  open,
  onClose,
  initialQuota,
}: {
  open: boolean;
  onClose: () => void;
  initialQuota: PickQuota | null;
}) {
  const t = useTranslations("pick");
  const tu = useTranslations("upsell");
  const locale = useLocale();
  const router = useRouter();
  const { mediaFilter } = useSwipeSettings();
  const dragControls = useDragControls();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const native = isNativeIos();
  const history = usePickHistory();
  const resetHistory = history.reset;

  const [view, setView] = useState<View>("ask");
  const viewRef = useRef<View>("ask");
  const [quota, setQuota] = useState<PickQuota | null>(initialQuota);
  const [errorKind, setErrorKind] = useState<ErrorKind>("unavailable");
  const [text, setText] = useState("");
  // Skrivraden under tråden (följdfrågor)
  const [reply, setReply] = useState("");
  const replyRef = useRef<HTMLInputElement>(null);
  const [scrollTick, setScrollTick] = useState<{ to: "current" | "end"; n: number } | null>(null);
  const viewport = useViewportBox(open);

  // Tråden
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pendingAsk, setPendingAsk] = useState<AskEcho | null>(null);
  const [expandedTurn, setExpandedTurn] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(() => new Set());
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const savingRef = useRef(false);
  const [nudge, setNudge] = useState(false);

  // Historik
  const [detail, setDetail] = useState<PickHistorySession | null>(null);
  const historyReturn = useRef<View>("ask");
  const listScroll = useRef(0);
  const pendingScroll = useRef<number | null>(null);

  // Paywall
  const [adBusy, setAdBusy] = useState(false);
  const [adError, setAdError] = useState(false);
  const [unlocked, setUnlocked] = useState<number | null>(null);

  const [loadingStep, setLoadingStep] = useState(0);

  // Sessionstillstånd (nollställs vid varje öppning)
  const sessionId = useRef<string>("");
  const shownIds = useRef<number[]>([]);
  const lastQuery = useRef<Query | null>(null);
  const lastAsk = useRef<AskEcho>({ kind: "any" });
  const nudgeUsed = useRef(false);
  const requestSeq = useRef(0);
  const localTurnSeq = useRef(0);

  const go = useCallback((v: View) => {
    viewRef.current = v;
    setView(v);
  }, []);

  const goPaywall = useCallback(
    (q: PickQuota | null) => {
      go("paywall");
      setAdError(false);
      trackPickEvent("paywall_view", { premium: Boolean(q?.premium), native });
      if (!q?.premium) trackPickEvent("upsell_view", { from: "paywall" });
    },
    [go, native]
  );

  /* ----- öppning: ny konversation, välj startvy, hämta färsk kvot ----- */
  useEffect(() => {
    if (!open) return;
    requestSeq.current += 1;
    const seq = requestSeq.current;
    sessionId.current = newPickSessionId();
    shownIds.current = [];
    lastQuery.current = null;
    lastAsk.current = { kind: "any" };
    nudgeUsed.current = false;
    setTurns([]);
    setPendingAsk(null);
    setExpandedTurn(null);
    setDetail(null);
    resetHistory();
    setNudge(false);
    setUnlocked(null);
    setAdError(false);
    setText("");
    setReply("");
    setScrollTick(null);

    const q = initialQuota;
    setQuota(q);
    if (q && q.totalLeft <= 0) goPaywall(q);
    else go("ask");

    void getPickStatus({ fresh: true }).then((fresh) => {
      if (!fresh || seq !== requestSeq.current) return;
      setQuota(fresh);
      if (viewRef.current === "ask" && fresh.totalLeft <= 0) goPaywall(fresh);
      else if (viewRef.current === "paywall" && fresh.totalLeft > 0) go("ask");
    });
    // initialQuota läses bara vid öppningen — senare ändringar ägs av arket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* ----- scroll-lås, fokus, Esc ----- */
  const requestClose = useCallback(() => {
    trackPickEvent("close", { view: viewRef.current });
    requestSeq.current += 1; // svar som kommer efter stängning ignoreras
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => panelRef.current?.focus({ preventScroll: true }), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, requestClose]);

  /* ----- roterande statusrad under laddning ----- */
  useEffect(() => {
    if (view !== "loading") return;
    setLoadingStep(0);
    const id = window.setInterval(
      () => setLoadingStep((s) => Math.min(s + 1, LOADING_KEYS.length - 1)),
      LOADING_STEP_MS
    );
    return () => window.clearInterval(id);
  }, [view]);

  /* ----- förfrågan ----- */
  const run = useCallback(
    async (
      query: Query,
      ask: AskEcho,
      opts: { markSeen?: boolean; restoreText?: string } = {}
    ) => {
      if (quota && quota.totalLeft <= 0) {
        goPaywall(quota);
        return;
      }
      lastQuery.current = query;
      if (ask.kind !== "another") lastAsk.current = ask;
      requestSeq.current += 1;
      const seq = requestSeq.current;
      const followUp = turns.length > 0 ? turns[turns.length - 1] : null;
      setNudge(false);
      setUnlocked(null);
      setPendingAsk(ask);
      setExpandedTurn(null);
      // Följdfråga: tråden ligger kvar och bubblan + "skriver …" syns längst ned.
      pendingScroll.current = followUp ? SCROLL_TO_END : 0;
      if (followUp) setScrollTick((p) => ({ to: "end", n: (p?.n ?? 0) + 1 }));
      go("loading");

      const body: PickRequestBody = { mediaFilter: query.mediaFilter };
      if (query.prompt) body.prompt = query.prompt;
      if (query.chips?.length) body.chips = query.chips;
      if (shownIds.current.length) body.exclude = [...shownIds.current];
      if (sessionId.current) body.sessionId = sessionId.current;
      if (followUp) {
        // Servern läser sessionens turer själv; det här säger bara vilken tur
        // och vilken titel ("den") meddelandet syftar på.
        if (!followUp.id.startsWith("local-")) body.followUpOf = followUp.id;
        body.focus = { tmdbId: followUp.main.tmdbId, mediaType: followUp.main.mediaType };
        if (opts.markSeen) body.markSeen = true;
      }

      const res = await requestPick(body);
      if (seq !== requestSeq.current) return;
      if (res.quota) setQuota(res.quota);

      if (res.ok) {
        const ids = [res.pick, ...res.alternatives].map((x) => x.tmdbId);
        shownIds.current = Array.from(new Set([...shownIds.current, ...ids]));
        localTurnSeq.current += 1;
        const turn: Turn = {
          id: res.requestId || `local-${localTurnSeq.current}`,
          ask,
          pick: res.pick,
          main: res.pick,
          alts: res.alternatives.slice(0, 2),
          reason: res.reason,
        };
        setTurns((prev) => [...prev, turn]);
        setPendingAsk(null);
        // Premium-nudge: en gång per arksession, aldrig för premium.
        if (!res.quota.premium && !nudgeUsed.current) {
          nudgeUsed.current = true;
          setNudge(true);
          trackPickEvent("upsell_view", { from: "result" });
        }
        pendingScroll.current = SCROLL_TO_CURRENT;
        setScrollTick((p) => ({ to: "current", n: (p?.n ?? 0) + 1 }));
        go("result");
        return;
      }

      setPendingAsk(null);
      // Texten användaren skrev ska inte försvinna för att svaret uteblev.
      if (opts.restoreText) {
        const restore = opts.restoreText;
        setReply((r) => r || restore);
      }
      switch (res.error) {
        case "no_quota":
          goPaywall(res.quota ?? quota);
          return;
        case "no_candidates":
          setErrorKind("no_candidates");
          break;
        case "disabled":
          setErrorKind("disabled");
          break;
        default:
          setErrorKind("unavailable");
      }
      go("error");
    },
    [go, goPaywall, quota, turns]
  );

  /* ----- scroll i tråden när en tur kommer/laddar (vyn monteras inte om) ----- */
  useEffect(() => {
    if (!scrollTick) return;
    const id = window.requestAnimationFrame(() => scrollThread(scrollRef.current, scrollTick.to, true));
    return () => window.cancelAnimationFrame(id);
  }, [scrollTick]);

  const current = turns.length > 0 ? turns[turns.length - 1] : null;

  const onChip = (id: PickChipId) => {
    trackPickEvent("chip", { chip: id });
    void run({ chips: [id], mediaFilter }, { kind: "chips", ids: [id] });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const prompt = text.trim().slice(0, 300);
    if (!prompt) return;
    trackPickEvent("submit", { len: prompt.length, followUp: turns.length > 0 });
    void run({ prompt, mediaFilter }, { kind: "prompt", text: prompt });
  };

  /** Tillbaka från paywall/fel: till tråden (längst ned) om det finns en, annars frågan. */
  const backToThread = () => {
    pendingScroll.current = current ? SCROLL_TO_END : 0;
    go(current ? "result" : "ask");
  };

  /** Filtret följdfrågor skickas med: konversationens, annars swipens. */
  const followFilter = () => lastQuery.current?.mediaFilter ?? mediaFilter;

  // "Visa något annat" = en följdfråga utan text — servern tar önskemålen ur
  // samtalet och utesluter allt som redan visats.
  const onAnother = () => {
    trackPickEvent("another", current ? { tmdbId: current.main.tmdbId } : undefined);
    void run({ mediaFilter: followFilter() }, { kind: "another" });
  };

  /** Skrivraden eller ett snabbsvar. */
  const sendFollowUp = (raw: string, quick?: PickQuickReply) => {
    const prompt = raw.trim().slice(0, 300);
    if (!prompt || viewRef.current === "loading") return;
    if (quota && quota.totalLeft <= 0) {
      goPaywall(quota); // texten ligger kvar i skrivraden
      return;
    }
    trackPickEvent("followup", quick ? { quick } : { len: prompt.length });
    if (!quick) setReply("");
    // Fäll ned tangentbordet så att svaret syns i hela arket.
    replyRef.current?.blur();
    void run(
      { prompt, mediaFilter: followFilter() },
      { kind: "prompt", text: prompt },
      { markSeen: quick === "seen", restoreText: quick ? undefined : prompt }
    );
  };

  const onReplySubmit = (e: FormEvent) => {
    e.preventDefault();
    sendFollowUp(reply);
  };

  const onReplyFocus = () => {
    // När tangentbordet är uppe: håll slutet av tråden (kortet man svarar på)
    // precis ovanför skrivraden. scrollIntoView är reserven utan visualViewport.
    window.setTimeout(() => {
      scrollThread(scrollRef.current, "end", true);
      replyRef.current?.scrollIntoView({ block: "nearest" });
    }, 280);
  };

  const onReplyBlur = () => {
    // iOS kan lämna layout-viewporten förskjuten efter tangentbordet trots
    // overflow:hidden på body — återställ (sidan bakom ska aldrig scrolla här).
    window.setTimeout(() => {
      if (window.scrollY !== 0 && !document.activeElement?.closest("input,textarea")) window.scrollTo(0, 0);
    }, 120);
  };

  /** Byt in ett alternativ i en tur (aktuell eller uppfälld äldre). */
  const swapInTurn = (turnId: string, alt: PickItem) => {
    trackPickEvent("alt_select", { tmdbId: alt.tmdbId, fromSaved: alt.fromSaved });
    setTurns((list) =>
      list.map((tn) =>
        tn.id !== turnId
          ? tn
          : {
              ...tn,
              main: alt,
              alts: tn.alts.map((a) => (itemKey(a) === itemKey(alt) ? tn.main : a)),
            }
      )
    );
  };

  const isSaved = useCallback(
    (item: PickItem) => item.inWatchlist || savedKeys.has(itemKey(item)),
    [savedKeys]
  );

  const saveItem = useCallback(
    async (item: PickItem, from: "thread" | "history") => {
      const key = itemKey(item);
      if (savingRef.current) return;
      savingRef.current = true;
      setSavingKey(key);
      try {
        const res = await fetch("/api/watchlist/like", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            tmdbId: item.tmdbId,
            mediaType: item.mediaType,
            title: item.title,
            year: item.year ? String(item.year) : null,
            poster: item.poster,
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setSavedKeys((s) => new Set(s).add(key));
        trackPickEvent("save", { tmdbId: item.tmdbId, fromSaved: item.fromSaved, from });
        notify(t("savedToast"));
      } catch {
        notify(t("saveFailed"));
      } finally {
        savingRef.current = false;
        setSavingKey(null);
      }
    },
    [t]
  );

  const openService = (item: PickItem, provider: string, from: "thread" | "history") =>
    trackPickEvent("open_service", { tmdbId: item.tmdbId, provider, fromSaved: item.fromSaved, from });

  /* ----- detaljarket (dela/spara/betygsätt) — kostar aldrig ett val ----- */
  const [detailItem, setDetailItem] = useState<{ item: PickItem; from: PickDetailFrom } | null>(null);
  const openDetail = (item: PickItem, from: PickDetailFrom) => {
    trackPickEvent("detail_open", { tmdbId: item.tmdbId, fromSaved: item.fromSaved, from });
    setDetailItem({ item, from });
  };
  const closeDetail = useCallback(() => setDetailItem(null), []);

  /* ----- historik ----- */
  const openHistory = () => {
    const v = viewRef.current;
    if (v !== "history" && v !== "historyDetail") historyReturn.current = v;
    pendingScroll.current = 0;
    trackPickEvent("history_open", { from: v, turns: turns.length });
    go("history");
    void history.load();
  };

  const openSession = (s: PickHistorySession) => {
    listScroll.current = scrollRef.current?.scrollTop ?? 0;
    pendingScroll.current = 0;
    setDetail(s);
    trackPickEvent("history_entry_open", { entries: s.entries.length });
    go("historyDetail");
  };

  /**
   * "Fortsätt chatten": lägg sessionens turer i tråden och återanvänd dess
   * sessionId — servern läser samma turer och utesluter allt som visats, så
   * nästa meddelande fortsätter samtalet. Kostar inget förrän man skickar.
   */
  const continueSession = (s: PickHistorySession) => {
    if (s.entries.length === 0 || !/^[A-Za-z0-9_-]{1,64}$/.test(s.sessionId)) return;
    trackPickEvent("history_continue", { entries: s.entries.length });
    requestSeq.current += 1;
    sessionId.current = s.sessionId;
    const restored: Turn[] = s.entries.map((e, i) => ({
      id: e.requestId,
      ask: entryAsk(e, s.entries[i - 1]),
      pick: e.pick,
      main: e.pick,
      alts: e.alternatives.slice(0, 2),
      reason: e.reason,
    }));
    shownIds.current = Array.from(
      new Set(s.entries.flatMap((e) => [e.pick, ...e.alternatives].map((x) => x.tmdbId)))
    );
    const last = s.entries[s.entries.length - 1];
    lastQuery.current = { mediaFilter: last.mediaFilter };
    lastAsk.current = restored[restored.length - 1].ask;
    setTurns(restored);
    setPendingAsk(null);
    setExpandedTurn(null);
    setDetail(null);
    setReply("");
    setUnlocked(null);
    historyReturn.current = "result";
    pendingScroll.current = SCROLL_TO_CURRENT;
    go("result");
  };

  const onBack = () => {
    if (viewRef.current === "historyDetail") {
      pendingScroll.current = listScroll.current;
      go("history");
      return;
    }
    pendingScroll.current = historyReturn.current === "result" ? SCROLL_TO_CURRENT : 0;
    go(historyReturn.current);
  };

  /* ----- belöning / premium ----- */
  const onWatchAd = async () => {
    if (adBusy) return;
    setAdBusy(true);
    setAdError(false);
    trackPickEvent("ad_start", { premium: Boolean(quota?.premium) });
    const ok = await watchRewardedForPicks();
    const fresh = await getPickStatus({ fresh: true });
    if (fresh) setQuota(fresh);
    setAdBusy(false);
    if (ok) {
      trackPickEvent("ad_complete", { premium: Boolean(quota?.premium) });
      setUnlocked(fresh?.rewardPicks ?? quota?.rewardPicks ?? 3);
      // Mitt i en konversation: tillbaka till tråden (skrivraden står kvar).
      pendingScroll.current = current ? SCROLL_TO_END : 0;
      go(current ? "result" : "ask");
    } else {
      trackPickEvent("ad_fail", { premium: Boolean(quota?.premium) });
      setAdError(true);
    }
  };

  const [buying, setBuying] = useState(false);
  const onPremium = (from: "paywall" | "result") => {
    trackPickEvent("upsell_click", { from });
    if (native) {
      // Nudgen → paywall-vyn (där står pris/förnyelse-texten), aldrig köp direkt.
      if (from === "result") {
        goPaywall(quota);
        return;
      }
      if (buying) return;
      setBuying(true);
      // Apple IAP i appen. Lyckat köp → /premium/success; avbrutet → kvar här.
      void goPremium().finally(() => {
        setBuying(false);
        void getPickStatus({ fresh: true }).then((q) => q && setQuota(q));
      });
      return;
    }
    onClose();
    router.push("/premium");
  };

  /* ---------- rendering ---------- */

  if (typeof document === "undefined") return null;

  const premium = Boolean(quota?.premium);
  const monthly = quota?.premiumMonthly ?? 20;
  const rewardPicks = quota?.rewardPicks ?? 3;
  const showQuotaLine = quota !== null && quota.totalLeft <= 1;
  const inHistory = view === "history" || view === "historyDetail";

  const quotaLine = showQuotaLine ? (
    <p className="text-center text-xs text-white/45">{t("quotaLeft", { count: Math.max(0, quota.totalLeft) })}</p>
  ) : null;

  /** Tidigare turer som hopfällda rader; ett tryck fäller ut kortet på plats. */
  const threadRows = (list: Turn[]) =>
    list.length === 0 ? null : (
      <ul className="space-y-1.5" aria-label={t("thread.aria")}>
        {list.map((tn) => {
          const expanded = expandedTurn === tn.id;
          const panelId = `pick-turn-${tn.id}`;
          return (
            <li key={tn.id} className="rounded-xl bg-white/[0.03] ring-1 ring-white/[0.06]">
              <button
                type="button"
                onClick={() => setExpandedTurn(expanded ? null : tn.id)}
                aria-expanded={expanded}
                aria-controls={panelId}
                className={`flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left ${focusRing}`}
              >
                <Poster
                  src={tn.main.poster}
                  title={tn.main.title}
                  tiny
                  sizes="32px"
                  className="aspect-[2/3] w-5 rounded-[4px]"
                />
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  <span className="text-white/40">{t("thread.previous")}</span>{" "}
                  <span className="font-medium text-white/75">{tn.main.title}</span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-white/35 transition-transform ${expanded ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
              {expanded ? (
                <div id={panelId} className="space-y-2.5 px-3 pb-3 pt-1">
                  <AskBubble text={askText(tn.ask, t)} lines={3} />
                  <PickCard
                    key={itemKey(tn.main)}
                    size="compact"
                    main={tn.main}
                    pickKey={itemKey(tn.pick)}
                    reason={tn.reason}
                    alts={tn.alts}
                    onAltSelect={(alt) => swapInTurn(tn.id, alt)}
                    saved={isSaved(tn.main)}
                    saving={savingKey === itemKey(tn.main)}
                    onSave={(it) => void saveItem(it, "thread")}
                    onOpenService={(it, p) => openService(it, p, "thread")}
                    onOpenDetail={(it) => openDetail(it, "thread")}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    );

  // Första frågan. När tråden har turer används skrivraden i stället.
  const askView = (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-white/55">{t("subtitle")}</p>

      {unlocked !== null ? (
        <p role="status" className="rounded-xl bg-white/[0.06] px-3 py-2 text-sm text-white/85">
          {t("paywall.unlocked", { count: unlocked })}
        </p>
      ) : null}

      <div role="group" aria-label={t("chipsAria")} className="grid grid-cols-2 gap-2">
        {CHIPS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChip(id)}
            className={`flex min-h-12 items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm font-medium text-white/85 transition hover:border-white/20 hover:bg-white/[0.08] active:scale-[0.98] ${focusRing}`}
          >
            <Icon className="h-4 w-4 shrink-0 text-white/50" aria-hidden />
            {t(`chips.${id}`)}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          enterKeyHint="send"
          placeholder={t("inputPlaceholder")}
          aria-label={t("inputAria")}
          className="h-12 min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-white placeholder:text-white/35 focus:border-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label={t("send")}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cyan-400 text-neutral-950 transition hover:bg-cyan-300 active:scale-95 disabled:bg-white/10 disabled:text-white/35 disabled:active:scale-100 ${focusRing}`}
        >
          <ArrowUp className="h-5 w-5" strokeWidth={2.5} aria-hidden />
        </button>
      </form>

      {/* Välkomstval för nya konton: säg det rakt ut, så att första
          försöket känns gratis i stället för som en kostnad. Vid ≤1 kvar tar
          den vanliga kvotraden över. */}
      {quota && !premium && quota.welcomeLeft > 1 && quota.totalLeft > 1 ? (
        <p className="text-center text-xs text-white/55">{t("welcomeLeft", { count: quota.welcomeLeft })}</p>
      ) : null}
      {quota && quota.totalLeft > 0 ? quotaLine : null}
    </div>
  );

  const loadingView = (
    <div aria-busy="true" aria-label={t("loadingAria")} className="space-y-3">
      {threadRows(turns.slice(-THREAD_ROWS))}
      {pendingAsk ? <AskBubble text={askText(pendingAsk, t)} /> : null}
      <div className="flex gap-4">
        <Pulse className="aspect-[2/3] w-[92px] shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2.5 pt-1">
          <Pulse className="h-4 w-28 rounded-full" />
          <Pulse className="h-6 w-4/5" />
          <Pulse className="h-3.5 w-3/5" />
          <div className="flex gap-1.5 pt-1">
            <Pulse className="h-7 w-7" />
            <Pulse className="h-7 w-7" />
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <Pulse className="h-3.5 w-full" />
        <Pulse className="h-3.5 w-11/12" />
      </div>
      <Pulse className="h-12 w-full rounded-2xl" />
      <div className="flex h-5 items-center justify-center gap-2 text-sm text-white/55" aria-live="polite">
        <Sparkles className="h-3.5 w-3.5 text-white/40" aria-hidden />
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={loadingStep}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={VIEW_FADE}
          >
            {t(`loading.${LOADING_KEYS[loadingStep]}`)}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );

  const unlockedLine =
    unlocked !== null ? (
      <p role="status" className="rounded-xl bg-white/[0.06] px-3 py-2 text-sm text-white/85">
        {t("paywall.unlocked", { count: unlocked })}
      </p>
    ) : null;

  // Tråden: hopfällda tidigare turer → (aktuell tur | bubbla + "skriver …").
  // Samma vy (nyckel "thread") under laddning och svar, så att inget monteras
  // om mellan en följdfråga och dess svar.
  const following = view === "loading" && pendingAsk !== null;
  const threadView = (
    <div className="space-y-3">
      {following ? threadRows(turns.slice(-THREAD_ROWS)) : threadRows(turns.slice(-(THREAD_ROWS + 1), -1))}

      {following && pendingAsk ? (
        <div className="space-y-3" aria-busy="true">
          <AskBubble text={askText(pendingAsk, t)} lines={3} />
          <TypingReply label={t("followUp.typingAria")} />
          <div className="flex gap-3">
            <Pulse className="aspect-[2/3] w-16 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2 pt-1">
              <Pulse className="h-5 w-3/4" />
              <Pulse className="h-3.5 w-1/2" />
              <Pulse className="mt-3 h-11 w-full rounded-2xl" />
            </div>
          </div>
        </div>
      ) : current ? (
        <div data-pick-current className="space-y-3">
          <AskBubble text={askText(current.ask, t)} lines={3} />
          <AiReply text={current.reason} />
          <PickCard
            size="full"
            titleId="pick-result-title"
            main={current.main}
            pickKey={itemKey(current.pick)}
            reason={current.reason}
            reasonInline={false}
            alts={current.alts}
            onAltSelect={(alt) => swapInTurn(current.id, alt)}
            saved={isSaved(current.main)}
            saving={savingKey === itemKey(current.main)}
            onSave={(it) => void saveItem(it, "thread")}
            onOpenService={(it, p) => openService(it, p, "thread")}
            onOpenDetail={(it) => openDetail(it, "thread")}
          />

          <button
            type="button"
            onClick={onAnother}
            className={`mx-auto flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-white/60 transition hover:text-white ${focusRing}`}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t("another")}
          </button>

          {quotaLine}

          {nudge && !premium ? (
            <button
              type="button"
              onClick={() => onPremium("result")}
              className={`mx-auto flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-center text-xs text-white/45 transition hover:text-white/75 ${focusRing}`}
            >
              <Crown className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("premiumNudge", { count: monthly })}
            </button>
          ) : null}
        </div>
      ) : null}

      {unlockedLine}
    </div>
  );

  // Skrivraden + snabbsvaren, fast längst ned i arket så länge tråden visas.
  const loadingReply = view === "loading";
  const composer = (
    <div
      className="shrink-0 border-t border-white/[0.06] px-4 pt-2"
      style={{
        paddingBottom: viewport?.keyboard ? 8 : "calc(env(safe-area-inset-bottom) + 10px)",
      }}
    >
      <div
        role="group"
        aria-label={t("followUp.quickAria")}
        className="-mx-4 mb-2 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {QUICK_REPLIES.map((q) => (
          <button
            key={q}
            type="button"
            disabled={loadingReply}
            onClick={() => sendFollowUp(t(`followUp.quick.${q}`), q)}
            className={`min-h-10 shrink-0 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.03] px-3.5 text-[13px] font-medium text-white/65 transition hover:bg-white/[0.07] hover:text-white/85 active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100 ${focusRing}`}
          >
            {t(`followUp.quick.${q}`)}
          </button>
        ))}
      </div>
      <form onSubmit={onReplySubmit} className="flex items-center gap-2">
        <input
          ref={replyRef}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onFocus={onReplyFocus}
          onBlur={onReplyBlur}
          maxLength={300}
          enterKeyHint="send"
          autoComplete="off"
          placeholder={t("followUp.placeholder")}
          aria-label={t("followUp.aria")}
          className="h-11 min-w-0 flex-1 text-ellipsis rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-white placeholder:text-white/35 focus:border-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
        />
        <button
          type="submit"
          disabled={!reply.trim() || loadingReply}
          aria-label={t("send")}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-400 text-neutral-950 transition hover:bg-cyan-300 active:scale-95 disabled:bg-white/10 disabled:text-white/35 disabled:active:scale-100 ${focusRing}`}
        >
          <ArrowUp className="h-5 w-5" strokeWidth={2.5} aria-hidden />
        </button>
      </form>
    </div>
  );

  const canAd = native;
  const rewardsLeft = quota?.rewardsLeftToday ?? 1;
  const paywallView = (
    <div className="space-y-4 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-400/20">
        <Sparkles className="h-7 w-7" aria-hidden />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-white">{t("paywall.title")}</h3>
        <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-white/60">
          {premium ? t("paywall.bodyPremiumUsed", { count: monthly }) : t("paywall.bodyFree")}
        </p>
      </div>

      <div className="space-y-2.5">
        {canAd && rewardsLeft > 0 ? (
          <button
            type="button"
            onClick={() => void onWatchAd()}
            disabled={adBusy}
            className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-4 text-[15px] font-semibold text-neutral-950 transition hover:bg-cyan-300 active:scale-[0.98] disabled:opacity-60 ${focusRing}`}
          >
            <PlayCircle className="h-5 w-5" aria-hidden />
            {adBusy ? t("paywall.watchAdBusy") : t("paywall.watchAd", { count: rewardPicks })}
          </button>
        ) : null}

        {canAd && rewardsLeft <= 0 ? (
          <p className="rounded-xl bg-white/[0.05] px-3 py-2.5 text-sm text-white/60">{t("paywall.rewardLimit")}</p>
        ) : null}

        {adError && !(canAd && rewardsLeft <= 0) ? (
          <p role="alert" className="text-sm text-rose-300">
            {t("paywall.adFailed")}
          </p>
        ) : null}

        {!premium ? (
          <button
            type="button"
            onClick={() => onPremium("paywall")}
            className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold transition active:scale-[0.98] ${focusRing} ${
              canAd
                ? "border border-white/15 bg-white/5 text-white hover:bg-white/10"
                : "bg-cyan-400 text-neutral-950 hover:bg-cyan-300"
            }`}
          >
            <Crown className="h-4 w-4 shrink-0" aria-hidden />
            <span>{buying ? tu("opening") : t("paywall.premiumCta", { count: monthly })}</span>
          </button>
        ) : (
          <p className="text-xs text-white/45">{t("paywall.resetNote")}</p>
        )}
        {/* Pris, period och automatisk förnyelse vid köptillfället (3.1.2c). */}
        {!premium && native ? (
          <p className="text-[11px] leading-relaxed text-white/35">{tu("legal")}</p>
        ) : null}

        {/* Kvoten tog slut mitt i en konversation → låt användaren gå tillbaka
            till förslaget hen redan fått. */}
        {current ? (
          <button
            type="button"
            onClick={backToThread}
            className={`mx-auto flex min-h-11 items-center rounded-xl px-3 text-sm text-white/55 transition hover:text-white ${focusRing}`}
          >
            {t("error.back")}
          </button>
        ) : null}
      </div>
    </div>
  );

  const errorView = (
    <div className="space-y-4 text-center">
      {errorKind === "no_candidates" ? (
        <>
          <div>
            <h3 className="text-lg font-semibold text-white">{t("error.noCandidatesTitle")}</h3>
            <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-white/60">
              {t("error.noCandidatesBody")}
            </p>
          </div>
          <div className="space-y-2">
            {lastQuery.current && lastQuery.current.mediaFilter !== "both" ? (
              <button
                type="button"
                onClick={() => void run({ ...lastQuery.current!, mediaFilter: "both" }, lastAsk.current)}
                className={`flex min-h-12 w-full items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 ${focusRing}`}
              >
                {t("error.tryBoth")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                onClose();
                router.push("/profile");
              }}
              className={`flex min-h-12 w-full items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 ${focusRing}`}
            >
              {t("error.editServices")}
            </button>
            <button
              type="button"
              onClick={backToThread}
              className={`mx-auto flex min-h-11 items-center rounded-xl px-3 text-sm text-white/55 transition hover:text-white ${focusRing}`}
            >
              {t("error.back")}
            </button>
          </div>
        </>
      ) : (
        <>
          <div>
            <h3 className="text-lg font-semibold text-white">{t("error.unavailableTitle")}</h3>
            <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-white/60">
              {errorKind === "disabled" ? t("error.disabledBody") : t("error.unavailableBody")}
            </p>
          </div>
          <div className="space-y-2">
            {errorKind === "unavailable" ? (
              <button
                type="button"
                onClick={backToThread}
                className={`flex min-h-12 w-full items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 ${focusRing}`}
              >
                {t("error.retry")}
              </button>
            ) : null}
            {current ? (
              <button
                type="button"
                onClick={backToThread}
                className={`mx-auto flex min-h-11 items-center rounded-xl px-3 text-sm text-white/55 transition hover:text-white ${focusRing}`}
              >
                {t("error.back")}
              </button>
            ) : (
              <button
                type="button"
                onClick={requestClose}
                className={`mx-auto flex min-h-11 items-center rounded-xl px-3 text-sm text-white/55 transition hover:text-white ${focusRing}`}
              >
                {t("close")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );

  const historyView = <HistoryList history={history} onOpen={openSession} scrollRoot={scrollRef} />;

  const detailView = detail ? (
    <HistoryDetail
      session={detail}
      isSaved={isSaved}
      savingKey={savingKey}
      onSave={(it) => void saveItem(it, "history")}
      onOpenService={(it, p) => openService(it, p, "history")}
      onAltSelect={(alt) => trackPickEvent("alt_select", { tmdbId: alt.tmdbId, fromSaved: alt.fromSaved, from: "history" })}
      onOpenDetail={(it) => openDetail(it, "history")}
      onContinue={/^[A-Za-z0-9_-]{1,64}$/.test(detail.sessionId) ? () => continueSession(detail) : undefined}
    />
  ) : (
    historyView
  );

  // Tråden (laddning + svar) när det finns turer; första frågans laddning har
  // sin egen vy med statusraderna.
  const inThread = (view === "loading" || view === "result") && turns.length > 0;

  const body = inThread
    ? threadView
    : view === "ask"
      ? askView
      : view === "loading"
        ? loadingView
        : view === "paywall"
          ? paywallView
          : view === "history"
            ? historyView
            : view === "historyDetail"
              ? detailView
              : view === "result"
                ? threadView
                : errorView;

  const viewKey = inThread
    ? "thread"
    : view === "historyDetail" && detail
      ? `detail-${detail.sessionId}`
      : view;

  const headerTitle =
    view === "history"
      ? t("history.title")
      : view === "historyDetail" && detail
        ? sessionLabel(detail.lastAt, locale, t)
        : t("title");

  const detailOpenItem = open ? (detailItem?.item ?? null) : null;
  const detailSheet = (
    <PickDetailSheet
      item={detailOpenItem}
      from={detailItem?.from ?? "thread"}
      onClose={closeDetail}
      saved={detailOpenItem ? isSaved(detailOpenItem) : false}
      saving={detailOpenItem ? savingKey === itemKey(detailOpenItem) : false}
      onSave={(it) => void saveItem(it, detailItem?.from ?? "thread")}
      onOpenService={(it, p) => openService(it, p, detailItem?.from ?? "thread")}
    />
  );

  const sheetPortal = createPortal(
    <AnimatePresence>
      {open ? (
        <div
          key="pick-sheet"
          data-blocking-sheet
          className="fixed inset-0 z-[65] flex items-end justify-center"
          // Följ den visuella viewporten (tangentbordet på iOS), se useViewportBox.
          style={viewport ? { top: viewport.top, height: viewport.height, bottom: "auto" } : undefined}
        >
          <motion.button
            type="button"
            tabIndex={-1}
            aria-label={t("close")}
            onClick={requestClose}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pick-sheet-title"
            tabIndex={-1}
            className={`relative flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-[28px] border-t border-white/10 bg-neutral-900 shadow-[0_-18px_60px_rgba(0,0,0,0.6)] outline-none ${
              inThread ? "h-[88dvh]" : ""
            }`}
            // Med tangentbordet uppe: arket får hela den synliga höjden (minus
            // en liten glipa) i stället för 88dvh, som på iOS inte krymper.
            style={
              viewport?.keyboard
                ? { maxHeight: viewport.height - 8, ...(inThread ? { height: viewport.height - 8 } : null) }
                : undefined
            }
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={SHEET_SPRING}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 600) requestClose();
            }}
          >
            {/* Draghandtag + rubrik: hela den här ytan drar arket (innehållet
                nedanför scrollar fritt och tar inte drag-gesten). */}
            <div
              className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div className="flex justify-center pb-1 pt-2.5">
                <span className="h-1 w-9 rounded-full bg-white/20" />
              </div>
              <div className="flex items-center gap-1 px-5 pb-2">
                {inHistory ? (
                  <button
                    type="button"
                    onClick={onBack}
                    onPointerDown={(e) => e.stopPropagation()}
                    aria-label={t("history.back")}
                    className={`-ml-2.5 flex h-11 w-11 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white ${focusRing}`}
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden />
                  </button>
                ) : (
                  <Sparkles className="mr-1 h-5 w-5 text-cyan-300" aria-hidden />
                )}
                <h2 id="pick-sheet-title" className="min-w-0 flex-1 truncate text-[17px] font-semibold text-white">
                  {headerTitle}
                </h2>
                {!inHistory && view !== "loading" ? (
                  <button
                    type="button"
                    onClick={openHistory}
                    onPointerDown={(e) => e.stopPropagation()}
                    aria-label={t("history.open")}
                    title={t("history.open")}
                    className={`flex h-11 w-11 items-center justify-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white ${focusRing}`}
                  >
                    <HistoryIcon className="h-5 w-5" aria-hidden />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={requestClose}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label={t("close")}
                  className={`-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white ${focusRing}`}
                >
                  <X className="h-5 w-5" aria-hidden />
                </button>
              </div>
            </div>

            <div
              ref={scrollRef}
              className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-1 ${
                inThread ? "pb-4" : "pb-[calc(env(safe-area-inset-bottom)+20px)]"
              }`}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={viewKey}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={VIEW_FADE}
                >
                  <ScrollRestore target={scrollRef} pending={pendingScroll} />
                  {body}
                </motion.div>
              </AnimatePresence>
            </div>

            {inThread ? composer : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );

  return (
    <>
      {sheetPortal}
      {detailSheet}
    </>
  );
}
