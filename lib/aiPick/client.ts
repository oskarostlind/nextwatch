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
