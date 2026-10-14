-- Nya flödet del 6 (2026-10-15): bjud in via länk (/g/<kod>) + värvningsbelöning.
-- Additiv och idempotent. Läses/skrivs med rå SQL i lib/referral.ts (ingen
-- Prisma-modell, så schema.prisma är orört). Körs mot databasen INNAN/I
-- SAMBAND MED deployen — men koden tål att filen inte körts än: lib/referral.ts
-- fångar "relation does not exist", loggar en varning och hoppar då bara över
-- belöningen. Länken, gästprofilen och grupplekens funktion påverkas inte.
--
-- Allt kaskadraderas från users/groups, så kontoradering behöver inget extra.

-- Vem som delade länken till en grupp (senaste delaren vinner). Länken
-- /g/<kod> bär ingen avsändare, så det är härifrån belöningen vet vem som
-- bjöd in. inviter_device = hash av värdens nw_dev-cookie, för att aldrig
-- belöna värden för att öppna sin egen länk i samma webbläsare med ett annat
-- konto (utloggad/ny gäst).
CREATE TABLE IF NOT EXISTS referral_links (
  group_code      text PRIMARY KEY REFERENCES groups(code) ON DELETE CASCADE,
  inviter_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inviter_device  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- En rad per inbjuden person (unik per invitee — ingen kan värvas två gånger).
-- status: 'pending' (väntar på 10 röster) | 'rewarded' | 'capped' (värden hade
-- redan 10 belöningar den månaden) | 'blocked_device' (samma enhet som värden).
-- Samma person som värden skrivs aldrig in alls.
CREATE TABLE IF NOT EXISTS referrals (
  id              text PRIMARY KEY,
  inviter_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_code      text NOT NULL,
  invitee_device  text,
  status          text NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now(),
  rewarded_at     timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_referrals_invitee ON referrals(invitee_id);
CREATE INDEX IF NOT EXISTS idx_referrals_inviter_rewarded ON referrals(inviter_id, rewarded_at);

-- ai_pick_grants.source är fri text (2026-10-13_ai_pick.sql har ingen CHECK;
-- lib/aiPick/quota.ts summerar alla grants oavsett source). Belöningen skrivs
-- med source 'referral'. Skulle någon ha lagt en CHECK på source direkt i
-- databasen som inte släpper igenom 'referral' tas den bort här — annars
-- skulle varje belöning tyst misslyckas. No-op i normalfallet.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'ai_pick_grants'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%source%'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%referral%'
  LOOP
    EXECUTE format('ALTER TABLE ai_pick_grants DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
