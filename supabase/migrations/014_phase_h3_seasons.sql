-- Phase H3 — Season management (H3.1 schema + H3.5 backfill)
--
-- Adds a `seasons` table and a nullable `rounds.season_id` FK so rounds can be
-- grouped into seasons. The app gains an end-of-season flow (Settings tab),
-- reopen, and auto-start-on-new-round. Downstream features blocked on this:
-- Played With v2 season filter (E5), payout persistence (round_payouts.season_id),
-- Winnings tab season scope.
--
-- Invariants:
--   - At most one active season at a time, enforced by a partial unique index
--     (seasons_only_one_active). Concurrent reopen attempts: one wins, the
--     other fails loudly (caller surfaces a retry message).
--   - season_id stays nullable forever: older rounds may legitimately lack one
--     if a future backfill is skipped; the app loads such rounds fine.
--
-- Backfill: create the "2026 Season" (started 2026-01-01, active) and attach
-- every existing round. The DO block aborts the migration if any round is left
-- without a season_id.
--
-- Applied to prod via Supabase MCP (apply_migration runs transactionally, so
-- no explicit BEGIN/COMMIT here — matches the rest of this folder).
--
-- Rollback:
--   ALTER TABLE rounds DROP COLUMN season_id;
--   DROP TABLE seasons;  -- drops seasons_only_one_active with it

CREATE TABLE seasons (
  id serial PRIMARY KEY,
  name text NOT NULL,
  started_on date NOT NULL,
  ended_on date,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Only one row may have is_active = true at any time.
CREATE UNIQUE INDEX seasons_only_one_active
  ON seasons (is_active) WHERE is_active = true;

ALTER TABLE rounds
  ADD COLUMN season_id integer REFERENCES seasons(id);

INSERT INTO seasons (name, started_on, is_active)
  VALUES ('2026 Season', '2026-01-01', true);

UPDATE rounds
  SET season_id = (SELECT id FROM seasons WHERE name = '2026 Season')
  WHERE season_id IS NULL;

DO $$
DECLARE missing_count int;
BEGIN
  SELECT COUNT(*) INTO missing_count FROM rounds WHERE season_id IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Backfill failed: % rounds still have NULL season_id', missing_count;
  END IF;
END $$;
