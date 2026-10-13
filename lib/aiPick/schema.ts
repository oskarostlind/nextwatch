// lib/aiPick/schema.ts
//
// zod-scheman för /api/pick* (delas av pick- och selftest-routen).

import { z } from "zod";
import { PICK_CHIP_IDS, PICK_EVENT_TYPES, PICK_PROMPT_MAX, type PickChipId, type PickEventType } from "@/lib/aiPick/types";

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
});

export const pickEventSchema = z.object({
  type: z.enum(PICK_EVENT_TYPES as unknown as [PickEventType, ...PickEventType[]]),
  meta: z.record(z.string(), z.unknown()).optional(),
});

/** Max storlek på event-meta som JSON (byte). */
export const PICK_EVENT_META_MAX = 1024;
