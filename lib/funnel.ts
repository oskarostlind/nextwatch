// lib/funnel.ts — mätpunkter för FÖRSTA besöket: var tappar vi nya användare?
//
// funnel("swipe_1") registrerar att den här enheten nått steget. Varje steg
// skickas en gång per enhet (localStorage + PK i databasen), så anropen kan
// ligga i render-nära kod utan att spamma. Admin läser tratten i /admin →
// Tratt (app/api/admin/funnel).
//
// Bara NYA enheter spåras. Första anropet registrerar "first_open"; servern
// svarar track=false om nw_uid redan är en etablerad användare (befintlig
// användare efter en uppdatering, eller inloggning på ny enhet) — då blir alla
// funnel()-anrop no-ops på den enheten för alltid. Spårningen slutar också
// efter TRACK_DAYS dagar, så tabellen håller sig liten.
//
// Inget här får någonsin kasta eller blockera UI:t: allt är best effort.

export type FunnelProps = Record<string, string | number | boolean | null>;

const KEY = "nw_fx"; // { id, track, t0 }
const SENT = "nw_fx_sent";
const TRACK_DAYS = 14;

type State = { id: string; track: boolean; t0: number };

let state: State | null = null;
let init: Promise<State | null> | null = null;
let sent: Set<string> | null = null;
const queue: { name: string; props?: FunnelProps; at: number }[] = [];

function platform(): "ios" | "web" {
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } })
      .Capacitor;
    if (cap?.isNativePlatform?.() && cap.getPlatform?.() === "ios") return "ios";
  } catch {
    /* webb */
  }
  return "web";
}

function readState(): State | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as State;
    return s && typeof s.id === "string" ? s : null;
  } catch {
    return null;
  }
}

function sentSet(): Set<string> {
  if (sent) return sent;
  try {
    sent = new Set(JSON.parse(localStorage.getItem(SENT) ?? "[]") as string[]);
  } catch {
    sent = new Set();
  }
  return sent;
}

function markSent(name: string) {
  const s = sentSet();
  s.add(name);
  try {
    localStorage.setItem(SENT, JSON.stringify([...s]));
  } catch {
    /* privat läge — servern deduplicerar ändå */
  }
}

function newId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
}

function post(body: unknown, beacon = false): Promise<Response | null> {
  const json = JSON.stringify(body);
  try {
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon("/api/track/funnel", new Blob([json], { type: "application/json" }));
      return Promise.resolve(null);
    }
  } catch {
    /* fall igenom till fetch */
  }
  return fetch("/api/track/funnel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json,
    keepalive: true,
    cache: "no-store",
  }).catch(() => null);
}

function active(s: State | null): s is State {
  return Boolean(s && s.track && Date.now() - s.t0 < TRACK_DAYS * 86400_000);
}

function send(s: State, name: string, props: FunnelProps | undefined, at: number, beacon = false, repeat = false) {
  if (!repeat) {
    if (sentSet().has(name)) return;
    markSent(name);
  }
  void post(
    {
      device: s.id,
      name,
      platform: platform(),
      path: location.pathname,
      props: { ...(props ?? {}), sec: Math.round((at - s.t0) / 1000) },
    },
    beacon,
  );
}

/** Startar spårningen (idempotent). Anropas av FunnelTracker vid appstart. */
export function funnelInit(): Promise<State | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (state) return Promise.resolve(state);
  if (init) return init;
  init = (async () => {
    const existing = readState();
    if (existing) {
      state = existing;
    } else {
      const id = newId();
      const t0 = Date.now();
      const res = await post({ device: id, name: "first_open", platform: platform(), path: location.pathname, props: { sec: 0 } });
      const j = (res && res.ok ? await res.json().catch(() => null) : null) as { track?: boolean } | null;
      // Nätverksfel: spåra inte hellre än att räkna en okänd enhet som ny.
      state = { id, track: Boolean(j?.track), t0 };
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch {
        /* privat läge: ny enhet varje gång — men då har vi heller inget id att återanvända */
      }
      markSent("first_open");
    }
    const s = state;
    for (const q of queue.splice(0)) if (active(s)) send(s, q.name, q.props, q.at);
    return s;
  })();
  return init;
}

// Senaste "riktiga" steget som nåtts — skickas med vid stängning så det syns
// vad som hände precis innan någon lämnade (t.ex. att ATT-frågan just visats).
let last: string | null = null;
export function lastStep(): string | null {
  return last;
}

/** Registrera att enheten nått ett steg (en gång per enhet). */
export function funnel(name: string, props?: FunnelProps): void {
  if (typeof window === "undefined") return;
  if (!name.startsWith("view:") && name !== "return_visit") last = name;
  try {
    if (state) {
      if (active(state)) send(state, name, props, Date.now());
      return;
    }
    if (sentSet().has(name)) return;
    queue.push({ name, props, at: Date.now() });
    void funnelInit();
  } catch {
    /* best effort */
  }
}

/**
 * Som funnel() men via sendBeacon — för när sidan håller på att stängas.
 * repeat=true skickar varje gång (servern skriver över: "last_exit").
 */
export function funnelBeacon(name: string, props?: FunnelProps, repeat = false): void {
  try {
    if (active(state)) send(state, name, props, Date.now(), true, repeat);
  } catch {
    /* best effort */
  }
}

/** Tid sedan enheten öppnade appen första gången (ms), eller null. */
export function funnelStart(): number | null {
  return state?.t0 ?? readState()?.t0 ?? null;
}

// Swipes under den här sidladdningen — till first_exit ("hur långt kom de?").
let sessionSwipes = 0;
let totalSwipes = -1;
const SWIPE_MARKS = [1, 3, 5, 10, 25, 50, 100];

/** Anropas vid varje riktig swipe på ett riktigt kort (inte guiden, inte annonser). */
export function funnelSwipe(kind: "like" | "dislike" | "seen"): void {
  sessionSwipes++;
  try {
    if (totalSwipes < 0) totalSwipes = Number(localStorage.getItem("nw_fx_swipes") ?? 0);
    totalSwipes++;
    localStorage.setItem("nw_fx_swipes", String(totalSwipes));
  } catch {
    totalSwipes = Math.max(totalSwipes, sessionSwipes);
  }
  if (SWIPE_MARKS.includes(totalSwipes)) funnel(`swipe_${totalSwipes}`);
  if (kind === "like") funnel("like_1");
}

export function funnelSessionSwipes(): number {
  return sessionSwipes;
}
