"use client";

// Delade hjälpare för spara-arket och den mjuka betalväggen i "nya flödet"
// (del 4, se docs/nya-flodet.md). Ingen UI här — bara data och små
// sidoeffekter som båda stegen behöver.

import type { FsLike, FsState } from "@/lib/firstSession";

/**
 * Samtyckescookien som /api/auth/apple läser (TERMS_CONSENT_COOKIE där).
 * AppleSignInButton skickar inget villkorsfält, så arket lägger cookien medan
 * kryssrutan är ikryssad. Kortlivad, inte httpOnly (sätts från klienten),
 * rensas av servern vid inloggningen.
 */
const TERMS_CONSENT_COOKIE = "nw_terms_ok";
const TERMS_CONSENT_MAX_AGE = 60 * 30;

export function setTermsConsentCookie(on: boolean): void {
  try {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = on
      ? `${TERMS_CONSENT_COOKIE}=1; Max-Age=${TERMS_CONSENT_MAX_AGE}; Path=/; SameSite=Lax${secure}`
      : `${TERMS_CONSENT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
  } catch {
    /* SSR / blockerade cookies – servern får då inget samtycke och sparar inget */
  }
}

/**
 * Markör för "användaren tryckte på Fortsätt med Apple på spara-arket".
 * AppleSignInButton laddar om /swipe efter lyckad inloggning, så arket ser
 * resultatet först efter omladdningen — markören avgör om vi ska tacka.
 */
const PENDING_KEY = "nw_fs_save_pending";

export function markSavePending(via: "apple" | "email"): void {
  try {
    sessionStorage.setItem(PENDING_KEY, via);
  } catch {
    /* privat läge */
  }
}

export function takeSavePending(): string | null {
  try {
    const v = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return v;
  } catch {
    return null;
  }
}

/** Kvällens AI-val (AiReveal sätter fs.aiPick via setFsAiPick). */
export function tonightPick(fs: FsState): FsLike | null {
  const p = fs.aiPick;
  return p && typeof p.tmdbId === "number" ? p : null;
}

/** Gillade utan dubbletter av kvällens val (det visas separat, sist). */
export function savedLikes(fs: FsState): FsLike[] {
  const pick = tonightPick(fs);
  const seen = new Set<string>();
  const out: FsLike[] = [];
  for (const l of fs.likes) {
    const k = `${l.mediaType}:${l.tmdbId}`;
    if (seen.has(k)) continue;
    if (pick && pick.tmdbId === l.tmdbId && pick.mediaType === l.mediaType) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

/** TMDB-sökväg ("/abc.jpg") eller full URL → bild-URL i miniatyrstorlek. */
export function posterSrc(poster: string | null | undefined): string | null {
  if (!poster) return null;
  if (/^https?:\/\//.test(poster)) return poster;
  if (poster.startsWith("/")) return `https://image.tmdb.org/t/p/w185${poster}`;
  return null;
}

/** Premiumstatus från servern; false vid fel (då visas betalväggen hellre en gång för mycket). */
export async function fetchIsPremium(): Promise<boolean> {
  try {
    const res = await fetch("/api/billing/status", { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const j = (await res.json()) as { isPremium?: boolean };
    return Boolean(j.isPremium);
  } catch {
    return false;
  }
}
