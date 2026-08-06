-- Migration 041: reversible day-level void
ALTER TABLE tournament_sessions
  ADD COLUMN is_voided boolean NOT NULL DEFAULT false;
