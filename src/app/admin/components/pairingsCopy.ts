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
