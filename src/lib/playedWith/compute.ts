// Played With — shared bucket computation (Phase E).
//
// Extracted 2026-06-06 (E6) from the player-profile inline `loadPlayedWith`
// so the player profile (E5) and the admin Played-With tab (E6) share ONE
// implementation of the fragile PostgREST query + bucket math. The logic here
// is byte-faithful to the shipped E5 profile version — see ROADMAP "Played
// With v2 (locked 2026-05-24)" for the rules:
//
//   - "Played with" = same team, same round (the round+team pair is the unit).
//   - Buckets 6+ / 3–5 / 1–2 / 0 (bucketing happens in PlayedWithPanel).
//   - Never-played excludes inactive players (not actionable) and the focal.
//   - Deactivated players still appear as partners if they share history.
//
// Live JOIN against `round_players` — NEVER the legacy `played_with_matrix`
// view (full_name-keyed, unverified freshness post-H.5; dropped in E6).

import { supabase } from "@/lib/supabase";
import { getTeamFlightsByRounds } from "@/lib/flights/resolve";
import { getDisplayName, type PlayerLike } from "@/lib/players/displayName";

export type Partner = {
  id: number;
  display_name: string;
  rounds_together: number;
};

export type NeverPlayed = {
  id: number;
  display_name: string;
};

export type PlayedWithBuckets = {
  partners: Partner[];
  neverPlayed: NeverPlayed[];
};

// Minimal shape of the round_players rows the bucket math reads. The
// `rounds!inner` embed is used only for the is_complete / season_id filters at
// query time; the computation itself never touches it.
export type RoundPlayerRow = {
  round_id: number;
  team_number: number;
  player_id: number;
};

export type PlayerRow = {
  id: number;
  full_name: string;
  display_name: string | null;
  is_active: boolean;
};

// Fetch the completed, team-assigned round_players rows plus the full player
// roster (active + inactive). `seasonId` scopes to a single season's rounds;
// pass `null` for all-time. Throws on PostgREST error or missing data so the
// caller can surface a load-failure state (PostgREST fails silently otherwise).
export async function fetchPlayedWithRows(
  seasonId: number | null,
): Promise<{ rpRows: RoundPlayerRow[]; allPlayers: PlayerRow[] }> {
  let rpQuery = supabase
    .from("round_players")
    .select("round_id, team_number, player_id, rounds!inner ( is_complete, season_id )")
    .eq("rounds.is_complete", true)
    .gt("team_number", 0);
  if (seasonId != null) {
    rpQuery = rpQuery.eq("rounds.season_id", seasonId);
  }

  const [{ data: rpRows, error: rpErr }, { data: allPlayers, error: pErr }] =
    await Promise.all([
      rpQuery,
      supabase.from("players").select("id, full_name, display_name, is_active"),
    ]);

  if (rpErr) throw rpErr;
  if (pErr) throw pErr;
  if (!rpRows || !allPlayers) throw new Error("missing data");

  return {
    rpRows: rpRows as unknown as RoundPlayerRow[],
    allPlayers: allPlayers as unknown as PlayerRow[],
  };
}

