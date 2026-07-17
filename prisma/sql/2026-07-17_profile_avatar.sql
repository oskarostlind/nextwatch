-- Profilavatar ur förvalt bibliotek (lib/avatars.ts). Null = ingen vald.
-- Körs manuellt mot databasen INNAN koden som läser kolumnen deployas.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_id text;
