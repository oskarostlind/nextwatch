-- Nya flödet (2026-10-15), del 5: notisfrågan med tidsval (18/19/20/21).
-- Användarens egen push-timme (Stockholm). Null = inget val → typvärdet av
-- swipetimmarna gäller som förut (lib/pushRecs/timing.ts). Additiv och
-- idempotent. Kör manuellt mot databasen INNAN koden deployas: schema.prisma
-- har fältet, så Prisma-läsningar av profiles utan `select` kräver kolumnen.
-- (Koden i lib/pushRecs/timing.ts och /api/push/preferences tål att den saknas.)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_hour smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_push_hour_range') THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_push_hour_range CHECK (push_hour IS NULL OR (push_hour BETWEEN 0 AND 23));
  END IF;
END $$;
