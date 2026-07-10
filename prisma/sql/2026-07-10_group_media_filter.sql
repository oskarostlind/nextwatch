-- NextWatch: Gruppinställning — film/serie-filter i swipe (standard: both).
-- Kör mot Postgres eller använd `npx prisma db push`.
-- Idempotent.

ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "media_filter" TEXT NOT NULL DEFAULT 'both';
