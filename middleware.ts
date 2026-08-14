// middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { signUid, verifyUid } from "@/lib/session";
import { LANG_COOKIE, localeFromAcceptLanguage } from "@/lib/i18nConfig";

function makeUid(): string {
  const c = crypto as Crypto & { randomUUID?: () => string };
  return typeof c.randomUUID === "function"
    ? c.randomUUID()
    : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
function pickLocale(acceptLang: string | null, region: string): string {
  const first = (acceptLang ?? "").split(",")[0]?.trim() ?? "";
  if (/^[a-z]{2}(-[A-Z]{2})?$/.test(first)) return first.includes("-") ? first : `${first}-${region}`;
  return "sv-SE";
}

// nw_uid sätts httpOnly:false eftersom klienten (userGuide.hasAuthCookie) bara
// kollar att cookien FINNS, aldrig läser id:t. Signaturen — inte httpOnly —
// är det som stoppar förfalskning.
const UID_COOKIE = { path: "/", httpOnly: false, sameSite: "lax" as const, secure: true, maxAge: 60 * 60 * 24 * 365 };
const FLAG_COOKIE = { path: "/", httpOnly: false, sameSite: "lax" as const, secure: true, maxAge: 60 * 60 * 24 * 365 };

let warnedNoSecret = false;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 0) Debug-routes får aldrig svara i produktion. De läcker env/tokens, kör
  //    DDL mot databasen (debug/db?fix=1) och SMTP-verifieringar. Sätt
  //    ENABLE_DEBUG_ROUTES=1 om de behövs tillfälligt i ett prod-liknande läge.
  if (
    pathname.startsWith("/api/debug") &&
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_DEBUG_ROUTES !== "1"
  ) {
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }

  // 1) Verifiera identitetscookien. Giltig signatur → lita på uid. Saknad,
  //    osignerad (gammal cookie) eller förfalskad → mynta en ny anonym identitet.
  const rawUid = req.cookies.get("nw_uid")?.value ?? null;
  let uid = await verifyUid(rawUid);
  let signedToSet: string | null = null;
  // Rullande förnyelse: en giltig cookie fick tidigare ALDRIG ny maxAge — dess
  // klocka frystes vid inloggningen. Re-stampa samma signerade värde med färsk
  // livslängd, throttlat via nw_last (5 min maxAge) så vi inte skickar
  // Set-Cookie på varje request.
  let renewValid = false;
  if (uid && rawUid && !req.cookies.get("nw_last")) {
    renewValid = true;
  }
  if (!uid) {
    uid = makeUid();
    try {
      signedToSet = await signUid(uid);
    } catch {
      // Felkonfigurerad hemlighet: degradera till osignerat värde så att sajten
      // fortsätter fungera i stället för att 500:a varje request. Loggas en gång.
      if (!warnedNoSecret) {
        warnedNoSecret = true;
        console.warn("[middleware] Kan inte signera session – SESSION_SECRET/NEXTAUTH_SECRET saknas.");
      }
      signedToSet = uid;
    }
  }

  // Normalisera det som nedströms route handlers/server components läser via
  // cookies(): de ska alltid se det verifierade bare-uid:t, aldrig "<uid>.<sig>".
  req.cookies.set("nw_uid", uid);

  // Router-prefetch (Link prefetch / <Link> vid idle): prefetch-svar ska inte
  // rotera cookies — de kan komma i bursts och racea med riktiga navigeringar.
  // Verifiering/normalisering ovan och signedToSet nedan körs alltid ändå.
  const isPrefetch =
    req.headers.get("next-router-prefetch") === "1" || req.headers.get("purpose") === "prefetch";

  const headerRegion = req.headers.get("x-vercel-ip-country") ?? "";
  const region = /^[A-Z]{2}$/.test(headerRegion) ? headerRegion : "SE";
  const locale = pickLocale(req.headers.get("accept-language"), region);
  const mustSetRegion = !req.cookies.get("nw_region");
  const mustSetLocale = !req.cookies.get("nw_locale");

  // Gränssnittsspråket (nw_lang) är skilt från nw_locale: nw_locale beskriver
  // var användaren är (SE, formatering, TMDB-region), nw_lang vilket språk
  // appen ska tala. Vi gissar bara en gång, från Accept-Language — därefter
  // äger profilens språkväljare cookien och middleware rör den aldrig igen.
  const uiLang = localeFromAcceptLanguage(req.headers.get("accept-language"));
  const mustSetLang = !req.cookies.get(LANG_COOKIE);
  if (mustSetLang) {
    // Sätts på request-cookies också, så att i18n/request.ts ser rätt språk
    // redan under den här renderingen i stället för först vid nästa navigering.
    req.cookies.set(LANG_COOKIE, uiLang);
  }

  // Backcompat: rewrite /api/profile/get -> /api/profile (med normaliserade cookies).
  const res =
    pathname === "/api/profile/get"
      ? NextResponse.rewrite(new URL("/api/profile", req.nextUrl), { request: { headers: req.headers } })
      : NextResponse.next({ request: { headers: req.headers } });

  if (signedToSet) {
    res.cookies.set("nw_uid", signedToSet, UID_COOKIE);
  } else if (renewValid && rawUid && !isPrefetch) {
    // Samma redan-signerade värde, bara färsk maxAge. UID_COOKIE:s
    // httpOnly:false med flit (samma resonemang som för anonyma, rad 18-20):
    // hasAuthCookie() behöver se att cookien finns, och signaturen — inte
    // httpOnly — är förfalskningsskyddet.
    res.cookies.set("nw_uid", rawUid, UID_COOKIE);
    res.cookies.set("nw_last", String(Date.now()), { ...UID_COOKIE, httpOnly: true, maxAge: 60 * 5 });
  }
  if (mustSetRegion && !isPrefetch) {
    res.cookies.set("nw_region", region, FLAG_COOKIE);
  }
  if (mustSetLocale && !isPrefetch) {
    res.cookies.set("nw_locale", locale, FLAG_COOKIE);
  }
  if (mustSetLang && !isPrefetch) {
    res.cookies.set(LANG_COOKIE, uiLang, FLAG_COOKIE);
  }

  return res;
}

// session/restore undantas likt session/init: när cookien är helt borta skulle
// middleware annars mynta en anonym nw_uid på SAMMA svar som restore sätter den
// återställda — två Set-Cookie för samma namn, och fel kan vinna.
// Statiska assets (bilder/ikoner/manifest m.m.) behöver ingen cookie-logik —
// hoppa över dem via filändelse så middleware inte kör på varje asset-request.
export const config = {
  matcher: [
    "/((?!_next/|api/session/init|api/session/restore|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webmanifest|txt|xml)$).*)",
  ],
};
