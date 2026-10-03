// lib/acquisition.ts
//
// Varifrån kom användaren? Första-beröring-attribution för webb och app.
//
// Medvetet import-fri (samma skäl som lib/cookies.ts och lib/i18nConfig.ts):
// filen läses både av middleware (edge) och av route handlers (node).
//
// Flöde:
//   1. middleware.ts: första sidvisningen utan `nw_src` → classifyVisit() på
//      URL, referrer och user agent → cookie `nw_src` (180 dagar, httpOnly)
//      + flaggan `nw_src_new` (läsbar för klienten).
//   2. AcquisitionBeacon (klient, i layouten) ser flaggan och postar en gång
//      till /api/track/visit → en rad i acquisition_visits. Crawlers kör inte
//      JS, så de räknas inte som besök.
//   3. När ett användarkonto skapas/identifieras stämplas källan på users.acq_*
//      (stampAcquisition i lib/acquisitionServer.ts) — bara om den saknas, så
//      det förblir första beröringen.
//
// Meta skickar `fbclid` på alla länkklick (annons som organiskt) och
// Instagram/Facebook-webbläsaren har egna UA-token, så Meta-trafik känns igen
// även när annonsen saknar UTM-taggar. Lägg ändå gärna till URL-parametrar i
// Ads Manager: utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}
// &utm_content={{ad.name}} — då syns kampanj och annons per användare.

export const ACQ_COOKIE = "nw_src";
export const ACQ_NEW_FLAG = "nw_src_new";
export const ACQ_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

export type Acquisition = {
  /** meta | google | tiktok | search | x | linkedin | ios_app | referral | direct | <utm_source> */
  source: string;
  /** paid | social | organic | inapp | referral | none | <utm_medium> */
  medium: string;
  campaign: string | null;
  content: string | null;
  /** Hostnamn på referrern, utan www. */
  referrer: string | null;
  /** Första sidan (path, utan query). */
  landing: string;
  /** ISO-tid för första besöket. */
  at: string;
};

const META_SOURCES = new Set(["meta", "facebook", "fb", "instagram", "ig", "an", "audience_network", "messenger", "threads"]);
const OWN_HOSTS = /(^|\.)nextwatch\.se$|\.vercel\.app$|^localhost$/;

