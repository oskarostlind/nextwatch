-- Filmtips mellan vänner (SharedTitle). Körs manuellt mot databasen INNAN
-- koden som läser tabellen deployas.
CREATE TABLE IF NOT EXISTS shared_titles (
  id           text PRIMARY KEY,
  from_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tmdb_id      integer NOT NULL,
  media_type   text NOT NULL,
  title        text NOT NULL,
  year         text,
  poster       text,
  seen_at      timestamp(3),
  created_at   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS shared_titles_unique_tip
  ON shared_titles (from_user_id, to_user_id, tmdb_id, media_type);

CREATE INDEX IF NOT EXISTS idx_shared_titles_inbox
  ON shared_titles (to_user_id, created_at);
