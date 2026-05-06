import { getHandicapStrokes } from "./handicap";
import type {
  Format,
  HoleInfo,
  HoleInput,
  HoleResult,
  PlayerHoleResult,
  RoundInput,
  RoundResult,
} from "./types";

function defaultBestN(format: Format): number {
  if (format === "2_ball") return 2;
  if (format === "3_ball") return 3;
  throw new Error(`Best-N undefined for format ${format}`);
}

function computeBestNHole(input: HoleInput): HoleResult {
  const { hole, players, formatConfig, manualContributors } = input;
  const bestN = formatConfig.best_n ?? defaultBestN(input.format);
  const basis = formatConfig.basis;

  const perPlayer: PlayerHoleResult[] = players.map(p => {
    const handicapStrokes = getHandicapStrokes(p.courseHandicap, hole.strokeIndex);
    const netScore = p.grossScore == null ? null : p.grossScore - handicapStrokes;
    return {
      playerId: p.playerId,
      grossScore: p.grossScore,
      netScore,
      handicapStrokes,
      isContributing: false,
      points: null, // best-N formats don't award per-hole points
    };
  });

  let contributingPlayerIds: string[] = [];

  if (manualContributors) {
    contributingPlayerIds = manualContributors;
  } else {
    // Tie-breaking rule: when player scores tie for a contributing position, the
    // player passed first in input order is chosen. Callers must pass players in
    // their preferred tie-resolution order. Stable sort preserves input order
    // for equal compare values.
    const candidates = perPlayer
      .map((pp, idx) => ({
        playerId: pp.playerId,
        sortValue: basis === "gross" ? pp.grossScore : pp.netScore,
        idx,
      }))
      .filter(c => c.sortValue != null) as Array<{
        playerId: string;
        sortValue: number;
        idx: number;
      }>;

    candidates.sort((a, b) => a.sortValue - b.sortValue || a.idx - b.idx);

    if (candidates.length >= bestN) {
      contributingPlayerIds = candidates.slice(0, bestN).map(c => c.playerId);
    }
  }

  let teamScore: number | null = null;
  if (contributingPlayerIds.length === bestN) {
    const vals = contributingPlayerIds.map(id => {
      const pp = perPlayer.find(p => p.playerId === id);
      if (!pp) return null;
      return basis === "gross" ? pp.grossScore : pp.netScore;
    });
    if (vals.every(v => v != null)) {
      teamScore = (vals as number[]).reduce((sum, v) => sum + v, 0);
    } else {
      teamScore = null;
      // Manual override pointed at a player without a score; team score not
      // computable for this hole.
    }
  }

  for (const pp of perPlayer) {
    pp.isContributing = contributingPlayerIds.includes(pp.playerId);
  }

  return {
    teamScore,
    contributingPlayerIds: teamScore == null ? [] : contributingPlayerIds,
    perPlayer,
  };
}

// ─── Stableford formats ─────────────────────────────────────────────────────
// Standard / Modified / GOBS House are points-based: every player's net score
// vs par maps to a points bucket; the team's hole score is the sum of all
// non-null members' points. Higher team scores win.
//
// format_config.point_values (Stableford Modified only) may override any of
// these keys: doubleBogeyOrWorse, bogey, par, birdie, eagle, albatross.
// Keys not listed are ignored.

type StablefordPointTable = {
  doubleBogeyOrWorse: number; // delta >= +2
  bogey: number;              // delta == +1
  par: number;                // delta ==  0
  birdie: number;             // delta == -1
  eagle: number;              // delta == -2
  albatross: number;          // delta <= -3 (caps for any score better than albatross)
};

const STABLEFORD_STANDARD_POINTS: StablefordPointTable = {
  doubleBogeyOrWorse: 0,
  bogey: 1,
  par: 2,
  birdie: 3,
  eagle: 4,
  albatross: 5,
};

const GOBS_HOUSE_POINTS: StablefordPointTable = {
  ...STABLEFORD_STANDARD_POINTS,
  doubleBogeyOrWorse: -1,
};

function mergePointTable(
  base: StablefordPointTable,
  overrides: Record<string, number> | undefined,
): StablefordPointTable {
  if (!overrides) return base;
  return {
    doubleBogeyOrWorse: overrides.doubleBogeyOrWorse ?? base.doubleBogeyOrWorse,
    bogey:              overrides.bogey              ?? base.bogey,
    par:                overrides.par                ?? base.par,
    birdie:             overrides.birdie             ?? base.birdie,
    eagle:              overrides.eagle              ?? base.eagle,
    albatross:          overrides.albatross          ?? base.albatross,
  };
}

