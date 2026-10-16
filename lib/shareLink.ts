"use client";

// Dela en länk: native delningsark i apparna (Capacitor Share), Web Share i
// webbläsare som har det, annars kopiera. Delas av bjud in-kortet i första
// sessionen (app/components/firstSession/InviteCard.tsx) och "Dela länk" i
// Grupp-fliken (app/group/components/InviteLinkPanel.tsx).

export type ShareVia = "native" | "webshare" | "copy";
export type ShareOutcome = { done: true; via: ShareVia } | { done: false; cancelled: boolean };

type CapShare = { share: (o: { title?: string; text?: string; url?: string; dialogTitle?: string }) => Promise<unknown> };
type CapGlobal = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  Plugins?: Record<string, unknown>;
};

function capacitorShare(): CapShare | null {
  try {
    const cap = (window as unknown as { Capacitor?: CapGlobal }).Capacitor;
    if (!cap?.isNativePlatform?.() || !cap.isPluginAvailable?.("Share")) return null;
    const plugin = cap.Plugins?.Share as CapShare | undefined;
    return plugin && typeof plugin.share === "function" ? plugin : null;
  } catch {
    return null;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* faller till textarea */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function isAbort(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return name === "AbortError" || /cancel|abort/i.test(msg);
}

export async function shareLink(url: string, title: string, text: string): Promise<ShareOutcome> {
  const native = capacitorShare();
  if (native) {
    try {
      await native.share({ title, text, url, dialogTitle: title });
      return { done: true, via: "native" };
    } catch (e) {
      if (isAbort(e)) return { done: false, cancelled: true };
    }
  }
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (typeof nav.share === "function") {
    try {
      await nav.share({ title, text, url });
      return { done: true, via: "webshare" };
    } catch (e) {
      if (isAbort(e)) return { done: false, cancelled: true };
      // NotAllowedError m.fl. → kopiera i stället.
    }
  }
  return (await copyText(url)) ? { done: true, via: "copy" } : { done: false, cancelled: false };
}
