import {
  filterSwipeCards,
  mapUnifiedItems,
  markSeen,
  readGroupCodeFromCookie,
  type SwipeCard,
} from "@/lib/swipeDeck";
import { injectAdCards } from "@/lib/ads";
import { type SwipeMediaFilter } from "@/lib/swipeMediaFilter";
import { getCached, removeCached, setCached } from "@/lib/clientCache";

export const PREFETCH_MIN_CARDS = 10;

/**
 * Kortleken sparas mellan appstarter. Utan den kördes hela recs-pipelinen om
 * från noll vid varje kallstart — mätt till ~4 s mot ett riktigt konto
 * (discover-sidor, smakmodell, MMR) — för att i praktiken visa samma lek som
 * förra gången. I native-appen är varje öppning en kallstart, så det var den
 * enskilt dyraste väntan i appen.
 */
const DECK_CACHE_KEY = "solo_deck";
const DECK_TTL_MS = 24 * 60 * 60 * 1000;
/** Skrivningen debouncas så snabb swipning inte hamrar localStorage. */
const DECK_WRITE_DEBOUNCE_MS = 500;

type PersistedDeck = {
  cards: SwipeCard[];
  nextTmdbPage: number;
  mediaFilter: SwipeMediaFilter;
};

let deckWriteTimer: ReturnType<typeof setTimeout> | null = null;

function persistSoloDeckSoon() {
  if (typeof window === "undefined") return;
  if (deckWriteTimer) clearTimeout(deckWriteTimer);
  deckWriteTimer = setTimeout(() => {
    deckWriteTimer = null;
    const s = soloState;
    // Spara HELA leken (båda medietyperna), inte den filtrerade vyn — annars
    // tappas den dolda typen vid omstart. Annonskort hör till en session och
    // ska inte återuppstå ur cachen.
    const cards = s.allCards.filter((c) => c.kind !== "ad");
    if (cards.length === 0) {
      removeCached(DECK_CACHE_KEY);
      return;
    }
    const payload: PersistedDeck = {
      cards,
      nextTmdbPage: s.nextTmdbPage,
      mediaFilter: s.mediaFilter,
    };
    setCached(DECK_CACHE_KEY, payload, DECK_TTL_MS);
  }, DECK_WRITE_DEBOUNCE_MS);
}

function clearPersistedSoloDeck() {
  if (deckWriteTimer) {
    clearTimeout(deckWriteTimer);
    deckWriteTimer = null;
  }
  removeCached(DECK_CACHE_KEY);
}

/**
 * Läser sparad lek vid modulinit — inte i en effekt. En effekt hade gett en
 * bildruta skelett innan korten dök upp, vilket är precis den blinkning det
 * här ska ta bort.
 */
function hydrateSoloDeck(): SoloDeckState {
  const base = emptySolo();
  if (typeof window === "undefined") return base;
  const saved = getCached<PersistedDeck>(DECK_CACHE_KEY);
  if (!saved || !Array.isArray(saved.cards) || saved.cards.length === 0) return base;

  // Allt som swipats sedan leken sparades faller bort här (seen-listan har
  // 24 h TTL sedan regressionsfixen), så ett kort man just gjort sig av med
  // kan inte komma tillbaka.
  const allCards = filterSwipeCards(saved.cards);
  if (allCards.length === 0) return base;

  const mediaFilter = saved.mediaFilter ?? base.mediaFilter;
  return {
    ...base,
    allCards,
    cards: visibleCards(allCards, mediaFilter),
    nextTmdbPage: saved.nextTmdbPage > 0 ? saved.nextTmdbPage : 1,
    mediaFilter,
    ready: true,
  };
}

/** Slår ihop utan dubbletter — hydrerad lek och färskt svar kan överlappa. */
function appendUnique(existing: SwipeCard[], incoming: SwipeCard[]): SwipeCard[] {
  const seen = new Set(existing.map((c) => c.id));
  const extra = incoming.filter((c) => !seen.has(c.id));
  return extra.length === 0 ? existing : [...existing, ...extra];
}

/**
 * Synlig lek = hela leken filtrerad på visningsfiltret. Annonskort visas alltid
 * (de hör inte till en medietyp). Det här är enda stället film/serie-filtret
 * appliceras — därför slipper varje byte en omhämtning.
 */
