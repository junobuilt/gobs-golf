import type { Format, FormatConfig } from "@/lib/scoring/types";
import { getPlayingStrokes } from "@/lib/scoring/handicap";
import { DEFAULT_FORMAT_CONFIG } from "./copy";

export type RoundForFormatGate = {
  format: Format | null;
  is_complete: boolean;
} | null;

export type RoundForLockGate = {
  format_locked_at: string | null;
} | null;

// Wave 1B — single source of truth for "is this a TEAM-CARD format?" — i.e. a
// format scored at the team level (one score per hole in `team_scores`, no
// per-player `scores` rows), routed to `/round/[id]/team-card`, finalizing
// WITHOUT blind draw. Every routing + display site (scorecard routing, results
// layer, RoundResultsView rankings gate, RoundSetup allowance gate) consults
// this helper rather than comparing the format string inline.
//
// Wave 1B follow-up: Shambles was REMOVED from this set. Shambles is a best-ball
// NET format scored on the individual scorecard (per-player `scores`), so it is
// NOT team-card — it must route to `/scorecard`, show per-player rankings, and
// allow the handicap allowance. NOTE: Shambles' STATS/GHIN exclusion did NOT
// move with it — that contract now lives in excludedFromIndividualStats() below,
// and its relaxed finalize in allowsIncompleteClose().
//
// Phase 1C: the spine is now LIVE for the two NET team-card formats. They score
// one team ball per hole in `team_scores` (no per-player `scores`), route to
// `/round/[id]/team-card`, take a single team-handicap deduction off the team
// gross (computeTeamHandicap), and finalize via finalize_round_team_card (every
// team scores every hole; no blind draw). Adding a format here cascades through
// every routing + display + finalize site that consults this helper.
const TEAM_CARD_FORMATS = new Set<Format>(["texas_scramble", "alternate_shot"]);

export function isTeamCardFormat(format: Format | null | undefined): boolean {
  if (!format) return false;
  return TEAM_CARD_FORMATS.has(format);
}

// Wave 1B follow-up — "should this round be kept OUT of per-player season stats,
// GHIN-adjusted scores, and profile per-round history?" Returns true for every
// team-card format (no individual scores exist) AND for Shambles (individual
// scores exist but aren't authoritative — picked-up balls, relaxed close, so
// they must not move season averages). This is deliberately split from
// isTeamCardFormat(): reclassifying Shambles off the team-card spine must NOT
// re-leak it into season stats. Read sites: playerStats.ts, season/page.tsx,
// player/[id]/page.tsx. (Shambles STAYS in played-with — the partnership is real.)
export function excludedFromIndividualStats(
  format: Format | null | undefined,
): boolean {
  if (!format) return false;
  return isTeamCardFormat(format) || format === "shambles";
}

// Wave 1B follow-up — "does this format finalize even with score gaps?" True for
// Shambles only. Shambles allows a relaxed close (players pick up; the team takes
// the best N net among the scores PRESENT on each hole), so it finalizes via
// finalize_round_relaxed (>=1 score per hole per team floor, no blind draw)
// instead of finalize_round_with_blind_draws. Drives the INDIVIDUAL scorecard's
// Submit-enable gate and finalize-RPC selection.
//
// Phase 1C: the NET team-card formats (Texas Scramble / Alternate Shot) are NOT
// included — they are full-completion (every team scores every hole) and finalize
// via their own finalize_round_team_card on the team-card surface, which never
// consults this helper. Keeping them out keeps "incomplete close" meaning the
// relaxed-pickup semantics it was written for.
export function allowsIncompleteClose(
  format: Format | null | undefined,
): boolean {
  return format === "shambles";
}

// Wave 1B — reads the per-round team-card ball count (1 or 2). Null/undefined
// config, a missing key, or any non-finite/out-of-range value falls back to 1
// (back-compat for every non-team-card and pre-1B round). Clamped to [1, 2]
// defensively against malformed JSON in the column (mirrors getHandicapAllowance).
export function getTeamBallCount(
  formatConfig: FormatConfig | null | undefined,
): number {
  if (!formatConfig) return 1;
  const n = formatConfig.team_ball_count;
  if (typeof n !== "number" || !Number.isFinite(n)) return 1;
  if (n < 1) return 1;
  if (n > 2) return 2;
  return Math.round(n);
}

