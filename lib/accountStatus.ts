// lib/accountStatus.ts
//
// Klientsidans svar på "är den här användaren en gäst?" — dvs. saknar kontot
// både lösenord och Apple-koppling (samma definition som hasAccount i
// app/api/profile/status). Används av gästkonverterings-ytorna: kortet i
// profilen, SignupNudge och varningen vid utloggning.
//
// Kort minnescache (30 s) så att flera ytor på samma skärm inte gör varsitt
// anrop — men kort nog för att en nyss registrerad användare inte ska få en
// gäst-prompt efter en SPA-navigering (registreringen byter inte sida hårt).

export type AccountStatus = {
  /** Det finns en profil (gäst eller riktig). Utan profil visas inga gäst-ytor. */
  hasProfile: boolean;
  /** Lösenord eller Apple är kopplat. */
  hasAccount: boolean;
};

const TTL_MS = 30_000;
let cached: { at: number; value: Promise<AccountStatus | null> } | null = null;

export function getAccountStatus(): Promise<AccountStatus | null> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;
  // Timeout så att ett hängande anrop aldrig låser en köpknapp (se
  // ensureAccountBeforePremium i lib/signupNudge.ts).
  const value = fetch("/api/profile/status", { cache: "no-store", signal: AbortSignal.timeout(5000) })
    .then((res) => (res.ok ? res.json() : null))
    .then((j: { hasProfile?: boolean; hasAccount?: boolean } | null) =>
      j ? { hasProfile: Boolean(j.hasProfile), hasAccount: Boolean(j.hasAccount) } : null,
    )
    .catch(() => null);
  cached = { at: now, value };
  return value;
}

/**
 * true = gäst med profil (ska se konverterings-ytor). Vid nätverksfel eller
 * okänd status returneras false — hellre ingen prompt än en felaktig.
 */
export async function isGuest(): Promise<boolean> {
  const s = await getAccountStatus();
  return Boolean(s && s.hasProfile && !s.hasAccount);
}

export function invalidateAccountStatus(): void {
  cached = null;
}
