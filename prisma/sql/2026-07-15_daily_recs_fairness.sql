-- NextWatch: rättvis kö för dagens tips + bort med ett oanvänt index.
--
--   users.last_daily_rec_at
--     Senaste försöket att skicka dagens tips. daily-recs sorterar kön på den
--     så att den som väntat längst går först. Utan ordning returnerade Postgres
--     raderna likadant varje körning, vilket gjorde att samma användare i
--     svansen aldrig fick sin push när tidsbudgeten tog slut.
--     NULL = har aldrig fått ett tips → går främst i kön.
--
--   DROP INDEX idx_ratings_user_tmdb
--     Dubblett: ratings_user_id_tmdb_id_media_type_key (från @@unique) är ett
--     btree på exakt samma kolumner i samma ordning. Mätt i produktion stod
--     unique-indexet för 2899 scans och dubbletten för 0 — den kostade bara
--     skrivtid vid varje betyg och 176 kB disk.
--
-- Kör mot Postgres eller använd `npx prisma db push`.
-- Idempotent.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_daily_rec_at" TIMESTAMP(3);

DROP INDEX IF EXISTS "idx_ratings_user_tmdb";
