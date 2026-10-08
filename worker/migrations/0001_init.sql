-- Distinct players per prompt (all time). N = COUNT(*) per prompt_id.
CREATE TABLE IF NOT EXISTS prompt_players (
  prompt_id  TEXT NOT NULL,
  player_id  TEXT NOT NULL,
  first_date TEXT NOT NULL,
  PRIMARY KEY (prompt_id, player_id)
) WITHOUT ROWID;

-- Each distinct (prompt, answer, player) once. n = COUNT(*) per (prompt_id, answer).
-- answer is the canonical answer when matched, otherwise the normalized text.
CREATE TABLE IF NOT EXISTS player_answers (
  prompt_id  TEXT NOT NULL,
  answer     TEXT NOT NULL,
  player_id  TEXT NOT NULL,
  listed     INTEGER NOT NULL DEFAULT 0,
  first_date TEXT NOT NULL,
  PRIMARY KEY (prompt_id, answer, player_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_player_answers_unlisted ON player_answers (listed, prompt_id, answer);

-- One submission per player per day.
CREATE TABLE IF NOT EXISTS submissions (
  player_id  TEXT NOT NULL,
  date       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (player_id, date)
) WITHOUT ROWID;

-- Moderation decisions for answers outside (or removed from) the hand-built bank.
CREATE TABLE IF NOT EXISTS answer_overrides (
  prompt_id     TEXT NOT NULL,
  answer        TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('approved', 'rejected', 'banned')),
  starting_tier INTEGER NOT NULL DEFAULT 5,
  source        TEXT NOT NULL DEFAULT 'admin',
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (prompt_id, answer)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
