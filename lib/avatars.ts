// lib/avatars.ts
//
// Förvalt avatarbibliotek (à la Netflix, men egna assets — inga licensfrågor).
// SVG-filerna ligger i public/avatars/<id>.svg och genereras från en mall så
// hela setet delar formspråk (rundad kvadrat, diagonal gradient, vitt motiv).
// Frivilligt val: null/undefined är giltigt och UI faller tillbaka på initial.

/** Etiketten slås upp som avatars.<id> i messages/*.json. */
export type AvatarDef = { id: string };

export const AVATARS: AvatarDef[] = [
  { id: "popcorn" },
  { id: "klappa" },
  { id: "stjarna" },
  { id: "hjarta" },
  { id: "robot" },
  { id: "alien" },
  { id: "spoke" },
  { id: "katt" },
  { id: "raket" },
  { id: "biljett" },
  { id: "tv" },
  { id: "vhs" },
  { id: "kamera" },
  { id: "mane" },
  { id: "glasogon" },
  { id: "pizza" },
];

const VALID_IDS = new Set(AVATARS.map((a) => a.id));

export function isValidAvatarId(v: unknown): v is string {
  return typeof v === "string" && VALID_IDS.has(v);
}

export function avatarUrl(id: string | null | undefined): string | null {
  return id && VALID_IDS.has(id) ? `/avatars/${id}.svg` : null;
}