function clean(v: string | null | undefined, max = 120): string | null {
  if (!v) return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

function hostOf(ref: string | null): string | null {
  if (!ref) return null;
  try {
    return new URL(ref).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Meta-appens inbyggda webbläsare (Facebook, Messenger, Instagram). */
export function isMetaInAppUA(ua: string): boolean {
  return /FBAN|FBAV|FB_IAB|FBIOS|Instagram/.test(ua);
}

/**
 * Vår egen iOS-app: Capacitor laddar www.nextwatch.se i en WKWebView, vars UA
 * saknar "Safari/" men inte är någon av de kända in-app-webbläsarna.
 */
function isOwnIosAppUA(ua: string): boolean {
  return /iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua) && !isMetaInAppUA(ua) && !/GSA\/|CriOS|FxiOS|EdgiOS|Snapchat|musical_ly|BytedanceWebview|LinkedInApp|Pinterest/.test(ua);
}

export function classifyVisit(input: {
  url: URL;
  referrer: string | null;
  userAgent: string;
  now?: Date;
}): Acquisition {
  const p = input.url.searchParams;
  const ua = input.userAgent || "";
  const refHost = hostOf(input.referrer);
  const externalRef = refHost && !OWN_HOSTS.test(refHost) ? refHost : null;

  const utmSource = clean(p.get("utm_source"), 60)?.toLowerCase() ?? null;
  const utmMedium = clean(p.get("utm_medium"), 60)?.toLowerCase() ?? null;

  let source: string;
  let medium: string;

  if (utmSource) {
    source = META_SOURCES.has(utmSource) ? "meta" : utmSource.replace(/[^a-z0-9_.-]/g, "").slice(0, 40) || "other";
    medium = utmMedium ?? (p.get("fbclid") || p.get("gclid") ? "paid" : "unknown");
  } else if (p.get("fbclid")) {
    // Både annonser och organiska länkar på Facebook/Instagram får fbclid.
    source = "meta";
    medium = "social";
  } else if (p.get("gclid") || p.get("gbraid") || p.get("wbraid")) {
    source = "google";
    medium = "paid";
  } else if (p.get("ttclid")) {
    source = "tiktok";
    medium = "paid";
  } else if (isMetaInAppUA(ua)) {
    source = "meta";
    medium = "inapp";
  } else if (externalRef) {
    if (/(^|\.)(facebook|instagram|messenger|threads)\.(com|net)$|^l\.facebook\.com$|^lm\.facebook\.com$/.test(externalRef)) {
      source = "meta";
      medium = "social";
    } else if (/(^|\.)google\./.test(externalRef)) {
      source = "google";
      medium = "organic";
    } else if (/(^|\.)(bing\.com|duckduckgo\.com|ecosia\.org|yahoo\.com|startpage\.com)$/.test(externalRef)) {
      source = "search";
      medium = "organic";
    } else if (/(^|\.)(t\.co|x\.com|twitter\.com)$/.test(externalRef)) {
      source = "x";
      medium = "social";
    } else if (/(^|\.)tiktok\.com$/.test(externalRef)) {
      source = "tiktok";
      medium = "social";
    } else if (/(^|\.)(linkedin\.com|lnkd\.in)$/.test(externalRef)) {
      source = "linkedin";
      medium = "social";
    } else if (/(^|\.)apps\.apple\.com$/.test(externalRef)) {
      source = "app_store";
      medium = "referral";
    } else {
      source = "referral";
      medium = "referral";
    }
  } else if (isOwnIosAppUA(ua)) {
    // Installerat via App Store. Vilken annons/sökning som gav installationen
    // syns bara aggregerat (App Store Connect-kampanjkoder, Metas SKAdNetwork).
    source = "ios_app";
    medium = "app";
  } else {
    source = "direct";
    medium = "none";
  }

  return {
    source,
    medium: medium.replace(/[^a-z0-9_.-]/g, "").slice(0, 40) || "unknown",
    campaign: clean(p.get("utm_campaign")),
    content: clean(p.get("utm_content")),
    referrer: externalRef,
    landing: input.url.pathname.slice(0, 200),
    at: (input.now ?? new Date()).toISOString(),
  };
}

export function encodeAcquisition(a: Acquisition): string {
  return encodeURIComponent(JSON.stringify(a));
}

export function decodeAcquisition(raw: string | null | undefined): Acquisition | null {
  if (!raw) return null;
  try {
    let s = raw;
    // Cookievärdet kan komma URL-kodat en eller två gånger beroende på väg.
    for (let i = 0; i < 3 && s.startsWith("%"); i++) s = decodeURIComponent(s);
    const o = JSON.parse(s) as Partial<Acquisition>;
    if (!o || typeof o.source !== "string") return null;
    return {
      source: String(o.source).slice(0, 40),
      medium: typeof o.medium === "string" ? o.medium.slice(0, 40) : "unknown",
      campaign: typeof o.campaign === "string" ? o.campaign.slice(0, 120) : null,
      content: typeof o.content === "string" ? o.content.slice(0, 120) : null,
      referrer: typeof o.referrer === "string" ? o.referrer.slice(0, 120) : null,
      landing: typeof o.landing === "string" ? o.landing.slice(0, 200) : "/",
      at: typeof o.at === "string" ? o.at : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Svensk etikett till admin-vyn. */
export function acquisitionLabel(source: string | null | undefined): string {
  switch (source) {
    case "meta":
      return "Meta (FB/IG)";
    case "google":
      return "Google";
    case "search":
      return "Annan sökmotor";
    case "ios_app":
      return "iOS-appen";
    case "app_store":
      return "App Store-sidan";
    case "direct":
      return "Direkt";
    case "referral":
      return "Annan sajt";
    case "tiktok":
      return "TikTok";
    case "x":
      return "X";
    case "linkedin":
      return "LinkedIn";
    case null:
    case undefined:
    case "":
      return "Okänd";
    default:
      return source;
  }
}
