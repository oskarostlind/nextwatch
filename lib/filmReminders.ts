// lib/filmReminders.ts (klient)
//
// Lokal push-påminnelse (iOS via Capacitor) när en kommande film släpps.
// Schemaläggs på enheten — ingen backend, funkar offline. På webben är det en
// no-op (returnerar ok:false med förklaring).
import { clientMsg } from "@/lib/clientMessages";
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
    return { ok: false, message: clientMsg("remindersAppOnly") };
  }
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");

    let perm = await LocalNotifications.checkPermissions();
    if (perm.display === "prompt" || perm.display === "prompt-with-rationale") {
      perm = await LocalNotifications.requestPermissions();
    }
    if (perm.display !== "granted") {
      return { ok: false, message: clientMsg("remindersAllowNotifications") };
    }

    // Notis kl 09:00 lokal tid på releasedagen.
    const at = new Date(`${opts.releaseDate}T09:00:00`);
    if (Number.isNaN(at.getTime())) return { ok: false, message: clientMsg("remindersUnknownDate") };
    if (at.getTime() < Date.now()) return { ok: false, message: clientMsg("remindersAlreadyReleased") };

    await LocalNotifications.schedule({
      notifications: [
        {
          id: notifId(opts.tmdbId),
          title: clientMsg("reminderTitle"),
          body: clientMsg("reminderBody", { title: opts.title }),
          schedule: { at },
        },
      ],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : clientMsg("remindersFailed") };
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
