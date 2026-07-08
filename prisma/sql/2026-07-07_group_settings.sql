-- NextWatch: Gruppinställningar (kugghjulet — endast gruppens skapare).
-- Tomma/null-värden = automatik (union av medlemmarnas profiler, yngsta
-- medlemmens åldersgräns, 60 % matchtröskel). Se lib/groupSettings.ts.
-- Kör mot din Postgres (eller använd `npx prisma db push` som synkar schema.prisma automatiskt).
-- Idempotent: kan köras flera gånger utan fel.

ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "favorite_genres" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "disliked_genres" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "providers" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "max_cert" TEXT;
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "match_threshold" INTEGER;
