// lib/session.ts
//
// Signering av identitetscookien nw_uid. TIDIGARE var cookievärdet det RÅA
// användar-id:t utan signatur — vem som helst kunde sätta nw_uid till valfritt
// id (som dessutom läckte via friends/search) och därmed bli den användaren.
// Nu bär cookien "<uid>.<hmac>" och varje request verifieras: en förfalskad
// eller manipulerad cookie förkastas och behandlas som anonym.
//
// Implementeras med Web Crypto (globalThis.crypto.subtle) så att samma modul
// fungerar både i middleware (edge runtime) och i node-routes. Håll den fri
// från next/server- och node:crypto-importer — den ligger i edge-grafen.

const enc = new TextEncoder();

/** HMAC-nyckeln avleds av samma hemlighet som resten av appen redan har. */
function getSecret(): string {
  return process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET || "";
}

let cachedKey: Promise<CryptoKey> | null = null;
let cachedForSecret: string | null = null;

async function getKey(): Promise<CryptoKey | null> {
  const secret = getSecret();
  if (!secret) return null;
  if (!cachedKey || cachedForSecret !== secret) {
    cachedForSecret = secret;
    cachedKey = crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }
  return cachedKey;
}

function toB64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Konstanttidsjämförelse så att signaturkontrollen inte läcker via timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Kastar om ingen hemlighet finns — vi vill hellre fela högt än utfärda
 * osignerade (förfalskningsbara) sessioner. Anropas från route-writers som
 * redan har try/catch.
 */
export async function signUid(uid: string): Promise<string> {
  const key = await getKey();
  if (!key) {
    throw new Error("SESSION_SECRET/NEXTAUTH_SECRET saknas – kan inte signera session.");
  }
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(uid));
  return `${uid}.${toB64Url(sig)}`;
}

/**
 * Returnerar det verifierade bare-uid:t, eller null om cookien saknas, är
 * osignerad (t.ex. en gammal cookie utfärdad före den här ändringen) eller har
 * en ogiltig signatur. Kastar aldrig.
 */
export async function verifyUid(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  const idx = value.lastIndexOf(".");
  if (idx <= 0) return null;
  const uid = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  if (!uid || !sig) return null;
  const key = await getKey();
  if (!key) return null;
  const expected = toB64Url(await crypto.subtle.sign("HMAC", key, enc.encode(uid)));
  return safeEqual(sig, expected) ? uid : null;
}
