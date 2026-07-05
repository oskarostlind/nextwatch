-- NextWatch: Apple In-App Purchase (iOS-premium via App Store)
-- Kör mot din Postgres (eller använd `npx prisma db push` som synkar schema.prisma automatiskt).
-- Idempotent: kan köras flera gånger utan fel.

CREATE TABLE IF NOT EXISTS "apple_iap_transactions" (
  "transaction_id" TEXT PRIMARY KEY,
  "user_id"        TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "product_id"     TEXT NOT NULL,
  "environment"    TEXT,
  "purchased_at"   TIMESTAMP(3) NOT NULL,
  "expires_at"     TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_apple_iap_user" ON "apple_iap_transactions"("user_id");
