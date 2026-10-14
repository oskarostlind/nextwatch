// lib/aiPick/client.ts (klient)
//
// Fetch-hjälpare för "Välj åt mig" (AI-val). Servern (/api/pick*) är källan
// till sanning för kvoten — det här är bara tunna omslag som aldrig kastar.
//
// Statusen cachas i modulen en kort stund: PickLauncher hämtar den vid mount
// för att veta om knappen ska synas alls (utrullningsflaggan), och arket läser
// samma svar när det öppnas i stället för att hämta igen.

import type {
  PickEventType,
  PickHistoryResponse,
  PickQuota,
  PickRequestBody,
  PickResponse,
} from "@/lib/aiPick/types";

const STATUS_TTL_MS = 5 * 60 * 1000;

let statusCache: { at: number; value: PickQuota } | null = null;
let statusInFlight: Promise<PickQuota | null> | null = null;

/** Senast kända kvot utan nätverk (null om ingen hämtats än). */
export function cachedPickStatus(): PickQuota | null {
  return statusCache?.value ?? null;
}

/** Uppdatera cachen med en kvot som kom tillbaka från t.ex. POST /api/pick. */
export function primePickStatus(quota: PickQuota | null | undefined): void {
  if (quota && typeof quota === "object") statusCache = { at: Date.now(), value: quota };
}

/**
 * GET /api/pick/status. `fresh` hoppar över cachen (efter en belöningsvideo,
 * eller när arket öppnas och kvoten kan ha ändrats). null vid fel/401.
 */
export async function getPickStatus(opts: { fresh?: boolean } = {}): Promise<PickQuota | null> {
  if (!opts.fresh && statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) {
    return statusCache.value;
  }
  if (statusInFlight) return statusInFlight;

  statusInFlight = (async () => {
    try {
      const res = await fetch("/api/pick/status", { cache: "no-store" });
      if (!res.ok) return null;
      const j = (await res.json()) as PickQuota;
      if (!j || typeof j.enabled !== "boolean") return null;
      primePickStatus(j);
      return j;
    } catch {
      return null;
    } finally {
      statusInFlight = null;
    }
  })();

  return statusInFlight;
}

type PickError = Extract<PickResponse, { ok: false }>["error"];

function errorForStatus(status: number): PickError {
  if (status === 402) return "no_quota";
  if (status === 403) return "disabled";
  if (status === 400) return "bad_request";
  return "unavailable";
}

/**
 * POST /api/pick. Returnerar alltid ett PickResponse — nätverksfel och
 * oväntade svar blir { ok:false, error:"unavailable" } så arket bara behöver
 * hantera ett format. Kvoten i svaret läggs i cachen.
 */
