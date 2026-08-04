// The ONE tournament format-label source. Every read/admin surface imports
// FORMAT_LABEL from here — never a local per-file map (they drifted: several
// surfaces still said "Alternate Shot" after the "Modified Alternate Shot"
// rename shipped elsewhere). Display-only: the stored `tournament_sessions.format`
// stays the canonical value (`greensomes` etc.); this maps it to the words shown.
//
// Day 1's greensomes is GOBS's "Modified Alternate Shot" (see the game rules) —
// the DB format is `greensomes`; only the label reads "Modified Alternate Shot".

import type { SessionFormat } from "./types";

export const FORMAT_LABEL: Record<SessionFormat, string> = {
  greensomes: "Modified Alternate Shot",
  four_ball_match: "Best Ball",
  singles_match: "Singles",
};
