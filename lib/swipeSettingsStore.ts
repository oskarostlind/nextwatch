// Global klient-store för swipe-inställningar (hyr/köp-visning + film/serie-filter).
// Samma mönster som lib/socialStore.ts (modul-singleton + useSyncExternalStore via
// app/components/client/SwipeSettingsProvider.tsx): inställningarna laddas EN gång
// vid appstart och läses av alla ytor som visar providers (swipe-kortets baksida,
// /discover, /watchlist, MatchOverlay) samt av profilens reglage.

import {
  SWIPE_MEDIA_FILTER_DEFAULT,
  normalizeSwipeMediaFilter,
  readLegacySoloSwipeMediaFilter,
  clearLegacySoloSwipeMediaFilter,
  type SwipeMediaFilter,
} from "@/lib/swipeMediaFilter";
import { setSoloDisplayFilter } from "@/lib/swipeDeckStore";

export type SwipeSettingsState = {
  /** Visa hyr-/köpalternativ på titelkort. */
  showPaidOptions: boolean;
  /** Film/serie-filter för solo-swipe. */
  mediaFilter: SwipeMediaFilter;
  /** Falskt tills första hämtningen svarat — ytor kan då undvika att blinka. */
  ready: boolean;
};

let state: SwipeSettingsState = {
  showPaidOptions: false,
  mediaFilter: SWIPE_MEDIA_FILTER_DEFAULT,
  ready: false,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function setState(patch: Partial<SwipeSettingsState>) {
  state = { ...state, ...patch };
  emit();
}

export function subscribeSwipeSettings(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSwipeSettingsSnapshot(): SwipeSettingsState {
  return state;
}

type SettingsResp = {
  ok: boolean;
  settings?: { showPaidOptions: boolean; mediaFilter: string };
};

let inflight: Promise<void> | null = null;

/**
 * Hämtar inställningarna en gång. Migrerar samtidigt ett ev. kvarvarande
 * localStorage-filter (nw_swipe_media) upp till profilen — filtret låg där
 * innan det flyttades till DB, och ska inte tappas för befintliga användare.
 */
export function loadSwipeSettings(): Promise<void> {
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch("/api/profile/swipe-settings", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as SettingsResp;
      if (!j.ok || !j.settings) return;

      const serverFilter = normalizeSwipeMediaFilter(j.settings.mediaFilter);
      setState({
        showPaidOptions: j.settings.showPaidOptions,
        mediaFilter: serverFilter,
        ready: true,
      });

      const legacy = readLegacySoloSwipeMediaFilter();
      if (legacy && legacy !== SWIPE_MEDIA_FILTER_DEFAULT && serverFilter === SWIPE_MEDIA_FILTER_DEFAULT) {
        // Användaren hade ett val kvar i localStorage och profilen står på default
        // → adoptera det gamla valet istället för att tyst nollställa det.
        await saveSwipeSettings({ mediaFilter: legacy });
      }
      clearLegacySoloSwipeMediaFilter();
    } catch {
      // tyst — defaults gäller
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Optimistisk uppdatering; rullar tillbaka om servern nekar. */
export async function saveSwipeSettings(patch: Partial<Omit<SwipeSettingsState, "ready">>): Promise<boolean> {
  const prev = state;
  setState(patch);

  // Filtra leken direkt (optimistiskt) så pill-bytet känns omedelbart, inte
  // efter round-trippen till /swipe-settings. Rullas tillbaka nedan om servern
  // nekar. Leken hämtas alltid som "båda", så det här är bara en omfiltrering.
  if (patch.mediaFilter && patch.mediaFilter !== prev.mediaFilter) {
    setSoloDisplayFilter(patch.mediaFilter);
  }

  try {
    const res = await fetch("/api/profile/swipe-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setState({ showPaidOptions: prev.showPaidOptions, mediaFilter: prev.mediaFilter });
      setSoloDisplayFilter(prev.mediaFilter);
      return false;
    }
    const j = (await res.json()) as SettingsResp;
    if (!j.ok || !j.settings) {
      setState({ showPaidOptions: prev.showPaidOptions, mediaFilter: prev.mediaFilter });
      setSoloDisplayFilter(prev.mediaFilter);
      return false;
    }
    const nextFilter = normalizeSwipeMediaFilter(j.settings.mediaFilter);
    setState({ showPaidOptions: j.settings.showPaidOptions, mediaFilter: nextFilter });

    // Servern kan ha normaliserat filtret till något annat än vi antog optimistiskt
    // — synka vyn med det bekräftade värdet.
    if (nextFilter !== state.mediaFilter) setSoloDisplayFilter(nextFilter);
    return true;
  } catch {
    setState({ showPaidOptions: prev.showPaidOptions, mediaFilter: prev.mediaFilter });
    setSoloDisplayFilter(prev.mediaFilter); // rulla tillbaka den optimistiska vyn
    return false;
  }
}
