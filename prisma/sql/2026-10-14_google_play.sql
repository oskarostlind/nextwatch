-- Google Play-prenumerationer (Android-appen). Additiv och idempotent — rör
-- inga befintliga tabeller. Läses/skrivs med rå SQL i lib/googlePlay.ts (ingen
-- Prisma-modell, så schema.prisma och iOS-flödet är orörda). Körs mot
-- databasen INNAN Android-köp aktiveras; saknas tabellen svarar
-- /api/google/play/verify 500 men inget annat påverkas.
CREATE TABLE IF NOT EXISTS google_play_purchases (
  purchase_token text PRIMARY KEY,
  user_id        text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id     text NOT NULL,
  order_id       text,
  state          text,
  expires_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_google_play_user ON google_play_purchases(user_id, updated_at);
