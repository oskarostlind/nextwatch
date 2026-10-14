// lib/aiPick/schema.ts
//
// zod-scheman för /api/pick* (delas av pick- och selftest-routen).

import { z } from "zod";
import {
  PICK_CHIP_IDS,
  PICK_EVENT_TYPES,
  PICK_PROMPT_MAX,
  PICK_SESSION_ID_MAX,
  type PickChipId,
  type PickEventType,
} from "@/lib/aiPick/types";

export const pickRequestSchema = z.object({
  prompt: z
    .string()
    .optional()
    .transform((s) => (s ?? "").trim())
    .refine((s) => s.length <= PICK_PROMPT_MAX, { message: "prompt_too_long" }),
  chips: z
    .array(z.enum(PICK_CHIP_IDS as unknown as [PickChipId, ...PickChipId[]]))
    .max(PICK_CHIP_IDS.length)
    .optional(),
  mediaFilter: z.enum(["both", "movie", "tv"]).optional(),
  exclude: z.array(z.number().int().positive()).max(200).optional(),
  sessionId: z
    .string()
    .min(1)
    .max(PICK_SESSION_ID_MAX)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  followUpOf: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  focus: z
    .object({
      tmdbId: z.number().int().positive(),
      mediaType: z.enum(["movie", "tv"]),
    })
    .optional(),
  markSeen: z.boolean().optional(),
  /** Dagens gratis auto-förslag (nya flödet) — se PickRequestBody.auto. */
  auto: z.boolean().optional(),
});

/** GET /api/pick/history — `before` (ISO) + `limit` (1..30, default 15). */
export const pickHistoryQuerySchema = z.object({
  before: z
    .string()
    .optional()
    .refine((s) => s === undefined || !Number.isNaN(new Date(s).getTime()), { message: "bad_before" }),
  limit: z.coerce.number().int().min(1).max(30).optional(),
});

export const pickEventSchema = z.object({
  type: z.enum(PICK_EVENT_TYPES as unknown as [PickEventType, ...PickEventType[]]),
  meta: z.record(z.string(), z.unknown()).optional(),
});

/** Max storlek på event-meta som JSON (byte). */
export const PICK_EVENT_META_MAX = 1024;
