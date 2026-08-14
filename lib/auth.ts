// lib/auth.ts
import { NextResponse, type NextRequest } from 'next/server';
import { sessionCookieOpts } from './cookies';
import { signUid } from './session';
import { LANG_COOKIE, LANG_COOKIE_OPTS, normalizeLocale } from './i18nConfig';

const ONE_YEAR = 60 * 60 * 24 * 365;
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export { sessionCookieOpts } from './cookies';

export async function attachSessionCookies(
  res: NextResponse,
  uid: string,
  opts?: { remember?: boolean }
) {
  // remember=true (eller default) → 1 år så samma enhet (t.ex. iOS) slipper logga in om och om igen.
  const maxAge = opts?.remember === false ? THIRTY_DAYS : ONE_YEAR;

  // Signerat värde: routes verifierar signaturen, så en förfalskad cookie duger inte.
  res.cookies.set('nw_uid', await signUid(uid), sessionCookieOpts(maxAge, true));

  res.cookies.set('nw_last', String(Date.now()), sessionCookieOpts(60 * 5, true));

  return res;
}

export async function sessionRedirect(
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

/**
 * Sätter gränssnittsspråket från kontot vid inloggning.
 *
 * Utan det här skulle en användare som valt engelska mötas av svenska när hen
 * loggar in på en ny enhet: nw_lang gissas då ur Accept-Language och kontots
 * sparade val hade inte fått något genomslag förrän hen råkade öppna
 * profilsidan.
 */
export function attachUiLanguageCookie(res: NextResponse, uiLanguage: unknown) {
  res.cookies.set(LANG_COOKIE, normalizeLocale(uiLanguage), LANG_COOKIE_OPTS);
  return res;
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