// Pure bucket math over pre-fetched rows. Splitting fetch from compute lets a
// caller (admin Section 2) fetch the season's rows ONCE and compute buckets for
// many focal players in memory, rather than re-querying per player.
export function computeBuckets(
  focalId: number,
  rpRows: RoundPlayerRow[],
  allPlayers: PlayerRow[],
): PlayedWithBuckets {
  // Disambiguate against the full active roster (display_name ignored, per the
  // locked naming convention) so names match every other surface.
  const activeRoster: PlayerLike[] = allPlayers.map((p) => ({
    id: p.id,
    full_name: p.full_name,
    is_active: p.is_active,
  }));
  const nameOf = (p: { id: number; full_name: string }) =>
    p.full_name
      ? getDisplayName({ id: p.id, full_name: p.full_name }, activeRoster)
      : `Player ${p.id}`;
  const nameMap = new Map<number, string>();
  allPlayers.forEach((p) => nameMap.set(p.id, nameOf(p)));

  // Round+team keys the focal player belongs to.
  const focalKeys = new Set<string>();
  rpRows.forEach((rp) => {
    if (rp.player_id === focalId) {
      focalKeys.add(`${rp.round_id}:${rp.team_number}`);
    }
  });

  // Everyone who shared one of those round+team slots, counted.
  const partnerCounts = new Map<number, number>();
  rpRows.forEach((rp) => {
    if (rp.player_id === focalId) return;
    if (!focalKeys.has(`${rp.round_id}:${rp.team_number}`)) return;
    partnerCounts.set(rp.player_id, (partnerCounts.get(rp.player_id) || 0) + 1);
  });

  const partners: Partner[] = Array.from(partnerCounts.entries()).map(
    ([id, count]) => ({
      id,
      display_name: nameMap.get(id) || `Player ${id}`,
      rounds_together: count,
    }),
  );

  const partnerIds = new Set(partnerCounts.keys());
  const neverPlayed: NeverPlayed[] = allPlayers
    .filter((p) => p.is_active && p.id !== focalId && !partnerIds.has(p.id))
    .map((p) => ({ id: p.id, display_name: nameOf(p) }));

  return { partners, neverPlayed };
}

// Convenience: fetch + compute for a single focal player. Used by the player
// profile (E5) and admin Section 1 / Player View (E6).
export async function loadPlayedWith(
  focalId: number,
  seasonId: number | null,
): Promise<PlayedWithBuckets> {
  const { rpRows, allPlayers } = await fetchPlayedWithRows(seasonId);
  return computeBuckets(focalId, rpRows, allPlayers);
}

// One shared round between two players: same round AND same team (the
// partnership unit). Used by admin Section 3 / Pair Lookup (E6).
export type PairRound = {
  round_id: number;
  played_on: string;
  team_number: number;
  format: string | null;
};

// All rounds where players A and B were on the same team, newest first.
// `seasonId` scopes to one season; pass null for all-time. Derives the
// last-played date inline (E4 stored field deferred per ROADMAP).
export async function fetchPairRounds(
  aId: number,
  bId: number,
  seasonId: number | null,
): Promise<PairRound[]> {
  if (aId === bId) return [];

  let q = supabase
    .from("round_players")
    .select("round_id, team_number, player_id, rounds!inner ( played_on, is_complete, season_id )")
    .in("player_id", [aId, bId])
    .eq("rounds.is_complete", true)
    .gt("team_number", 0);
  if (seasonId != null) {
    q = q.eq("rounds.season_id", seasonId);
  }

  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as any[];

  // Flights S3: a pairing plays under ITS TEAM's flight. Resolve per (round,
  // team) so the Pair Lookup row label reads the partnership's own flight format
  // — correct on multi-flight rounds, identical to the primary on single-flight.
  const flightResolver = await getTeamFlightsByRounds(
    rows.map((r) => r.round_id as number),
  );

  // Group by round+team; a partnership exists only when BOTH ids share the
  // same round+team slot.
  const byRoundTeam = new Map<
    string,
    { round_id: number; team_number: number; played_on: string; format: string | null; ids: Set<number> }
  >();
  for (const r of rows) {
    const rnd = Array.isArray(r.rounds) ? r.rounds[0] : r.rounds;
    if (!rnd) continue;
    const key = `${r.round_id}:${r.team_number}`;
    let entry = byRoundTeam.get(key);
    if (!entry) {
      entry = {
        round_id: r.round_id,
        team_number: r.team_number,
        played_on: rnd.played_on,
        format: flightResolver.get(r.round_id, r.team_number)?.format ?? null,
        ids: new Set<number>(),
      };
      byRoundTeam.set(key, entry);
    }
    entry.ids.add(r.player_id);
  }

  const result: PairRound[] = [];
  for (const entry of byRoundTeam.values()) {
    if (entry.ids.has(aId) && entry.ids.has(bId)) {
      result.push({
        round_id: entry.round_id,
        played_on: entry.played_on,
        team_number: entry.team_number,
        format: entry.format,
      });
    }
  }
  result.sort((a, b) =>
    a.played_on < b.played_on ? 1 : a.played_on > b.played_on ? -1 : 0,
  );
  return result;
}
