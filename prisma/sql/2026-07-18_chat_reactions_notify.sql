-- Filmchatten: mottagarreaktioner + notisinställning för filmtips.
-- Additiv och idempotent. Körs mot databasen INNAN koden deployas.
ALTER TABLE shared_titles ADD COLUMN IF NOT EXISTS reaction text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_shares boolean NOT NULL DEFAULT true;
