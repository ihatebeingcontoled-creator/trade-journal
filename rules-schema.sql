-- ============================================================
-- Trade-entry rules  —  paste this WHOLE block into the
-- D1 → trade-journal → Console tab, then click Execute.
-- Safe to run more than once: it won't wipe rules you've typed.
-- ============================================================

CREATE TABLE IF NOT EXISTS rules (
  id          INTEGER PRIMARY KEY,   -- 1 .. 10 (fixed slots)
  text        TEXT DEFAULT '',       -- the rule you write
  updated_at  INTEGER DEFAULT 0
);

-- Seed 10 empty slots. INSERT OR IGNORE = only fills slots that
-- don't exist yet, so re-running never overwrites your text.
INSERT OR IGNORE INTO rules (id, text, updated_at) VALUES
  (1,  '', 0),
  (2,  '', 0),
  (3,  '', 0),
  (4,  '', 0),
  (5,  '', 0),
  (6,  '', 0),
  (7,  '', 0),
  (8,  '', 0),
  (9,  '', 0),
  (10, '', 0);
