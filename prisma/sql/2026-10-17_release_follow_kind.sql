-- "Bevaka" (2026-10-17): den grå "Ej tillgänglig"-knappen ersätts av en
-- bevakning som pushar när titeln dyker upp på användarens tjänster.
-- Återanvänder release_follows med en typkolumn:
--   'release' = gillat "Kommer snart"-kort (som förut, alla befintliga rader)
--   'stream'  = bevakning tills titeln går att streama
-- Additiv och idempotent. Kör INNAN koden deployas: schema.prisma har fältet,
-- så Prisma-skrivningar mot release_follows (upsert returnerar alla kolumner)
-- kräver kolumnen.
ALTER TABLE release_follows ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'release';
CREATE INDEX IF NOT EXISTS idx_release_follows_kind_notified ON release_follows (kind, notified_at);
