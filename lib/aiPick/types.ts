// lib/aiPick/types.ts
//
// Delade typer för "Välj åt mig" (AI-val). Kontraktet mellan servern
// (app/api/pick/**, lib/aiPick/*) och UI:t (app/components/pick/*,
// lib/aiPick/client.ts). Import-fri med flit så att klienten kan importera
// filen utan att dra in Prisma eller next/headers.

export type PickQuota = {
  enabled: boolean;            // rollout flag for THIS user
  premium: boolean;
  premiumMonthly: number;      // 20
  premiumLeft: number | null;  // null for free users
  credits: number;             // ad credits balance
  rewardPicks: number;         // 3
  rewardsLeftToday: number;    // grants left today
  totalLeft: number;           // premiumLeft(or 0) + credits
};

export type PickProvider = { name: string; logo: string | null };

export type PickItem = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year: number | null;
  poster: string | null;        // full URL (w500) or null
  backdrop: string | null;
  runtimeMin: number | null;    // movie runtime or typical episode runtime
  genres: string[];             // localized display names
  rating: number | null;        // TMDB vote average 0–10, 1 decimal
  overview: string | null;
  providers: PickProvider[];    // user's region flatrate providers if known
  inWatchlist: boolean;
  likedAt: string | null;       // ISO time the user swiped yes / saved it (null for fresh titles)
  fromSaved: boolean;           // true if it came from the user's own likes/watchlist
};

export type PickChipId = "light" | "short" | "thrilling" | "surprise";

export type PickRequestBody = {
  prompt?: string;              // ≤300 chars, trimmed
  chips?: PickChipId[];
  mediaFilter?: "both" | "movie" | "tv";
  exclude?: number[];           // tmdb ids already shown this session ("Visa något annat")
};

export type PickResponse =
  | { ok: true; pick: PickItem; alternatives: PickItem[]; reason: string; quota: PickQuota }
  | { ok: false; error: "no_quota" | "no_candidates" | "unavailable" | "disabled" | "bad_request"; quota?: PickQuota };

export type PickEventType =
  | "open" | "chip" | "submit" | "open_service" | "save" | "another" | "alt_select"
  | "paywall_view" | "ad_start" | "ad_complete" | "ad_fail" | "upsell_view" | "upsell_click" | "close";

/** Runtime-lista över tillåtna händelsetyper (vitlistan i /api/pick/event). */
export const PICK_EVENT_TYPES: readonly PickEventType[] = [
  "open", "chip", "submit", "open_service", "save", "another", "alt_select",
  "paywall_view", "ad_start", "ad_complete", "ad_fail", "upsell_view", "upsell_click", "close",
] as const;

export const PICK_CHIP_IDS: readonly PickChipId[] = ["light", "short", "thrilling", "surprise"] as const;

/** Max längd på fritexten (samma gräns i klient och server). */
export const PICK_PROMPT_MAX = 300;
