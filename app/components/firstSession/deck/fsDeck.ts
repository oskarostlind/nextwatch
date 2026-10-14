"use client";

// Del 1 av "nya flödet" (docs/nya-flodet.md): hjälpare för kallstarten och
// leken. Stegmaskinen själv bor i lib/firstSession.ts — det här är bara det
// leken/startsidan behöver runt den.

import { endFirstSession, getFs, startFirstSession, type FsState } from "@/lib/firstSession";
import { funnel, funnelIsNewDevice } from "@/lib/funnel";
import { replayAnonLikesInBackground } from "@/lib/anonLikes";

/** Swipes innan tjänste-/ålderskortet dyker upp i leken. */
export const FS_SERVICES_AT = 5;
/** Gilla innan "vi lär oss din smak"-chipet visas. */
export const FS_LEARN_AT = 3;

const OWNER_KEY = "nw_fs_uid";
const SERVICES_DONE_KEY = "nw_fs_services_done";
// Samma nyckel som SEEN_KEY i app/components/client/ProviderPromptSheet.tsx.
// Den som fått tjänstekortet ska inte få bottenarket efter flödet också.
const PROVIDER_PROMPT_SEEN_KEY = "nw_provider_prompt_seen";

/** Pågår första sessionen (ny enhet, inte klar)? */
export function fsActive(fs: FsState = getFs()): boolean {
  return fs.eligible && fs.step !== "done";
}

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* privat läge */
  }
}

/**
 * Leken anropar den här med den inloggade användarens id. Första gången
 * flödet ser ett id sparas det (gästen som flödet skapades för). Byts id:t
 * senare har någon loggat in på ett BEFINTLIGT konto (inloggning byter nw_uid;
 * att spara gästen som konto — Apple eller e-post — behåller samma id, se
 * app/api/auth/apple och app/api/auth/register) → flödet avslutas.
 */
export function syncFsOwner(uid: string | null | undefined): void {
  if (!uid || !fsActive()) return;
  const prev = lsGet(OWNER_KEY);
  if (!prev) {
    lsSet(OWNER_KEY, uid);
    return;
  }
  if (prev !== uid) endFirstSession();
}

export function servicesCardDone(): boolean {
  return lsGet(SERVICES_DONE_KEY) === "1";
}

export function markServicesCardDone(): void {
  lsSet(SERVICES_DONE_KEY, "1");
  lsSet(PROVIDER_PROMPT_SEEN_KEY, "1");
}

/**
 * Skapar gästprofilen (samma väg som GuestEntryButton: POST /api/profile/guest)
 * utan att navigera. true = profilen finns (ny eller sedan tidigare).
 *
 * - "app": appens kallstart, tyst — ingen knapp har tryckts.
 * - "web": "Börja swipa" på startsidan — loggar även de gamla stegen
 *   cta_guest/guest_created så tratten före/efter går att jämföra.
 *
 * guest_autocreated loggas bara när profilen faktiskt skapades nu, och
 * startFirstSession() anropas bara för en NY enhet (tratten avgör, se
 * funnelIsNewDevice) — befintliga användare får aldrig nya flödet.
 */
export async function createGuestProfile(via: "app" | "web"): Promise<boolean> {
  if (via === "web") funnel("cta_guest");
  try {
    const res = await fetch("/api/profile/guest", { method: "POST", cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; alreadyHadProfile?: boolean };
    if (!res.ok || !j.ok) return false;
    if (!j.alreadyHadProfile) {
      if (via === "web") funnel("guest_created");
      funnel("guest_autocreated", { via });
      if (await funnelIsNewDevice()) startFirstSession();
    }
    // Startsidans demokort som gillats följer med in (lib/anonLikes.ts).
    replayAnonLikesInBackground();
    return true;
  } catch {
    return false;
  }
}
