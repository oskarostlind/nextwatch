// middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 0) Backcompat: rewrite /api/profile/get -> /api/profile
  if (pathname === "/api/profile/get") {
    const url = new URL("/api/profile", req.nextUrl);
    const res = NextResponse.rewrite(url);

    // se till att cookies finns även här
    let uid = req.cookies.get("nw_uid")?.value ?? null;
    const setUid = !uid;
    if (!uid) uid = makeUid();

    const headerRegion = req.headers.get("x-vercel-ip-country") ?? "";
    const region = /^[A-Z]{2}$/.test(headerRegion) ? headerRegion : "SE";
    const locale = pickLocale(req.headers.get("accept-language"), region);

    if (setUid) {
      res.cookies.set("nw_uid", uid, { path: "/", httpOnly: false, sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 365 });
    }
    if (!req.cookies.get("nw_region")) {
      res.cookies.set("nw_region", region, { path: "/", httpOnly: false, sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 365 });
    }
    if (!req.cookies.get("nw_locale")) {
      res.cookies.set("nw_locale", locale, { path: "/", httpOnly: false, sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 365 });
    }
    return res;
  }

  // 1) säkerställ cookies på alla övriga requests
  let uid = req.cookies.get("nw_uid")?.value ?? null;
  const mustSetUid = !uid;
  if (!uid) uid = makeUid();

  const headerRegion = req.headers.get("x-vercel-ip-country") ?? "";
  const region = /^[A-Z]{2}$/.test(headerRegion) ? headerRegion : "SE";
  const locale = pickLocale(req.headers.get("accept-language"), region);

  const mustSetRegion = !req.cookies.get("nw_region");
  const mustSetLocale = !req.cookies.get("nw_locale");

  // 2) Skyddad route: profil-koll sker i layout/page (server component med Prisma), inte här
  const res = NextResponse.next();

  if (mustSetUid) {
    res.cookies.set("nw_uid", uid, { path: "/", httpOnly: false, sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 365 });
  }
  if (mustSetRegion) {
    res.cookies.set("nw_region", region, { path: "/", httpOnly: false, sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 365 });
  }
  if (mustSetLocale) {
    res.cookies.set("nw_locale", locale, { path: "/", httpOnly: false, sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 365 });
  }

  return res;
}

export const config = { matcher: ["/((?!_next/|api/session/init|favicon.ico).*)"] };
