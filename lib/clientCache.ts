// lib/clientCache.ts
//
// EN väg in till localStorage för allt som cachas på klienten.
//
// Bakgrund: `nw_seen_ids` (lib/swipeDeck.ts) var också en klientcache. Den
// saknade utgångsdatum, växte obegränsat och drev isär från servern tills den
// filtrerade bort ALLT innehåll — osynligt i loggarna, eftersom klienten bara
// tyst kastade korten. Mätt mot produktionsdata försvann 34 av 50 respektive
// 50 av 50 kort i klientfiltret innan den fixades.
//
// Därför är två saker inbyggda i API:t i stället för att vara god sed:
//   1. TTL är obligatoriskt. Det går inte att uttrycka en post utan
//      utgångsdatum, så samma bugg kan inte byggas igen.
//   2. CLIENT_CACHE_VERSION sitter i nyckelprefixet. Bumpas den ignoreras och
//      städas allt gammalt vid nästa läsning — nödutgången vi saknade.
//
// CACHA ALDRIG: gruppstate, matchningar, inbjudningar, chatt/threads,
// vänförfrågningar, premium-/billingstatus. De är antingen hela produktpoängen
// eller behörighetsstyrande — en gammal cache där ger fel svar, inte bara ett
// långsammare.
//
// Viktig distinktion: grupp-STATE (medlemmar, röster, matchningar) cachas
// fortfarande aldrig, men grupp-DECKENS kandidater (group_deck_v1:<KOD> i
// lib/swipeDeckStore.ts) får cachas KORT. Kandidater är rekommendationer, inte
// behörighetsstate — ett inaktuellt kort rättas server-side vid rösttillfället,
// och kort TTL begränsar hur länge en gammal gruppsammansättning kan synas.
//
// localStorage och inte @capacitor/preferences med flit: en cache som ITP
// vräker är ofarlig, och samma kod fungerar då på webb och native. Preferences
// är rätt för sessionstoken (app/components/client/SessionPersistence.tsx) just
// för att den INTE får tappas — motsatt krav.

/** Bumpa för att ogiltigförklara allt som ligger i klientcachen. */
export const CLIENT_CACHE_VERSION = 1;

const PREFIX = `nw_cache_v${CLIENT_CACHE_VERSION}:`;
/** Alla prefix vi någonsin använt, för städning av äldre versioner. */
const ANY_VERSION_PREFIX = /^nw_cache_v\d+:/;

type Entry<T> = { v: number; exp: number; data: T };

function available(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/**
 * Städar utgångna poster och allt från äldre cacheversioner. Körs vid
 * quota-fel och när `clearStaleClientCache()` anropas explicit.
 */
function pruneStale(): void {
  if (!available()) return;
  const now = Date.now();
  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !ANY_VERSION_PREFIX.test(key)) continue;
    if (!key.startsWith(PREFIX)) {
      doomed.push(key); // äldre version
      continue;
    }
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "") as Entry<unknown>;
      if (!parsed || typeof parsed.exp !== "number" || parsed.exp <= now) doomed.push(key);
    } catch {
      doomed.push(key);
    }
  }
  for (const key of doomed) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

export function getCached<T>(key: string): T | null {
  if (!available()) return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entry<T>;
    if (!parsed || parsed.v !== CLIENT_CACHE_VERSION || typeof parsed.exp !== "number") {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    if (parsed.exp <= Date.now()) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * `ttlMs` är obligatoriskt — se filhuvudet. Skrivfel är alltid tysta: en cache
 * som inte kan skrivas ska sakta ner appen, aldrig gå sönder.
 */
export function setCached<T>(key: string, data: T, ttlMs: number): void {
  if (!available()) return;
  const entry: Entry<T> = { v: CLIENT_CACHE_VERSION, exp: Date.now() + ttlMs, data };
  const payload = JSON.stringify(entry);
  try {
    localStorage.setItem(PREFIX + key, payload);
  } catch {
    // Troligast QuotaExceededError. Städa utgånget/gammalt och försök en gång
    // till; lyckas det inte heller får posten falla bort.
    pruneStale();
    try {
      localStorage.setItem(PREFIX + key, payload);
    } catch {
      /* ge upp tyst */
    }
  }
}

export function removeCached(key: string): void {
  if (!available()) return;
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/**
 * Tömmer HELA klientcachen. Måste anropas vid utloggning och kontoradering —
 * annars ser nästa person på samma enhet föregående användares watchlist.
 */
export function clearClientCache(): void {
  if (!available()) return;
  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && ANY_VERSION_PREFIX.test(key)) doomed.push(key);
  }
  for (const key of doomed) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

/** Exponerad för appstart: städa utgånget och äldre versioner en gång. */
export function clearStaleClientCache(): void {
  pruneStale();
}
