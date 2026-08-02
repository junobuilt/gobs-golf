// Plain-language copy for the pairings surface. Pure + framework-free so the
// mapping (every typed mutation/loader error → its OWN message, never a shared
// generic) is unit-testable independent of React.

import {
  EmptyGroupError,
  GroupHasScoresError,
  GroupOverfilledError,
  PlayerAlreadyGroupedError,
  PlayerNotAssignedToSideError,
  PlayerNotInTournamentError,
  PlayerSideMismatchError,
} from "@/lib/tournament/mutations";
import { MatchHolesMissingError, MixedTeesInMatchError } from "@/lib/tournament/loadMatch";

export function mutationMessage(err: unknown, sideAName: string, sideBName: string): string {
  if (err instanceof EmptyGroupError) return "Add at least one player before saving this group.";
  if (err instanceof GroupOverfilledError) {
    return `Too many players on ${err.side === "a" ? sideAName : sideBName} — a side takes at most two.`;
  }
  if (err instanceof PlayerNotAssignedToSideError) {
    return "That player isn't on a side yet — assign them under Sides first.";
  }
  if (err instanceof PlayerNotInTournamentError) {
    return "That player isn't in this tournament yet — assign them under Sides first.";
  }
  if (err instanceof PlayerSideMismatchError) {
    return `That player plays for ${err.actualSide === "a" ? sideAName : sideBName} and can't go on the other side.`;
  }
  if (err instanceof PlayerAlreadyGroupedError) return "That player is already in another group today.";
  if (err instanceof GroupHasScoresError) return "This group already has scores — remove them before changing it.";
  // Not a typed domain error — surface the ACTUAL failure instead of a blank
  // generic (the generic hid real save failures on the group builder, bug 3).
  if (err instanceof Error) {
    // Postgres unique-violation on round_players (round_id, player_id): a row for
    // this player already exists in the round — e.g. a leftover unassigned
    // (team_number = 0) row the "already grouped" guard (team_number > 0) misses.
    if (/duplicate key|23505|round_players_round_id_player_id_key/i.test(err.message)) {
      return "One of these players is already in this round. Remove them from their current group (or the round) first, then try again.";
    }
    // Any other DB/mutation error: show the real message, stripped of the
    // internal "fnName (table): " prefix our mutations prepend, so the user
    // sees WHAT failed instead of "Something went wrong".
    const detail = err.message.replace(/^[A-Za-z]+ \([^)]*\):\s*/, "").trim();
    if (detail) return `Couldn't save — ${detail}`;
  }
  return "Something went wrong. Please try again.";
}

// null when the error is not a loader-misconfig error (so callers can fall through).
export function loaderMessage(err: unknown): string | null {
  if (err instanceof MixedTeesInMatchError) {
    return "This group is misconfigured — its players are on different tees. Edit it and pick one tee.";
  }
  if (err instanceof MatchHolesMissingError) {
    return "This group is misconfigured — its tee has no holes set up.";
  }
  return null;
}
