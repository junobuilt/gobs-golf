ALTER TABLE tournament_sessions
  ADD COLUMN handicap_allowance integer;

ALTER TABLE tournament_sessions
  ADD CONSTRAINT tournament_sessions_handicap_allowance_range
  CHECK (handicap_allowance IS NULL
         OR (handicap_allowance BETWEEN 10 AND 100));

COMMENT ON COLUMN tournament_sessions.handicap_allowance IS
  'Percent of course handicap applied before the relative-to-lowest subtraction. NULL = format default (greensomes uses its own 60/40 weighted team handicap and ignores this column).';
