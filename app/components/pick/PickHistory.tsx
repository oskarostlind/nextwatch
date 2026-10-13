"use client";

// "Välj åt mig" — historiken ("Dina val"). En session = ett öppnat ark, dvs.
// en "konversation": första frågan plus varje "Visa något annat"/ny fråga.
//
// Listan och detaljvyn renderas i PickSheet:s scrollyta; tillståndet ligger i
// usePickHistory() som arket äger, så att listan (och scrollpositionen) finns
// kvar när man går in i en session och tillbaka.
//
// Allt här är läsning: att öppna tjänsten eller spara i listan kostar aldrig
// ett val. "Fortsätt chatten" i en session öppnar den i den levande tråden
// (samma sessionId) — först nästa meddelande kostar ett val. "Rensa historik" tömmer bara det som visas — kvoten räknas på
// status/källa/tid och påverkas inte (se DELETE /api/pick/history).

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { History as HistoryIcon, Loader2, MessageCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { PickHistoryEntry, PickHistorySession, PickItem } from "@/lib/aiPick/types";
import { clearPickHistory, getPickHistory } from "@/lib/aiPick/client";
import {
  AskBubble,
  askText,
  daysSince,
  focusRing,
  itemKey,
  PickCard,
  Poster,
  Pulse,
  type AskEcho,
  type T,
} from "@/app/components/pick/PickParts";

/* ---------- datum ---------- */

const INTL_LOCALE: Record<string, string> = { sv: "sv-SE", en: "en-GB" };

/** "Idag 21:14" / "Igår 21:14" / "Mån 12 okt" (+ år om det inte är i år). */
export function sessionLabel(iso: string, locale: string, t: T): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const loc = INTL_LOCALE[locale] ?? locale;
  const time = d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
  const days = daysSince(iso);
  if (days === 0) return t("history.today", { time });
  if (days === 1) return t("history.yesterday", { time });
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  const s = new Intl.DateTimeFormat(loc, opts).format(d).replace(/\./g, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ---------- tillstånd ---------- */

type HistoryData = {
  sessions: PickHistorySession[] | null; // null = inte hämtad än
  status: "idle" | "loading" | "ready" | "error";
  nextBefore: string | null;
  loadingMore: boolean;
};

const INITIAL: HistoryData = { sessions: null, status: "idle", nextBefore: null, loadingMore: false };

/** Slår ihop en ny sida med det vi har (en session kan i teorin delas av sidgränsen). */
function mergeSessions(a: PickHistorySession[], b: PickHistorySession[]): PickHistorySession[] {
  const out = a.map((s) => ({ ...s, entries: [...s.entries] }));
  const idx = new Map(out.map((s, i) => [s.sessionId, i]));
  for (const s of b) {
    const i = idx.get(s.sessionId);
    if (i === undefined) {
      idx.set(s.sessionId, out.length);
      out.push(s);
      continue;
    }
    const cur = out[i];
    const seen = new Set(cur.entries.map((e) => e.requestId));
    const entries = [...cur.entries, ...s.entries.filter((e) => !seen.has(e.requestId))].sort(
      (x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt)
    );
    out[i] = {
      ...cur,
      entries,
      startedAt: entries[0]?.createdAt ?? cur.startedAt,
      lastAt: entries[entries.length - 1]?.createdAt ?? cur.lastAt,
    };
  }
  return out;
}

export type PickHistoryState = HistoryData & {
  load: () => Promise<void>;
  loadMore: () => Promise<void>;
  clear: () => Promise<boolean>;
  reset: () => void;
};

export function usePickHistory(): PickHistoryState {
  const [data, setData] = useState<HistoryData>(INITIAL);
  const dataRef = useRef<HistoryData>(INITIAL);
  const seq = useRef(0);

  const commit = useCallback((next: HistoryData) => {
    dataRef.current = next;
    setData(next);
  }, []);

  /** Första sidan. Redan hämtad lista ligger kvar medan den uppdateras. */
  const load = useCallback(async () => {
    const s = ++seq.current;
    const cur = dataRef.current;
    commit({ ...cur, status: cur.sessions ? "ready" : "loading", loadingMore: false });
    const res = await getPickHistory(null);
    if (s !== seq.current) return;
    if (!res.ok) {
      const now = dataRef.current;
      commit({ ...now, status: now.sessions ? "ready" : "error" });
      return;
    }
    commit({ sessions: res.sessions, nextBefore: res.nextBefore, status: "ready", loadingMore: false });
  }, [commit]);

  const loadMore = useCallback(async () => {
    const cur = dataRef.current;
    if (cur.loadingMore || !cur.nextBefore || !cur.sessions) return;
    const s = seq.current;
    commit({ ...cur, loadingMore: true });
    const res = await getPickHistory(cur.nextBefore);
    if (s !== seq.current) return;
    const now = dataRef.current;
    if (!res.ok) {
      commit({ ...now, loadingMore: false });
      return;
    }
    commit({
      ...now,
      sessions: mergeSessions(now.sessions ?? [], res.sessions),
      nextBefore: res.nextBefore,
      loadingMore: false,
    });
  }, [commit]);

  const clear = useCallback(async () => {
    const ok = await clearPickHistory();
    if (ok) {
      seq.current += 1;
      commit({ sessions: [], nextBefore: null, status: "ready", loadingMore: false });
    }
    return ok;
  }, [commit]);

  const reset = useCallback(() => {
    seq.current += 1;
    commit(INITIAL);
  }, [commit]);

  return { ...data, load, loadMore, clear, reset };
}

/* ---------- hjälpare ---------- */

export function entryAsk(entry: PickHistoryEntry, prev: PickHistoryEntry | undefined): AskEcho {
  // Följdfråga utan text = "Visa något annat" (sedan följdfrågorna skickas den
  // tom; servern tolkar den i samtalets sammanhang).
  if (prev && !entry.prompt && entry.chips.length === 0) return { kind: "another" };
  // Äldre rader: samma fråga som turen innan = "Visa något annat".
  if (
    prev &&
    (prev.prompt ?? "") === (entry.prompt ?? "") &&
    prev.chips.join(",") === entry.chips.join(",") &&
    prev.mediaFilter === entry.mediaFilter
  ) {
    return { kind: "another" };
  }
  if (entry.prompt) return { kind: "prompt", text: entry.prompt };
  if (entry.chips.length) return { kind: "chips", ids: entry.chips };
  return { kind: "any" };
}

function sessionPosters(session: PickHistorySession): PickItem[] {
  const seen = new Set<string>();
  const out: PickItem[] = [];
  for (const e of session.entries) {
    const k = itemKey(e.pick);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e.pick);
  }
  return out.slice(-3);
}

/* ---------- listan ---------- */

export function HistoryList({
  history,
  onOpen,
  scrollRoot,
}: {
  history: PickHistoryState;
  onOpen: (session: PickHistorySession) => void;
  scrollRoot: RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations("pick");
  const locale = useLocale();
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const { sessions, status, nextBefore, loadingMore, loadMore, load, clear } = history;

  // "Visa fler" laddas av sig själv när knappen scrollas in i bild (knappen
  // finns kvar som reserv, t.ex. om observern saknas).
  useEffect(() => {
    const el = moreRef.current;
    if (!el || !nextBefore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root: scrollRoot.current, rootMargin: "120px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [nextBefore, loadMore, scrollRoot, sessions?.length]);

  if (status === "loading" || (status === "idle" && !sessions)) {
    return (
      <div aria-busy="true" className="space-y-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Pulse className="h-3 w-20 rounded-full" />
              <Pulse className="h-4 w-3/5" />
            </div>
            <Pulse className="h-9 w-6 rounded" />
            <Pulse className="h-9 w-6 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (status === "error" && !sessions) {
    return (
      <div className="space-y-3 py-6 text-center">
        <p className="text-sm text-white/60">{t("history.loadFailed")}</p>
        <button
          type="button"
          onClick={() => void load()}
          className={`mx-auto flex min-h-11 items-center rounded-xl px-4 text-sm font-medium text-white/80 transition hover:text-white ${focusRing}`}
        >
          {t("error.retry")}
        </button>
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="space-y-2 py-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.05] text-white/40">
          <HistoryIcon className="h-6 w-6" aria-hidden />
        </div>
        <p className="text-[15px] font-semibold text-white/85">{t("history.emptyTitle")}</p>
        <p className="mx-auto max-w-xs text-sm leading-relaxed text-white/50">{t("history.emptyBody")}</p>
      </div>
    );
  }

  const onClear = async () => {
    if (clearing) return;
    setClearing(true);
    setClearFailed(false);
    const ok = await clear();
    setClearing(false);
    if (ok) setConfirming(false);
    else setClearFailed(true);
  };

  return (
    <div>
      <ul className="-mx-2 divide-y divide-white/[0.06]">
        {sessions.map((s) => {
          const first = s.entries[0];
          const line = first ? askText(entryAsk(first, undefined), t) : t("thread.anyQuery");
          const label = sessionLabel(s.lastAt, locale, t);
          const posters = sessionPosters(s);
          return (
            <li key={s.sessionId}>
              <button
                type="button"
                onClick={() => onOpen(s)}
                className={`flex min-h-[60px] w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-white/[0.04] active:bg-white/[0.06] ${focusRing}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-white/45">
                    {label}
                    {s.entries.length > 1 ? ` · ${t("history.count", { count: s.entries.length })}` : ""}
                  </span>
                  <span className="mt-0.5 block truncate text-[15px] text-white/85">{line}</span>
                </span>
                <span className="flex shrink-0 gap-1" aria-hidden>
                  {posters.map((p) => (
                    <Poster
                      key={itemKey(p)}
                      src={p.poster}
                      title={p.title}
                      tiny
                      sizes="32px"
                      className="aspect-[2/3] w-6 rounded"
                    />
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {nextBefore ? (
        <button
          ref={moreRef}
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className={`mx-auto mt-2 flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-medium text-white/60 transition hover:text-white ${focusRing}`}
        >
          {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {t("history.more")}
        </button>
      ) : null}

      <div className="mt-6">
        {confirming ? (
          <div role="group" aria-label={t("history.clear")} className="rounded-2xl bg-white/[0.04] p-3 text-center">
            <p className="text-sm text-white/80">{t("history.clearConfirm")}</p>
            <p className="mt-0.5 text-xs text-white/45">{t("history.clearNote")}</p>
            {clearFailed ? (
              <p role="alert" className="mt-2 text-xs text-rose-300">
                {t("history.clearFailed")}
              </p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setClearFailed(false);
                }}
                className={`flex min-h-11 flex-1 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm font-medium text-white/80 transition hover:bg-white/10 ${focusRing}`}
              >
                {t("history.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void onClear()}
                disabled={clearing}
                className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-rose-500/15 text-sm font-semibold text-rose-200 ring-1 ring-rose-400/25 transition hover:bg-rose-500/25 disabled:opacity-60 ${focusRing}`}
              >
                {clearing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {t("history.clearAction")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={`mx-auto flex min-h-11 items-center rounded-xl px-3 text-xs text-white/40 transition hover:text-white/70 ${focusRing}`}
          >
            {t("history.clear")}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- en session ---------- */

/** Ett sparat förslag. Alternativen går att byta in lokalt, precis som live. */
function HistoryEntryCard({
  entry,
  isSaved,
  savingKey,
  onSave,
  onOpenService,
  onAltSelect,
  onOpenDetail,
}: {
  entry: PickHistoryEntry;
  isSaved: (item: PickItem) => boolean;
  savingKey: string | null;
  onSave: (item: PickItem) => void;
  onOpenService: (item: PickItem, provider: string) => void;
  onAltSelect: (alt: PickItem) => void;
  onOpenDetail?: (item: PickItem) => void;
}) {
  const [main, setMain] = useState<PickItem>(entry.pick);
  const [alts, setAlts] = useState<PickItem[]>(() => entry.alternatives.slice(0, 2));
  return (
    <PickCard
      key={itemKey(main)}
      size="compact"
      main={main}
      pickKey={itemKey(entry.pick)}
      reason={entry.reason}
      alts={alts}
      onAltSelect={(alt) => {
        onAltSelect(alt);
        const prev = main;
        setMain(alt);
        setAlts((list) => list.map((a) => (itemKey(a) === itemKey(alt) ? prev : a)));
      }}
      saved={isSaved(main)}
      saving={savingKey === itemKey(main)}
      onSave={onSave}
      onOpenService={onOpenService}
      onOpenDetail={onOpenDetail}
    />
  );
}

export function HistoryDetail({
  session,
  isSaved,
  savingKey,
  onSave,
  onOpenService,
  onAltSelect,
  onOpenDetail,
  onContinue,
}: {
  session: PickHistorySession;
  isSaved: (item: PickItem) => boolean;
  savingKey: string | null;
  onSave: (item: PickItem) => void;
  onOpenService: (item: PickItem, provider: string) => void;
  onAltSelect: (alt: PickItem) => void;
  onOpenDetail?: (item: PickItem) => void;
  /** Saknas för sessioner som inte går att fortsätta (rader utan sessionId). */
  onContinue?: () => void;
}) {
  const t = useTranslations("pick");
  return (
    <div className="space-y-6">
      {session.entries.map((e, i) => (
        <section key={e.requestId} className="space-y-2.5">
          <AskBubble text={askText(entryAsk(e, session.entries[i - 1]), t)} lines={3} />
          <HistoryEntryCard
            entry={e}
            isSaved={isSaved}
            savingKey={savingKey}
            onSave={onSave}
            onOpenService={onOpenService}
            onAltSelect={onAltSelect}
            onOpenDetail={onOpenDetail}
          />
        </section>
      ))}
      {onContinue ? (
        <button
          type="button"
          onClick={onContinue}
          className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-4 text-[15px] font-semibold text-neutral-950 transition hover:bg-cyan-300 active:scale-[0.98] ${focusRing}`}
        >
          <MessageCircle className="h-5 w-5" aria-hidden />
          {t("history.continue")}
        </button>
      ) : null}
    </div>
  );
}