function visibleCards(all: SwipeCard[], filter: SwipeMediaFilter): SwipeCard[] {
  if (filter === "both") return all;
  return all.filter((c) => c.kind === "ad" || c.mediaType === filter);
}

/**
 * Bygger nästa solo-state och håller `cards` i synk med `allCards`+`mediaFilter`.
 * All mutation går genom den här så den synliga vyn aldrig kan bli inaktuell.
 */
function nextSolo(patch: Partial<SoloDeckState>): SoloDeckState {
  const merged = { ...soloState, ...patch };
  return { ...merged, cards: visibleCards(merged.allCards, merged.mediaFilter) };
}

// Sätts av klienten (SwipeDeckPreloader) efter att premium-status hämtats.
// Endast gratisanvändare med aktiverad annons-flagga får true.
let adsEnabled = false;
export function setSwipeAdsEnabled(enabled: boolean) {
  adsEnabled = enabled;
}
function withAdsMaybe(titles: SwipeCard[], pageKey: string | number): SwipeCard[] {
  return adsEnabled ? injectAdCards(titles, pageKey) : titles;
}

type GroupInfo = { code: string; strictProviders: boolean };

export type SoloDeckState = {
  /**
   * Hela leken, alltid både film och serier (servern hämtar `?all=1`). Detta är
   * det som sparas, prefetchas och muteras.
   */
  allCards: SwipeCard[];
  /**
   * Den synliga leken = `allCards` filtrerad på `mediaFilter`. Det är den här
   * användaren swipar; annonskort visas oavsett filter. Håller page_client
   * oförändrat — det läser bara `cards`.
   */
  cards: SwipeCard[];
  page: number;
  /**
   * TMDB-sida nästa hämtning börjar på, från serverns `nextTmdbPage`. Behövs
   * eftersom skanningsdjupet är rörligt: servern kan ha grävt 3 eller 40 sidor
   * för att fylla den här leken, och `page + 1` skulle då antingen hoppa över
   * titlar eller ge dubbletter.
   */
  nextTmdbPage: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  mode: "group" | "individual";
  group: GroupInfo | null;
  /** Visningsfilter (film/serie/båda). Ändras lokalt utan omhämtning. */
  mediaFilter: SwipeMediaFilter;
  ready: boolean;
};

export type GroupDeckState = {
  cards: SwipeCard[];
  page: number;
  /** TMDB-sida nästa hämtning börjar på (serverns nextTmdbPage). Se solo-motsvarigheten. */
  nextTmdbPage: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  mediaFilter: SwipeMediaFilter;
  ready: boolean;
};

const emptySolo = (): SoloDeckState => ({
  allCards: [],
  cards: [],
  page: 1,
  nextTmdbPage: 1,
  hasMore: true,
  loading: false,
  error: null,
  mode: "individual",
  group: null,
  mediaFilter: "both",
  ready: false,
});

const emptyGroup = (): GroupDeckState => ({
  cards: [],
  page: 1,
  nextTmdbPage: 1,
  hasMore: true,
  loading: false,
  error: null,
  mediaFilter: "both",
  ready: false,
});

const EMPTY_GROUP: GroupDeckState = {
  cards: [],
  page: 1,
  nextTmdbPage: 1,
  hasMore: true,
  loading: false,
  error: null,
  mediaFilter: "both",
  ready: false,
};

