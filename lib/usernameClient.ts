/** Delad klientvalidering — speglar serverns `/api/user/username/*` (a–z, 0–9, _, .). */

export function sanitizeUsernameInput(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_.]/g, "");
}

export function usernameValidOrEmpty(u: string): boolean {
  if (u.length === 0) return true;
  return /^[a-z0-9_.]{3,20}$/.test(u);
}
