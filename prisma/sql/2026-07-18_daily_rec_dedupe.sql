-- Daglig push ska inte upprepa samma titel: minns senast pushade tipset.
-- Additiv och idempotent. Körs mot databasen INNAN koden deployas.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_daily_rec_tmdb_id integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_daily_rec_media_type text;
