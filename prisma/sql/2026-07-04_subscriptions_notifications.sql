-- NextWatch: prenumeration + notisinställningar
-- Kör mot din Postgres (eller använd `npx prisma db push` som synkar schema.prisma automatiskt).
-- Idempotent: kan köras flera gånger utan fel.

-- === User: subscription/entitlement ===
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_customer_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sub_provider" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sub_status" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sub_current_period_end" TIMESTAMP(3);

-- Unikt Stripe-customer-id (partiellt: tillåter många NULL).
CREATE UNIQUE INDEX IF NOT EXISTS "users_stripe_customer_id_key"
  ON "users" ("stripe_customer_id")
  WHERE "stripe_customer_id" IS NOT NULL;

-- === Profile: notisinställningar (default: allt på utom marknadsföring) ===
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "notify_daily_recs"      BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "notify_group_matches"   BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "notify_friend_requests" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "notify_group_invites"   BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "notify_marketing"       BOOLEAN NOT NULL DEFAULT false;
