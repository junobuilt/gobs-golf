-- Migration 040: declared match total + match void
-- Additive, reversible. No data backfill; defaults handle existing rows.
ALTER TABLE tournaments
  ADD COLUMN planned_match_total integer;

ALTER TABLE tournaments
  ADD CONSTRAINT tournaments_planned_match_total_range
  CHECK (planned_match_total IS NULL OR (planned_match_total BETWEEN 2 AND 50));

ALTER TABLE tournament_matches
  ADD COLUMN is_voided boolean NOT NULL DEFAULT false;
