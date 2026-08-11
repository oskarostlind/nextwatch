// app/profile/page.tsx
//
// Medvetet INGEN server-hämtning av profilen: ProfileClient hydrerar ändå
// alltid alla fält från /api/profile vid mount (cache:'no-store'), så Prisma-
// frågan här var ren extra navigeringslatens — servern väntade på databasen
// bara för att klienten direkt skulle skriva över svaret. Skalet renderar
// direkt och klienten fyller i (med klientcache för omedelbar återmålning).
// Sidan är därmed statiskt prerenderad och fullt prefetchbar — flikbytet
// serveras direkt ur router-cachen utan serverrundresa.

import ProfileClient from "./ProfileClient";

export type FavoriteItem = {
  id: number;
  title: string;
  year?: string | null;
  poster?: string | null;
};

export type ProfileDTO = {
  displayName: string | null;
  /** Vald avatar ur lib/avatars.ts, null = ingen vald. */
  avatarId?: string | null;
  /** User.username — gemensamt med vän-sök m.m. */
  username?: string | null;
  dob: string | null; // ISO yyyy-mm-dd eller null
  region: string | null;
  locale: string | null;
  uiLanguage: string | null;
  favoriteGenres: string[];
  dislikedGenres?: string[]; // valfri – klient hydr. ändå
  favoriteKeywordIds?: number[]; // valfri – klient hydr. ändå
  providers?: string[];      // valfri – klient hydr. ändå
  favoriteMovie?: FavoriteItem | null;
  favoriteShow?: FavoriteItem | null;
};

export default function Page() {
  return <ProfileClient initial={null} />;
}
