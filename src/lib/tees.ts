// White/Yellow Combo — `tees.id = 4`. The league de-facto standard tee, used
// by ~99% of players in ~99% of rounds. Hardcoded rather than read from
// `league_settings` because the tees table is essentially immutable for this
// league (4 rows, set at app init; see supabase/migrations and CLAUDE.md
// "Database schema" section). Update both this constant and the seed in
// `supabase/migrations/004_phase_a_preferred_tee.sql` if the default ever
// changes.
//
// Per-player override lives on `players.preferred_tee_id`; per-scorecard
// override is the Tee Selection screen on the scorecard, which now pre-selects
// `player.preferred_tee_id ?? DEFAULT_TEE_ID` for any player whose
// round_players.tee_id is still null.
export const DEFAULT_TEE_ID = 4;
