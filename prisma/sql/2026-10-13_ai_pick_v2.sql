-- "Välj åt mig" v2: historik ("chattarna"). Additiv och idempotent. Körs
-- manuellt mot databasen INNAN koden deployas (Prisma-modellen AiPickRequest
-- har fälten — utan kolumnerna fallerar varje val).
--
--   session_id  klientens id per "konversation" i arket (null = egen session)
--   reason      motiveringen som visades
--   result      { pick: PickItem, alternatives: PickItem[] } — ögonblicksbild
--
-- "Rensa historik" (DELETE /api/pick/history) nollar result/prompt/reason men
-- behåller raderna: kvoten räknas bara på status/source/created_at.
ALTER TABLE ai_pick_requests ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE ai_pick_requests ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE ai_pick_requests ADD COLUMN IF NOT EXISTS result jsonb;   -- { pick: PickItem, alternatives: PickItem[] } snapshot for history
CREATE INDEX IF NOT EXISTS idx_ai_pick_requests_user_session ON ai_pick_requests(user_id, session_id);