export async function requestPick(body: PickRequestBody): Promise<PickResponse> {
  try {
    const res = await fetch("/api/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => null)) as PickResponse | null;
    if (j && typeof j === "object" && "ok" in j) {
      if (j.quota) primePickStatus(j.quota);
      if (j.ok === true && j.pick) return j;
      if (j.ok === false && typeof j.error === "string") return j;
    }
    return { ok: false, error: errorForStatus(res.status) };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/* ---------------- Auto-förslaget (nya flödet) ---------------- */

type AutoPickOk = Extract<PickResponse, { ok: true }>;

const AUTO_STORE_KEY = "nw_pick_auto_v1";

let autoMemo: { day: string; res: AutoPickOk } | null = null;
let autoInFlight: Promise<PickResponse> | null = null;

/** Lokal kalenderdag — svaret gäller bara samma dag (servern räknar Stockholm). */
function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function readAutoStore(): AutoPickOk | null {
  const day = localDay();
  if (autoMemo && autoMemo.day === day) return autoMemo.res;
  try {
    const raw = window.sessionStorage.getItem(AUTO_STORE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { day?: string; res?: AutoPickOk };
    if (j?.day !== day || !j.res || j.res.ok !== true || !j.res.pick) return null;
    autoMemo = { day, res: j.res };
    return j.res;
  } catch {
    return null;
  }
}

function writeAutoStore(res: AutoPickOk): void {
  const entry = { day: localDay(), res };
  autoMemo = entry;
  try {
    window.sessionStorage.setItem(AUTO_STORE_KEY, JSON.stringify(entry));
  } catch {
    /* privat läge — minnet räcker */
  }
}

/**
 * Redan hämtat auto-förslag (minnet/sessionStorage), utan nätverk. Används för
 * att hoppa över "tänker"-animationen när förhämtningen hunnit klart.
 */
export function peekAutoPick(): AutoPickOk | null {
  if (typeof window === "undefined") return null;
  return readAutoStore();
}

/**
 * POST /api/pick { auto: true } — dagens gratis auto-förslag. Räknas aldrig
 * mot kvoten och servern ger samma förslag igen samma dygn, så det är säkert
 * att förhämta (efter 7 swipes) och anropa igen när arket öppnas: samtidiga
 * anrop delar ett löfte och ett lyckat svar cachas i minnet + sessionStorage.
 * Fel cachas inte (nästa anrop försöker igen). Kastar aldrig.
 */
export function fetchAutoPick(opts: { mediaFilter?: PickRequestBody["mediaFilter"] } = {}): Promise<PickResponse> {
  const cached = peekAutoPick();
  if (cached) return Promise.resolve(cached);
  if (autoInFlight) return autoInFlight;
  const body: PickRequestBody = { auto: true, sessionId: newPickSessionId() };
  if (opts.mediaFilter) body.mediaFilter = opts.mediaFilter;
  autoInFlight = requestPick(body)
    .then((res) => {
      if (res.ok) writeAutoStore(res);
      return res;
    })
    .finally(() => {
      autoInFlight = null;
    });
  return autoInFlight;
}

/**
 * Ett id per "konversation" i arket — skickas med varje förfrågan så att
 * historiken kan gruppera dem. Servern godtar [A-Za-z0-9_-], max 64 tecken.
 * randomUUID saknas i äldre WebViews och utanför säkra kontexter → reserv.
 */
export function newPickSessionId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* faller till reserven */
  }
  const rand = Math.random().toString(36).slice(2, 12);
  return `s-${Date.now().toString(36)}-${rand}`;
}

/**
 * GET /api/pick/history — tidigare val grupperade per "konversation" (ett
 * öppnat ark = en session). `before` är föregående svars nextBefore. Kastar
 * aldrig: fel blir { ok:false }.
 */
export async function getPickHistory(before?: string | null, limit = 15): Promise<PickHistoryResponse> {
  try {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (before) qs.set("before", before);
    const res = await fetch(`/api/pick/history?${qs.toString()}`, { cache: "no-store" });
    if (res.status === 401) return { ok: false, error: "unauthorized" };
    const j = (await res.json().catch(() => null)) as PickHistoryResponse | null;
    if (res.ok && j && j.ok === true && Array.isArray(j.sessions)) return j;
    return { ok: false, error: "unavailable" };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/**
 * DELETE /api/pick/history — tömmer det som visas i historiken. Påverkar inte
 * kvoten (servern räknar bara status/källa/tid). true om det gick.
 */
export async function clearPickHistory(): Promise<boolean> {
  try {
    const res = await fetch("/api/pick/history", { method: "DELETE", cache: "no-store" });
    if (!res.ok) return false;
    const j = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return j?.ok === true;
  } catch {
    return false;
  }
}

export type PickRewardResult = { ok: boolean; quota?: PickQuota; error?: string };

/** POST /api/pick/reward — löser in en tittad belöningsvideo (+rewardPicks). */
export async function claimPickReward(): Promise<PickRewardResult> {
  try {
    const res = await fetch("/api/pick/reward", { method: "POST", cache: "no-store" });
    const j = (await res.json().catch(() => null)) as PickRewardResult | null;
    if (j?.quota) primePickStatus(j.quota);
    if (!res.ok || !j?.ok) return { ok: false, quota: j?.quota, error: j?.error ?? String(res.status) };
    return { ok: true, quota: j.quota };
  } catch {
    return { ok: false, error: "network" };
  }
}

/**
 * POST /api/pick/event — egen statistik för /admin. Fire-and-forget: kastar
 * aldrig och blockerar aldrig UI:t. keepalive så att "close"/"open_service"
 * hinner iväg även när sidan lämnas.
 */
export function trackPickEvent(type: PickEventType, meta?: Record<string, unknown>): void {
  try {
    void fetch("/api/pick/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      keepalive: true,
      body: JSON.stringify(meta ? { type, meta } : { type }),
    }).catch(() => {
      /* best effort */
    });
  } catch {
    /* SSR o.dyl. */
  }
}
