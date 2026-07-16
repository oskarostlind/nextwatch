// lib/filmReminders.ts (klient)
//
// Lokal push-påminnelse (iOS via Capacitor) när en kommande film släpps.
// Schemaläggs på enheten — ingen backend, funkar offline. På webben är det en
// no-op (returnerar ok:false med förklaring).
import { Capacitor } from "@capacitor/core";

export type ReminderResult = { ok: boolean; message?: string };

export function canRemind(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Stabilt 32-bitars notis-id ur tmdbId (LocalNotifications kräver int32). */
function notifId(tmdbId: number): number {
  return Math.abs(tmdbId) % 2_000_000_000;
}

export async function scheduleReleaseReminder(opts: {
  tmdbId: number;
  title: string;
  releaseDate: string; // "YYYY-MM-DD"
}): Promise<ReminderResult> {
  if (!canRemind()) {
    return { ok: false, message: "Påminnelser fungerar bara i appen." };
  }
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");

    let perm = await LocalNotifications.checkPermissions();
    if (perm.display === "prompt" || perm.display === "prompt-with-rationale") {
      perm = await LocalNotifications.requestPermissions();
    }
    if (perm.display !== "granted") {
      return { ok: false, message: "Tillåt notiser för att få en påminnelse." };
    }

    // Notis kl 09:00 lokal tid på releasedagen.
    const at = new Date(`${opts.releaseDate}T09:00:00`);
    if (Number.isNaN(at.getTime())) return { ok: false, message: "Okänt releasedatum." };
    if (at.getTime() < Date.now()) return { ok: false, message: "Filmen har redan släppts." };

    await LocalNotifications.schedule({
      notifications: [
        {
          id: notifId(opts.tmdbId),
          title: "Släpps idag 🎬",
          body: `${opts.title} finns nu att se!`,
          schedule: { at },
        },
      ],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Kunde inte skapa påminnelse." };
  }
}

/** Avboka en tidigare satt påminnelse (om användaren ångrar sig). */
export async function cancelReleaseReminder(tmdbId: number): Promise<void> {
  if (!canRemind()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.cancel({ notifications: [{ id: notifId(tmdbId) }] });
  } catch {
    /* best-effort */
  }
}
