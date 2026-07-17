// lib/avatars.ts
//
// Förvalt avatarbibliotek (à la Netflix, men egna assets — inga licensfrågor).
// SVG-filerna ligger i public/avatars/<id>.svg och genereras från en mall så
// hela setet delar formspråk (rundad kvadrat, diagonal gradient, vitt motiv).
// Frivilligt val: null/undefined är giltigt och UI faller tillbaka på initial.

export type AvatarDef = { id: string; label: string };

export const AVATARS: AvatarDef[] = [
  { id: "popcorn", label: "Popcorn" },
  { id: "klappa", label: "Klappa" },
  { id: "stjarna", label: "Stjärna" },
  { id: "hjarta", label: "Hjärta" },
  { id: "robot", label: "Robot" },
  { id: "alien", label: "Alien" },
  { id: "spoke", label: "Spöke" },
  { id: "katt", label: "Katt" },
  { id: "raket", label: "Raket" },
  { id: "biljett", label: "Biljett" },
  { id: "tv", label: "TV" },
  { id: "vhs", label: "VHS" },
  { id: "kamera", label: "Kamera" },
  { id: "mane", label: "Måne" },
  { id: "glasogon", label: "3D-glasögon" },
  { id: "pizza", label: "Pizza" },
];

const VALID_IDS = new Set(AVATARS.map((a) => a.id));

export function isValidAvatarId(v: unknown): v is string {
  return typeof v === "string" && VALID_IDS.has(v);
}

export function avatarUrl(id: string | null | undefined): string | null {
  return id && VALID_IDS.has(id) ? `/avatars/${id}.svg` : null;
}
