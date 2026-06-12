-- Per-Team Handicap Allowance Override.
--
-- A flight owns one handicap allowance; an admin may OPT-IN to override the
-- allowance for an INDIVIDUAL team within a flight (e.g. a no-show shrinks one
-- team and it needs a different %). The override is stored here, on the team's
-- flight_teams row, as a nullable percentage. NULL = the team inherits its
-- flight's allowance (the default for every team — most teams never get a value).
--
-- The rule "a team's effective allowance = its override if present, else the
-- flight default" lives in src/lib/flights/resolve.ts (effectiveTeamConfig); this
-- column is just the storage. Pot SIZE is independent of allowance
-- (headcount × buy-in), so an override can only shift that team's net (and hence
-- its net-based rank within the flight) — never the pot.
--
-- Additive + reversible:
--   * One NEW nullable column with a range CHECK. Every existing flight_teams row
--     keeps NULL (no override) → every team resolves to its flight default,
--     exactly as before. No backfill, no data rewrite → no backup needed.
--   * Column inherits flight_teams' existing RLS (allow-all, mirrors rounds).
--
-- Self-checking RELAY dry-run (run in a rolled-back transaction before the real
-- apply) should assert:
--   1. After ADD COLUMN, every existing flight_teams row has handicap_allowance
--      IS NULL (no team overridden by the migration).
--   2. An explicit UPDATE ... SET handicap_allowance = 80 on one team persists 80
--      (and the CHECK rejects 0 / 105 / 9).
--   3. A team with NO flight_teams row is unaffected (override absent → the app
--      resolves it to the flight default).
--
-- Rollback:
--   ALTER TABLE flight_teams DROP COLUMN IF EXISTS handicap_allowance;

ALTER TABLE public.flight_teams
  ADD COLUMN handicap_allowance integer
    CHECK (handicap_allowance IS NULL OR handicap_allowance BETWEEN 10 AND 100);
