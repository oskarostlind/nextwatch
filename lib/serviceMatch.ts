// lib/serviceMatch.ts
//
// Matchar TMDB:s tjänstenamn mot användarens (profilens) tjänster. Delas av
// swipe-korten (klient) och bevakningscronen (server) så att "finns på dina
// tjänster" betyder samma sak överallt. Import-fri med flit — körs i båda
// miljöerna.

/**
 * TMDB:s namn ("Disney Plus", "Amazon Prime Video", "HBO Max",
 * "Netflix basic with Ads") normaliseras mot profilens ("Disney+", "Prime
 * Video", "Max").
 */
export function normService(n: string): string {
  return n
    .toLowerCase()
    .replace(/\+/g, "plus")
    .replace(/[^a-z0-9]/g, "")
    .replace(/^amazon/, "")
    .replace(/^hbomax$/, "max")
    .replace(/(basic|standard)?withads$/, "");
}

/**
 * Vilken av `services` någon av `providerNames` motsvarar, eller null.
 * Returnerar namnet så som det står i `services`.
 */
export function matchService(providerNames: string[], services: string[]): string | null {
  if (providerNames.length === 0 || services.length === 0) return null;
  const mine = services.map((s) => ({ name: s, n: normService(s) })).filter((s) => s.n);
  for (const name of providerNames) {
    const fn = normService(name);
    if (!fn) continue;
    const hit = mine.find((m) => fn === m.n || fn.startsWith(m.n) || m.n.startsWith(fn));
    if (hit) return hit.name;
  }
  return null;
}