export function getStablefordPoints(
  netScore: number,
  par: number,
  table: StablefordPointTable,
): number {
  const delta = netScore - par;
  if (delta <= -3) return table.albatross;
  if (delta === -2) return table.eagle;
  if (delta === -1) return table.birdie;
  if (delta === 0)  return table.par;
  if (delta === 1)  return table.bogey;
  return table.doubleBogeyOrWorse; // delta >= 2
}

function computeStablefordHole(input: HoleInput, table: StablefordPointTable): HoleResult {
  const { hole, players } = input;
  // manualContributors is ignored for Stableford — every player who scored
  // contributes to the team total; there is no Ball-1/Ball-2 selection.

  const perPlayer: PlayerHoleResult[] = players.map(p => {
    const handicapStrokes = getHandicapStrokes(p.courseHandicap, hole.strokeIndex);
    const netScore = p.grossScore == null ? null : p.grossScore - handicapStrokes;
    const points = netScore == null ? null : getStablefordPoints(netScore, hole.par, table);
    return {
      playerId: p.playerId,
      grossScore: p.grossScore,
      netScore,
      handicapStrokes,
      isContributing: p.grossScore != null,
      points,
    };
  });

  const scored = perPlayer.filter(p => p.points != null);
  if (scored.length === 0) {
    return { teamScore: null, contributingPlayerIds: [], perPlayer };
  }

  const teamScore = scored.reduce((sum, p) => sum + (p.points as number), 0);
  return {
    teamScore,
    contributingPlayerIds: scored.map(p => p.playerId),
    perPlayer,
  };
}

export function computeHoleResult(input: HoleInput): HoleResult {
  switch (input.format) {
    case "2_ball":
    case "3_ball":
      return computeBestNHole(input);
    case "stableford_standard":
      return computeStablefordHole(input, STABLEFORD_STANDARD_POINTS);
    case "stableford_modified":
      return computeStablefordHole(
        input,
        mergePointTable(STABLEFORD_STANDARD_POINTS, input.formatConfig.point_values),
      );
    case "gobs_house":
      return computeStablefordHole(input, GOBS_HOUSE_POINTS);
  }
}

export function computeRoundResult(input: RoundInput): RoundResult {
  const { format, formatConfig, holes, players, manualContributors } = input;

  const perHole: Array<{ holeNumber: number; result: HoleResult }> = [];
  let teamScoreTotal = 0;
  let teamParAtScored = 0;
  let holesScored = 0;
  let anyTeamScore = false;

  // teamParAtScored is a stroke-play concept (par × best_n contributing scores).
  // It's meaningful for 2-Ball / 3-Ball and stays at 0 for Stableford formats,
  // which are points-based and have no team-level "par" reference.
  const isBestN = format === "2_ball" || format === "3_ball";
  const bestN = isBestN ? (formatConfig.best_n ?? defaultBestN(format)) : 0;

  for (const hole of holes) {
    const holeInput: HoleInput = {
      format,
      formatConfig,
      hole,
      players: players.map(p => ({
        playerId: p.playerId,
        grossScore: p.grossScores[hole.holeNumber] ?? null,
        courseHandicap: p.courseHandicap,
      })),
      manualContributors: manualContributors?.[hole.holeNumber],
    };
    const result = computeHoleResult(holeInput);
    perHole.push({ holeNumber: hole.holeNumber, result });

    if (result.teamScore != null) {
      teamScoreTotal += result.teamScore;
      if (isBestN) teamParAtScored += hole.par * bestN;
      holesScored++;
      anyTeamScore = true;
    }
  }

  const perPlayer = players.map(p => {
    const total = computePlayerRoundTotal(p.grossScores, p.courseHandicap, holes);
    return {
      playerId: p.playerId,
      grossTotal: total.gross,
      netTotal: total.net,
      holesPlayed: total.holesPlayed,
    };
  });

  return {
    teamScore: anyTeamScore ? teamScoreTotal : null,
    teamParAtScored,
    perHole,
    perPlayer,
    holesScored,
  };
}

// Per-player aggregation is currently format-agnostic — it returns gross and
// net stroke totals. When Stableford formats land in B4, format-aware variants
// will be needed (e.g., per-player Stableford points totals). Revisit then.
export function computePlayerRoundTotal(
  grossScores: Record<number, number | null>,
  courseHandicap: number | null,
  holes: HoleInfo[],
): { gross: number; net: number; holesPlayed: number } {
  let gross = 0;
  let net = 0;
  let holesPlayed = 0;
  for (const hole of holes) {
    const score = grossScores[hole.holeNumber];
    if (score == null) continue;
    gross += score;
    const strokes = getHandicapStrokes(courseHandicap, hole.strokeIndex);
    net += score - strokes;
    holesPlayed++;
  }
  return { gross, net, holesPlayed };
}
