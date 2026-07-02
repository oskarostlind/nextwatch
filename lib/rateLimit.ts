/**
 * In-memory rate limiter (per-instance). For production at scale, replace with
 * Redis/Vercel KV (e.g. @upstash/ratelimit).
 */

const store = new Map<
  string,
  { count: number; resetAt: number }
>();

const WINDOW_MS = 60 * 1000; // 1 minute

export type RateLimitConfig = {
  /** Max requests per window (per key) */
  limit: number;
  /** Window in ms (default 60_000) */
  windowMs?: number;
};

const DEFAULT_CONFIG: RateLimitConfig = { limit: 60, windowMs: WINDOW_MS };

/**
 * Returns true if the request should be allowed, false if rate limited.
 * Key is typically nw_uid or IP so we can limit per user/IP.
 */
export function rateLimitAllow(
  key: string,
  route: string,
  config: Partial<RateLimitConfig> = {}
): boolean {
  const { limit, windowMs = WINDOW_MS } = { ...DEFAULT_CONFIG, ...config };
  const fullKey = `${route}:${key}`;
  const now = Date.now();
  const entry = store.get(fullKey);

  if (!entry) {
    store.set(fullKey, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (now >= entry.resetAt) {
    store.set(fullKey, { count: 1, resetAt: now + windowMs });
    return true;
  }

  entry.count += 1;
  if (entry.count > limit) {
    return false;
  }
  return true;
}

/** Limits suitable for heavy endpoints (e.g. recs, group/match) */
export const RECS_LIMIT = 30;   // per minute
// Match är en billig läsning som pollas var 8:e sek + en gång per röst. Under snabb
// gruppswipe (1 röst = 1 poll) sprängde 30/min gränsen → 429 → matchen visades inte.
// Höjt till 120 för att ge pollningen marginal (TMDB-anropet sker bara vid faktisk match).
export const MATCH_LIMIT = 120; // per minute
export const TMDB_DETAILS_LIMIT = 60;
export const AUTH_LIMIT = 10;   // login/register per minute

/** Get key for rate limiting: prefer nw_uid from cookie, else IP from headers */
export function getRateLimitKey(req: Request, uid?: string | null): string {
  if (uid) return uid;
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "anonymous";
  return ip;
}
