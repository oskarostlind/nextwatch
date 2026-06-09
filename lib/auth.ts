// lib/auth.ts
import { NextResponse, type NextRequest } from 'next/server';
import { sessionCookieOpts } from './cookies';

const ONE_YEAR = 60 * 60 * 24 * 365;
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export { sessionCookieOpts } from './cookies';

export function attachSessionCookies(
  res: NextResponse,
  uid: string,
  opts?: { remember?: boolean }
) {
  // remember=true (eller default) → 1 år så samma enhet (t.ex. iOS) slipper logga in om och om igen.
  const maxAge = opts?.remember === false ? THIRTY_DAYS : ONE_YEAR;

  res.cookies.set('nw_uid', uid, sessionCookieOpts(maxAge, true));

  res.cookies.set('nw_last', String(Date.now()), sessionCookieOpts(60 * 5, true));

  return res;
}

export function sessionRedirect(
  target: string | URL,
  uid: string,
  req?: NextRequest,
  opts?: { remember?: boolean }
) {
  const url =
    target instanceof URL
      ? target
      : target.startsWith('http')
      ? new URL(target)
      : new URL(
          target,
          req?.url ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
        );

  const res = NextResponse.redirect(url);
  return attachSessionCookies(res, uid, opts);
}

export function touchLastSeen(res: NextResponse) {
  res.cookies.set('nw_last', String(Date.now()), sessionCookieOpts(60 * 5, true));
  return res;
}

export function clearAuthCookies(res: NextResponse) {
  res.cookies.set('nw_uid', '', sessionCookieOpts(0, true));
  res.cookies.set('nw_last', '', sessionCookieOpts(0, true));
  return res;
}

/** Backwards-compat alias (så att befintliga imports fortsätter fungera) */
export const setAuthCookies = attachSessionCookies;
