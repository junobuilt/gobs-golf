-- E6 (2026-06-06): drop the legacy played_with_matrix view.
--
-- Replaced by a live JOIN against round_players (per the E1/E6 decisions and
-- the "Played With v2" locked rules). The view was keyed on full_name text
-- strings with unverified freshness after the H.5 historical import; the admin
-- Played-With redesign and the player-profile Played With section now both
-- compute partner/never-played buckets directly from round_players via
-- src/lib/playedWith/compute.ts.
--
-- Verified before dropping: object is a VIEW with no DB-side dependents, and
-- the only application consumer (src/app/admin/page.tsx) was removed in this
-- same change.

DROP VIEW IF EXISTS public.played_with_matrix;
