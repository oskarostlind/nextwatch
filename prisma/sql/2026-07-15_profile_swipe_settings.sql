-- NextWatch: Swipe-inställningar på profilen.
--   show_paid_options  — opt-in för hyr-/köpalternativ på titelkort (av som standard).
--   swipe_media_filter — film/serie-filter för solo-swipe, flyttat från localStorage.
--                        Grupper har sitt eget filter på groups.media_filter.
-- Kör mot Postgres eller använd `npx prisma db push`.
-- Idempotent.

ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "show_paid_options" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "swipe_media_filter" TEXT NOT NULL DEFAULT 'both';
