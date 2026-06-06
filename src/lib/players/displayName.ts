// Disambiguating display names for player rosters.
//
// Convention (see Played With tab spec):
//   "Bill Carlson" alone                       -> "Bill C"
//   "Wayne Hashimoto" + "Wayne Vincent"        -> "Wayne H" / "Wayne V"
//   "Norm Carstairs" + "Norm Carlson"          -> "Norm Cars" / "Norm Carl"
//   single-word name                           -> used as-is
//   identical full names                       -> not handled (out of concern)
//
// Pure function, no side effects, no DB storage. The display name is the
// first name plus the *minimum* prefix of the last name needed to tell the
// player apart from every other player who shares the same first name within
// the supplied roster (active players by default).

export type PlayerLike = {
  id: number;
  full_name: string;
  is_active?: boolean;
};

/** Split "First Last More" into ["First", "Last More"]. */
function splitName(fullName: string): { first: string; last: string } {
  const trimmed = fullName.trim();
  const space = trimmed.indexOf(" ");
  if (space === -1) return { first: trimmed, last: "" };
  return {
    first: trimmed.slice(0, space),
    last: trimmed.slice(space + 1).trim(),
  };
}

/**
 * Compute the disambiguating display name for `player` within `allPlayers`.
 *
 * @param player      the player to render
 * @param allPlayers  the roster to disambiguate against (includes `player`)
 * @param opts.activeOnly  when true (default), only `is_active` players count
 *                         toward collisions
 */
export function getDisplayName(
  player: PlayerLike,
  allPlayers: PlayerLike[],
  opts: { activeOnly?: boolean } = {}
): string {
  const { activeOnly = true } = opts;

  const { first, last } = splitName(player.full_name);

  // Single-word name (no last name): nothing to abbreviate, use as-is.
  if (!last) return first;

  const universe = activeOnly
    ? allPlayers.filter(p => p.is_active !== false)
    : allPlayers;

  // Other players sharing this first name (case-insensitive), excluding self.
  const firstLower = first.toLowerCase();
  const peers = universe.filter(
    p => p.id !== player.id && splitName(p.full_name).first.toLowerCase() === firstLower
  );

  // Smallest last-name prefix (>= 1 char) not shared by any same-first-name
  // peer. Cap at the full last name; if a peer still collides there, the full
  // names are identical (out of concern) and we return the full last name.
  let k = 1;
  for (; k < last.length; k++) {
    const prefix = last.slice(0, k).toLowerCase();
    const collision = peers.some(p => {
      const peerLast = splitName(p.full_name).last;
      return peerLast.slice(0, k).toLowerCase() === prefix;
    });
    if (!collision) break;
  }

  return `${first} ${last.slice(0, k)}`;
}
