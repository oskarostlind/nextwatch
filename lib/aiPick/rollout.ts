// lib/aiPick/rollout.ts
//
// Utrullningsflagga för "Välj åt mig". PICK_ROLLOUT styr utan deploy:
//   off   → av för alla
//   admin → bara ADMIN_EMAIL-användaren (lib/adminAuth.ts) — standard
//   all   → på för alla inloggade
// Okänt/osatt värde = 'admin' (fail closed mot betalda LLM-anrop).

import { isAdmin } from "@/lib/adminAuth";

export type PickRollout = "off" | "admin" | "all";

export function pickRollout(raw: string | undefined = process.env.PICK_ROLLOUT): PickRollout {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "off" || v === "all" || v === "admin") return v;
  return "admin";
}

/** Är funktionen påslagen för just den här användaren? Kastar aldrig. */
export async function isPickEnabledFor(uid: string | null | undefined): Promise<boolean> {
  if (!uid) return false;
  const mode = pickRollout();
  if (mode === "off") return false;
  if (mode === "all") return true;
  try {
    return await isAdmin(uid);
  } catch {
    return false;
  }
}