let soloState = hydrateSoloDeck();
let groupDecks: Record<string, GroupDeckState> = {};
let soloLoadInFlight = false;
const groupLoadInFlight = new Set<string>();
let backgroundPrefetchEnabled = false;

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeSwipeDeck(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSoloDeckSnapshot(): SoloDeckState {
  return soloState;
}

/**
 * Server-snapshot för useSyncExternalStore. Måste vara en STABIL referens och
 * matcha det servern renderade — annars ser React hydreringen som en mismatch,
 * eftersom klientens snapshot redan innehåller den cachade leken. React gör om
 * renderingen med klientens snapshot direkt efter hydreringen, så korten dyker
 * upp ändå: vinsten är att nätverket hoppas över, inte en bildruta.
 */
const SERVER_SOLO_SNAPSHOT: SoloDeckState = emptySolo();
export function getSoloDeckServerSnapshot(): SoloDeckState {
  return SERVER_SOLO_SNAPSHOT;
}

export function getGroupDeckSnapshot(code: string): GroupDeckState {
  return groupDecks[code.toUpperCase()] ?? EMPTY_GROUP;
}

/**
 * Byter visningsfilter (film/serie/båda) UTAN omhämtning. Leken hämtas alltid
 * som "båda" (soloRecsUrl ?all=1), så ett byte är bara en omfiltrering av det
 * som redan finns. Tidigare kastade det här hela leken och körde om ~4 s
 * recs-pipeline vid varje pill-tryck.
 */
export function setSoloDisplayFilter(filter: SwipeMediaFilter) {
  if (filter === soloState.mediaFilter) return;
  soloState = nextSolo({ mediaFilter: filter });
  emit();
  persistSoloDeckSoon(); // spara vyn så nästa öppning börjar rätt
  // Bytet kan blotta att den valda typen har få kort kvar — fyll på.
  if (backgroundPrefetchEnabled) void maybePrefetchSoloPages();
}

function soloRecsUrl(page: number, fromTmdbPage?: number): string {
  const from = fromTmdbPage && fromTmdbPage > 1 ? `&from=${fromTmdbPage}` : "";
  // all=1: hämta alltid båda medietyperna. Film/serie-filtret appliceras lokalt
  // (visibleCards), så pill-bytet aldrig kastar leken eller kör om pipelinen.
  return `/api/recs/unified?page=${page}&all=1${from}`;
}

export function setSwipeBackgroundPrefetch(enabled: boolean) {
  backgroundPrefetchEnabled = enabled;
  if (enabled) void maybePrefetchSoloPages();
}

function patchSolo(patch: Partial<SoloDeckState>) {
  soloState = nextSolo(patch);
  emit();
}

function setGroupDeck(code: string, patch: Partial<GroupDeckState>) {
  const key = code.toUpperCase();
  groupDecks = {
    ...groupDecks,
    [key]: { ...(groupDecks[key] ?? emptyGroup()), ...patch },
  };
  emit();
}

async function loadSoloPage(targetPage: number, replace: boolean) {
  if (soloLoadInFlight) return;
  soloLoadInFlight = true;
  // replace = börja om från TMDB-sida 1; annars fortsätt där servern slutade.
  const fromTmdbPage = replace ? undefined : soloState.nextTmdbPage;
  if (replace) {
    patchSolo({
      loading: soloState.cards.length === 0,
      error: null,
    });
  }
  try {
    const res = await fetch(soloRecsUrl(targetPage, fromTmdbPage), { cache: "no-store" });
    if (!res.ok) {
      if (replace) patchSolo({ error: "Kunde inte hämta förslag. Försök igen.", hasMore: false, loading: false });
      return;
    }
    const data = (await res.json()) as
      | {
          ok: true;
          mode: "group" | "individual";
          group: GroupInfo | null;
          mediaFilter?: SwipeMediaFilter;
          nextTmdbPage?: number;
          items: Parameters<typeof mapUnifiedItems>[0];
        }
      | { ok: false; message?: string };

    if (!("ok" in data) || !data.ok) {
      if (replace) {
        patchSolo({
          error: ("message" in data && data.message) || "Kunde inte hämta förslag.",
          hasMore: false,
          loading: false,
        });
      }
      return;
    }

    const mapped = withAdsMaybe(mapUnifiedItems(data.items), targetPage);
    soloState = nextSolo({
      allCards: replace ? mapped : appendUnique(soloState.allCards, mapped),
      page: targetPage,
      nextTmdbPage: data.nextTmdbPage ?? soloState.nextTmdbPage + 1,
      // Servern gräver nu upp till 40 TMDB-sidor innan den ger upp, så en tom
      // sida betyder att katalogen faktiskt är slut — inte att fönstret tog slut.
      hasMore: data.items.length > 0 && (data.nextTmdbPage ?? 1) <= 500,
      loading: false,
      error: null,
      mode: data.mode,
      group: data.group,
      // Bara vid replace (första laddning) tas profilens filter som default-vy.
      // En bakgrundsrevalidering ska INTE nollställa användarens pill-val.
      mediaFilter: replace ? data.mediaFilter ?? soloState.mediaFilter : soloState.mediaFilter,
      ready: true,
    });
    emit();
    persistSoloDeckSoon();
    if (backgroundPrefetchEnabled) void maybePrefetchSoloPages();
  } catch {
    if (replace) {
      patchSolo({ error: "Nätverksfel. Kontrollera anslutningen.", hasMore: false, loading: false });
    }
  } finally {
    soloLoadInFlight = false;
  }
}

async function maybePrefetchSoloPages() {
  if (!backgroundPrefetchEnabled) return;
  const s = soloState;
  if (!s.ready || s.loading || soloLoadInFlight) return;
  if (s.cards.length < PREFETCH_MIN_CARDS && s.hasMore) {
    await loadSoloPage(s.page + 1, false);
  }
}

/** Sant tills den hydrerade leken fyllts på en gång. */
let hydratedNeedsRevalidate = soloState.ready && soloState.cards.length > 0;

export async function ensureSoloDeck(opts?: { force?: boolean }) {
  const force = opts?.force ?? false;
  const s = soloState;
  if (!force && s.ready && s.cards.length > 0) {
    // Leken kom ur cachen: visa den direkt, men fyll på i bakgrunden så urvalet
    // inte fastnar på gårdagens kort. `replace = false` gör att påfyllningen
    // läggs underifrån — toppkortet byts aldrig under fingret.
    if (hydratedNeedsRevalidate) {
      hydratedNeedsRevalidate = false;
      void loadSoloPage(s.page + 1, false);
      return;
    }
    if (backgroundPrefetchEnabled && s.cards.length < PREFETCH_MIN_CARDS && s.hasMore) {
      await maybePrefetchSoloPages();
    }
    return;
  }
  if (!force && s.ready && s.loading) return;
  await loadSoloPage(1, true);
}

export async function retrySoloDeck() {
  clearPersistedSoloDeck();
  hydratedNeedsRevalidate = false;
  soloState = nextSolo({ ...emptySolo(), mediaFilter: soloState.mediaFilter });
  emit();
  await loadSoloPage(1, true);
}

export function popSoloCard() {
  // Swipen agerar alltid på översta SYNLIGA kortet. Ta bort just det ur hela
  // leken (id är unikt) — inte allCards[0], som kan vara av den dolda typen.
  const top = soloState.cards[0];
  if (!top) return;
  soloState = nextSolo({ allCards: soloState.allCards.filter((c) => c.id !== top.id) });
  emit();
  persistSoloDeckSoon();
  if (backgroundPrefetchEnabled) void maybePrefetchSoloPages();
}

export function unshiftSoloCard(card: SwipeCard) {
  // Ångra: lägg tillbaka främst. Matchar kortet det aktiva filtret dyker det upp
  // som topp igen; annars ligger det kvar i leken tills filtret släpper fram det.
  soloState = nextSolo({ allCards: [card, ...soloState.allCards.filter((c) => c.id !== card.id)] });
  emit();
  persistSoloDeckSoon();
}

export function updateSoloCards(fn: (cards: SwipeCard[]) => SwipeCard[]) {
  // Berikningen (details/providers) matchar per id, så den körs mot HELA leken —
  // annars skulle ett kort av den dolda typen tappa sin berikning.
  soloState = nextSolo({ allCards: fn(soloState.allCards) });
  emit();
  persistSoloDeckSoon();
}

/**
 * Tar bort en titel ur solo-leken (och cachen) direkt. Anropas när en titel
 * betygsätts från en ANNAN yta än swipen (Betyg-fliken, watchlist, discover):
 * servern exkluderar den vid nästa färska hämtning, men den cachade leken kan
 * fortfarande innehålla den — det var därför nyss betygsatta filmer dök upp i
 * swipe-flödet. No-op om kortet inte finns i leken.
 */
export function dropSoloCard(tmdbId: number, mediaType: SwipeCard["mediaType"]) {
  const id = `${mediaType}_${tmdbId}`;
  if (!soloState.allCards.some((c) => c.id === id)) return;
  soloState = nextSolo({ allCards: soloState.allCards.filter((c) => c.id !== id) });
  emit();
  persistSoloDeckSoon();
}

/**
 * Anropas när en titel betygsätts utanför swipen. Markerar den sedd (så en
 * hydrerad lek filtrerar bort den, 24h TTL — räcker tills en färsk hämtning som
 * exkluderar betygsatta permanent) OCH tar bort den ur den nuvarande leken.
 */
export function markTitleRated(tmdbId: number, mediaType: SwipeCard["mediaType"]) {
  markSeen(`${mediaType}_${tmdbId}`);
  dropSoloCard(tmdbId, mediaType);
}

async function loadGroupPage(key: string, targetPage: number, replace: boolean) {
  if (groupLoadInFlight.has(key)) return;
  groupLoadInFlight.add(key);

  const cur = groupDecks[key] ?? emptyGroup();
  // replace = börja om från TMDB-sida 1; annars fortsätt där servern slutade.
  const fromTmdbPage = replace ? undefined : cur.nextTmdbPage;
  const from = fromTmdbPage && fromTmdbPage > 1 ? `&from=${fromTmdbPage}` : "";
  if (replace) setGroupDeck(key, { loading: cur.cards.length === 0, error: null });

  try {
    // Gruppdäcket kör samma recommender som solo, men i gruppläge (?group=CODE):
    // providers unioneras och smakmodellen aggregeras över alla medlemmar.
    const res = await fetch(
      `/api/recs/unified?group=${encodeURIComponent(key)}&page=${targetPage}${from}`,
      { cache: "no-store" }
    );
    const data = (await res.json()) as
      | {
          ok: true;
          mediaFilter?: SwipeMediaFilter;
          nextTmdbPage?: number;
          items: Parameters<typeof mapUnifiedItems>[0];
        }
      | { ok: false; message?: string };

    if (!("ok" in data) || !data.ok) {
      if (replace) {
        setGroupDeck(key, {
          loading: false,
          error: ("message" in data && data.message) || "Kunde inte hämta gruppförslag.",
          ready: true,
        });
      }
      return;
    }

    const mapped = mapUnifiedItems(data.items);
    const prev = groupDecks[key] ?? emptyGroup();
    setGroupDeck(key, {
      cards: replace ? mapped : appendUnique(prev.cards, mapped),
      page: targetPage,
      nextTmdbPage: data.nextTmdbPage ?? prev.nextTmdbPage + 1,
      hasMore: data.items.length > 0 && (data.nextTmdbPage ?? 1) <= 500,
      loading: false,
      error: null,
      mediaFilter: replace ? data.mediaFilter ?? prev.mediaFilter : prev.mediaFilter,
      ready: true,
    });
  } catch {
    if (replace) setGroupDeck(key, { loading: false, error: "Nätverksfel.", ready: true });
  } finally {
    groupLoadInFlight.delete(key);
  }
}

export async function ensureGroupDeck(code: string, opts?: { force?: boolean }) {
  const key = code.toUpperCase();
  if (!key) return;
  const existing = groupDecks[key];
  if (!opts?.force && existing?.ready && existing.cards.length > 0) return;
  await loadGroupPage(key, 1, true);
}

/** Fyll på gruppdäcket underifrån när det börjar ta slut (samma tröskel som solo). */
function maybePrefetchGroupPages(key: string) {
  const s = groupDecks[key];
  if (!s || !s.ready || s.loading || groupLoadInFlight.has(key)) return;
  if (s.cards.length < PREFETCH_MIN_CARDS && s.hasMore) {
    void loadGroupPage(key, s.page + 1, false);
  }
}

export function popGroupCard(code: string) {
  const key = code.toUpperCase();
  const cur = groupDecks[key] ?? emptyGroup();
  setGroupDeck(key, { cards: cur.cards.slice(1) });
  // Toppkortet lämnade — fyll på i bakgrunden så leken inte tar slut mitt i.
  maybePrefetchGroupPages(key);
}

export function unshiftGroupCard(code: string, card: SwipeCard) {
  const key = code.toUpperCase();
  const cur = groupDecks[key] ?? emptyGroup();
  setGroupDeck(key, { cards: [card, ...cur.cards] });
}

export function updateGroupCards(code: string, fn: (cards: SwipeCard[]) => SwipeCard[]) {
  const key = code.toUpperCase();
  const cur = groupDecks[key] ?? emptyGroup();
  setGroupDeck(key, { cards: fn(cur.cards) });
}

/** Förladda första sidan när appen startar — körs in idle time, inte på kritisk väg. */
export function preloadSwipeDecksIdle() {
  const run = () => {
    void ensureSoloDeck();
    const code = readGroupCodeFromCookie();
    if (code) void ensureGroupDeck(code);
  };
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(run, { timeout: 3000 });
  } else {
    setTimeout(run, 500);
  }
}

export function preloadGroupDeckIfJoined() {
  const code = readGroupCodeFromCookie();
  if (code) void ensureGroupDeck(code);
}