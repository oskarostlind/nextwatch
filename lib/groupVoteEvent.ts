// lib/groupVoteEvent.ts
//
// Explicit signal "en grupp-röst gick in" → OverlayMount snabb-pollar matchen.
// Ersätter den globala window.fetch-monkeypatchen som sniffade vote-POST:ar
// (en wrapper runt varje fetch i hela appen).

export const GROUP_VOTED_EVENT = "nw:group-voted";

export function emitGroupVoted(): void {
  try {
    window.dispatchEvent(new Event(GROUP_VOTED_EVENT));
  } catch {
    /* SSR — irrelevant */
  }
}
