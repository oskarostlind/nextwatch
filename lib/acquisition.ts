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
// Ads Manager: utm_source={{site_source_name}}&utm_medium=paid
// &utm_campaign={{campaign.name}}&utm_content={{ad.name}} — {{site_source_name}}
// blir fb/ig/msg/an, så Instagram och Facebook skiljs åt även för annonser.
//
// 2026-10-15: "Meta" delas upp.
//   - source = instagram | facebook | meta (Meta, men okänt vilken app).
//     Avgörs i tur och ordning av utm_source (ig/instagram resp. fb/facebook/
//     msg/messenger), in-app-webbläsarens UA ("Instagram" resp. FBAN/FBAV/…)
//     och referrern (l.instagram.com / l.facebook.com, m.facebook.com, fb.me …).
//   - medium för Meta = paid | organic | unknown. Betald = utm_medium
//     paid/cpc/ads/… eller fbclid + UTM-taggar (Ads Manager-parametrar).
//     Bara fbclid utan UTM = unknown — Meta sätter fbclid på både annonser och
//     organiska länkar.
//   - Vår egen app är inte längre en "källa": source = "app", medium = ios |
//     android. Plattformen är en egen dimension (platformOf), och var
//     installationen kom ifrån syns i /admin → App Store-källor (App Store
//     Connect-kampanjkoder, lib/asc/).
//   - Gamla rader (source "meta"/"ios_app") skrivs inte om — de klassas om vid
//     läsning i normalizeAcquisition().

export const ACQ_COOKIE = "nw_src";
export const ACQ_NEW_FLAG = "nw_src_new";
export const ACQ_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

export type Acquisition = {
  /**
   * instagram | facebook | meta | google | tiktok | search | x | linkedin |
   * app | app_store | referral | direct | <utm_source>.
   * Äldre rader kan ha "meta" (före uppdelningen) och "ios_app".
   */
  source: string;
  /**
   * Meta: paid | organic | unknown. App: ios | android. Annars paid | social |
   * organic | referral | none | <utm_medium>. Äldre Meta-rader: social | inapp.
   */
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

const META_SOURCES = new Set([
  "meta",
  "facebook",
  "fb",
  "instagram",
  "ig",
  "an",
  "audience_network",
  "messenger",
  "msg",
  "threads",
]);
const IG_UTM = new Set(["instagram", "ig"]);
const FB_UTM = new Set(["facebook", "fb", "messenger", "msg"]);
/** utm_medium-värden som betyder betald trafik. */
const PAID_MEDIUMS = new Set(["paid", "cpc", "ppc", "cpm", "ads", "ad", "paid_social", "paidsocial", "paid-social", "sponsored"]);

export type MetaApp = "instagram" | "facebook";
/** Betald/organisk — null när det inte är tillämpligt (direkt, appen). */
export type PaidKind = "paid" | "organic" | "unknown";
export type AcqPlatform = "web" | "ios_app" | "android_app";
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
  return metaAppFromUA(ua) !== null;
}

/**
 * Vilken Meta-app en in-app-webbläsare tillhör. Instagram kollas först:
 * dess UA innehåller "Instagram <version>", Facebook/Messenger har FBAN/FBAV/
 * FB_IAB/FBIOS (Messenger dessutom "MessengerForiOS"/"Orca-Android").
 */
export function metaAppFromUA(ua: string): MetaApp | null {
  if (!ua) return null;
  if (/\bInstagram\b/.test(ua)) return "instagram";
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A|MessengerForiOS|Orca-Android/.test(ua)) return "facebook";
  return null;
}

/** Vilken Meta-app en referrer-värd tillhör (utan www.). */
export function metaAppFromHost(host: string | null | undefined): MetaApp | null {
  if (!host) return null;
  const h = host.toLowerCase().replace(/^www\./, "");
  if (/(^|\.)instagram\.com$/.test(h)) return "instagram";
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/.test(h)) return "facebook";
  return null;
}

function isMetaHost(host: string): boolean {
  return metaAppFromHost(host) !== null || /(^|\.)threads\.(net|com)$/.test(host);
}