export function roundNeedsFormat(round: RoundForFormatGate): boolean {
  if (!round) return false;
  if (round.is_complete) return false;
  return round.format === null;
}

export function isFormatLocked(round: RoundForLockGate): boolean {
  if (!round) return false;
  return round.format_locked_at !== null;
}

export function defaultConfigFor(format: Format): FormatConfig {
  return { ...DEFAULT_FORMAT_CONFIG[format] };
}

// Reads the persistent admin choice for net vs gross scoring with a "net"
// fallback for any pre-B3.2 round (or any other source that didn't set the
// key explicitly). Use at every engine call site so the fallback lives in one
// place. Accepts null/undefined config to keep call sites terse.
export function getScoringBasis(
  formatConfig: FormatConfig | null | undefined,
): "net" | "gross" {
  if (!formatConfig) return "net";
  return formatConfig.scoring_basis === "gross" ? "gross" : "net";
}

// Wave 1A — reads the per-round handicap allowance as an integer percent.
// Null/undefined config, a missing key, or any non-finite/out-of-range value
// falls back to 100 (full handicap) — back-compat for every pre-1A round.
// Clamped to [10, 100] defensively in case a malformed value ever lands in the
// JSON column (mirrors getOverrideHoles' defensive shape handling). The UI
// enforces the 10–100 step-of-10 range; this reader only guards the floor/ceil.
export function getHandicapAllowance(
  formatConfig: FormatConfig | null | undefined,
): number {
  if (!formatConfig) return 100;
  const a = formatConfig.handicap_allowance;
  if (typeof a !== "number" || !Number.isFinite(a)) return 100;
  if (a < 10) return 10;
  if (a > 100) return 100;
  return a;
}

// Wave 1A follow-up (2026-06-09) — THE single function returning a player's
// allowance-adjusted PLAYING course handicap for a round. Wraps getPlayingStrokes
// (the one place the allowance % scales a CH) with this round's allowance read.
// Every site that displays a CH number, draws stroke dots, or feeds the net
// engine reads THIS value, so the number shown can never drift from the number
// scored again (the 2026-06-09 fix collapsed two sources into this one).
//
// Operates on the stored (rounded) course_handicap — the exact input the engine
// already scores on. Deliberately NOT the unrounded CH: applying the allowance
// to the unrounded value would change competition net for some players (a
// scoring-engine change, out of scope). Null CH stays null; 100% is the identity.
export function getPlayingCourseHandicap(
  rawCourseHandicap: number | null,
  formatConfig: FormatConfig | null | undefined,
): number | null {
  return getPlayingStrokes(rawCourseHandicap, getHandicapAllowance(formatConfig));
}

// The admin handicap-allowance options (5% steps, 100→10). Shared by the
// flight-level control (RoundSetup flight card) and the per-team override control
// (RoundSetup team card + scorecard header) so they offer the identical set.
export const ALLOWANCE_OPTIONS = [
  100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 20, 15, 10,
];

// Per-team handicap-allowance override — THE rule (lives here, the allowance
// home; re-exported by src/lib/flights/resolve.ts for the flight surfaces). A
// team's EFFECTIVE config is its flight's config with the per-team allowance
// substituted in when one is set; `null`/`undefined` override → the flight config
// unchanged (so a round with no overrides is byte-identical to before). Kept here
// (pure, no supabase) so the pure scoring core — teamTotals.ts — can fold an
// override into its per-team config without importing the supabase-coupled
// resolver. The override value is the raw % an admin chose; downstream
// getHandicapAllowance still clamps [10,100].
export function effectiveTeamConfig(
  flightConfig: FormatConfig | null,
  allowanceOverride: number | null | undefined,
): FormatConfig | null {
  if (allowanceOverride == null) return flightConfig;
  return {
    ...(flightConfig ?? {}),
    handicap_allowance: allowanceOverride,
  } as FormatConfig;
}

// Returns the override-hole list (per-round "all scores count on these
// holes" admin choice). Null/undefined config returns []. Defensive against
// non-array shapes in case malformed JSON ever lands in the column.
export function getOverrideHoles(
  formatConfig: FormatConfig | null | undefined,
): number[] {
  if (!formatConfig) return [];
  const holes = formatConfig.override_holes;
  if (!Array.isArray(holes)) return [];
  return holes;
}
