-- NextWatch: "senast aktiv" på vänprofiler.
--
--   users.last_active_at
--     Throttlad aktivitetsstämpel (~1/min) som sätts när appen pollar. Visas
--     som "senast aktiv" på en väns profil. Skild från last_login_at.
--
-- Kör mot Postgres eller använd `npx prisma db push`. Idempotent.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_active_at" TIMESTAMP(3);