/** Egna Android-appen — capacitor.config.ts lägger till "NextWatchAndroid" i UA:n. */
function isOwnAndroidAppUA(ua: string): boolean {
  return /NextWatchAndroid/.test(ua);
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
  const hasUtm = Boolean(utmSource || utmMedium || p.get("utm_campaign"));
  const fbclid = Boolean(p.get("fbclid"));

  /** Meta-besök: vilken app (utm → UA → referrer) och betald/organisk. */
  const meta = (): { source: string; medium: string } => {
    const app: MetaApp | null =
      (utmSource && IG_UTM.has(utmSource) ? "instagram" : utmSource && FB_UTM.has(utmSource) ? "facebook" : null) ??
      metaAppFromUA(ua) ??
      metaAppFromHost(externalRef);
    let medium: PaidKind;
    if (utmMedium && (PAID_MEDIUMS.has(utmMedium) || utmMedium.includes("paid"))) medium = "paid";
    else if (fbclid && hasUtm) medium = "paid";
    else if (hasUtm) medium = "organic";
    else if (fbclid) medium = "unknown";
    else medium = "organic";
    return { source: app ?? "meta", medium };
  };

  let source: string;
  let medium: string;

  if (utmSource) {
    if (META_SOURCES.has(utmSource)) {
      ({ source, medium } = meta());
    } else {
      source = utmSource.replace(/[^a-z0-9_.-]/g, "").slice(0, 40) || "other";
      medium = utmMedium ?? (p.get("fbclid") || p.get("gclid") ? "paid" : "unknown");
    }
  } else if (fbclid) {
    // Både annonser och organiska länkar på Facebook/Instagram får fbclid.
    ({ source, medium } = meta());
  } else if (p.get("gclid") || p.get("gbraid") || p.get("wbraid")) {
    source = "google";
    medium = "paid";
  } else if (p.get("ttclid")) {
    source = "tiktok";
    medium = "paid";
  } else if (isMetaInAppUA(ua)) {
    ({ source, medium } = meta());
  } else if (externalRef) {
    if (isMetaHost(externalRef)) {
      ({ source, medium } = meta());
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
  } else if (isOwnAndroidAppUA(ua)) {
    // Första öppningen i Android-appen. Källan till installationen syns inte
    // här (Play Console).
    source = "app";
    medium = "android";
  } else if (isOwnIosAppUA(ua)) {
    // Installerat via App Store. Vilken annons/kampanjlänk som gav
    // installationen syns bara aggregerat — se /admin → App Store-källor.
    source = "app";
    medium = "ios";
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

/** Plattformen som egen dimension (inte källa). Gäller både nya och gamla rader. */
export function platformOf(source: string | null | undefined, medium: string | null | undefined): AcqPlatform {
  if (source === "ios_app") return "ios_app";
  if (source === "app") return medium === "android" ? "android_app" : "ios_app";
  return "web";
}

export function isMetaChannel(source: string | null | undefined): boolean {
  return source === "instagram" || source === "facebook" || source === "meta";
}

export type NormalizedAcquisition = {
  /** Kanal efter omklassning: instagram | facebook | meta | app | google | … | null (okänd). */
  channel: string | null;
  /** Betald/organisk, null när det inte är tillämpligt. */
  paid: PaidKind | null;
  platform: AcqPlatform;
};

/**
 * Klassar om en lagrad rad (acquisition_visits eller users.acq_*) vid
 * läsning. Gamla rader skrevs med source "meta" (FB och IG ihop) och
 * "ios_app"; de mappas till dagens modell utan att databasen skrivs om.
 * Användaragenten sparades aldrig, så för gamla Meta-rader avgör bara
 * referrern Instagram/Facebook — saknas den blir det "meta" (okänd app).
 */
export function normalizeAcquisition(row: {
  source: string | null | undefined;
  medium: string | null | undefined;
  referrer?: string | null;
}): NormalizedAcquisition {
  const source = row.source || null;
  const medium = (row.medium || "").toLowerCase();
  const platform = platformOf(source, medium);

  if (!source) return { channel: null, paid: null, platform };
  if (source === "ios_app" || source === "app") return { channel: "app", paid: null, platform };

  if (isMetaChannel(source)) {
    const channel = source === "meta" ? (metaAppFromHost(row.referrer) ?? "meta") : source;
    let paid: PaidKind;
    if (medium === "paid" || PAID_MEDIUMS.has(medium) || medium.includes("paid")) paid = "paid";
    // "inapp" (gammal) = Meta-webbläsare utan fbclid och utan UTM → inte en annons.
    else if (medium === "organic" || medium === "inapp") paid = "organic";
    // "social" (gammal) = fbclid ELLER bara referrer — går inte att skilja i efterhand.
    else if (medium === "social" || medium === "unknown" || !medium) paid = "unknown";
    // Övriga utm_medium-värden (story, bio …) = egna organiska länkar.
    else paid = "organic";
    return { channel, paid, platform };
  }

  if (source === "direct") return { channel: source, paid: null, platform };
  let paid: PaidKind;
  if (PAID_MEDIUMS.has(medium) || medium.includes("paid")) paid = "paid";
  else if (medium === "unknown" || !medium) paid = "unknown";
  else paid = "organic";
  return { channel: source, paid, platform };
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

export function platformLabel(p: AcqPlatform): string {
  return p === "ios_app" ? "iOS-appen" : p === "android_app" ? "Android-appen" : "Webben";
}

export function paidLabel(p: PaidKind | null): string {
  return p === "paid" ? "Betald" : p === "organic" ? "Organisk" : p === "unknown" ? "Okänt" : "—";
}

/** Svensk etikett till admin-vyn. */
export function acquisitionLabel(source: string | null | undefined): string {
  switch (source) {
    case "instagram":
      return "Instagram";
    case "facebook":
      return "Facebook";
    case "meta":
      return "Meta (okänd app)";
    case "app":
      return "Appen (installerad)";
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
