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
  if (format === "best_ball") return 1;
  throw new Error(`Best-N undefined for format ${format}`);
}

function computeBestNHole(input: HoleInput): HoleResult {
  const { hole, players, formatConfig, manualContributors } = input;
  const basis = formatConfig.basis;
  const isOverrideHole = (formatConfig.override_holes ?? []).includes(hole.holeNumber);

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

  const valueOf = (pp: PlayerHoleResult) =>
    basis === "gross" ? pp.grossScore : pp.netScore;

  let contributingPlayerIds: string[] = [];
  let countIsValid = false;

  if (isOverrideHole) {
    // Override wins over manualContributors. Every player with a non-null
    // score on the chosen basis contributes — reduces best-N to "best-all"
    // for this hole. format_config.override_holes is a per-round admin
    // decision (e.g., "all scores count on holes 9 and 18").
    contributingPlayerIds = perPlayer
      .filter(p => valueOf(p) != null)
      .map(p => p.playerId);
    countIsValid = contributingPlayerIds.length > 0;
  } else {
    // bestN is computed lazily here so it isn't evaluated on override holes
    // (defaultBestN throws for non-best-N formats; we don't want a dead call).
    const bestN = formatConfig.best_n ?? defaultBestN(input.format);
    if (manualContributors) {
      contributingPlayerIds = manualContributors;
    } else {
      // Tie-breaking rule: when player scores tie for a contributing
      // position, the player passed first in input order is chosen.
      // Callers must pass players in their preferred tie-resolution order.
      // Stable sort preserves input order for equal compare values.
      const candidates = perPlayer
        .map((pp, idx) => ({ playerId: pp.playerId, sortValue: valueOf(pp), idx }))
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
    countIsValid = contributingPlayerIds.length === bestN;
  }

  let teamScore: number | null = null;
  if (countIsValid) {
    const vals = contributingPlayerIds.map(id => {
      const pp = perPlayer.find(p => p.playerId === id);
      return pp ? valueOf(pp) : null;
    });
    if (vals.every(v => v != null)) {
      teamScore = (vals as number[]).reduce((sum, v) => sum + v, 0);
    }
    // else: a contributor's score is null (manual override pointed at an
    // unscored player) — team score not computable.
  }

  for (const pp of perPlayer) {
    pp.isContributing =
      teamScore != null && contributingPlayerIds.includes(pp.playerId);
  }

  return {
    teamScore,
    contributingPlayerIds: teamScore == null ? [] : contributingPlayerIds,
    perPlayer,
  };
}

// ─── Stableford formats ─────────────────────────────────────────────────────
// Standard / GOBS Stableford are points-based: every player's net score vs par
// maps to a points bucket; the team's hole score is the sum of all non-null
// members' points. Higher team scores win.
//
// Stableford Standard's table is locked (not editable per round). GOBS
// Stableford's table is editable per round via format_config.point_values —
// admin overrides any of: doubleBogeyOrWorse, bogey, par, birdie, eagle,
// albatross. Keys not listed fall through to the GOBS defaults.
//
// Both tables locked 2026-05-10. See ROADMAP "Stableford point values".

type StablefordPointTable = {
  doubleBogeyOrWorse: number; // delta >= +2
  bogey: number;              // delta == +1
  par: number;                // delta ==  0
  birdie: number;             // delta == -1
  eagle: number;              // delta == -2
  albatross: number;          // delta <= -3 (caps for any score better than albatross)
};

export const STABLEFORD_STANDARD_POINTS: StablefordPointTable = {
  doubleBogeyOrWorse: 0,
  bogey: 1,
  par: 2,
  birdie: 3,
  eagle: 5,
  albatross: 8,
};

export const GOBS_STABLEFORD_POINTS: StablefordPointTable = {
  doubleBogeyOrWorse: -1,
  bogey: 0,
  par: 2,
  birdie: 3,
  eagle: 5,
  albatross: 8,
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
  // format_config.override_holes is also a no-op for Stableford: every
  // player already contributes, so an "all scores count" override changes
  // nothing. The override only affects best-N format selection.

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
    case "best_ball":
      return computeBestNHole(input);
    case "stableford_standard":
      return computeStablefordHole(input, STABLEFORD_STANDARD_POINTS);
    case "gobs_stableford":
      return computeStablefordHole(
        input,
        mergePointTable(GOBS_STABLEFORD_POINTS, input.formatConfig.point_values),
      );
  }
}

export function computeRoundResult(input: RoundInput): RoundResult {
  const { format, formatConfig, holes, players, manualContributors, blindDraws } = input;

  const perHole: Array<{ holeNumber: number; result: HoleResult }> = [];
  let teamScoreTotal = 0;
  let teamParAtScored = 0;
  let holesScored = 0;
  let anyTeamScore = false;

  // teamParAtScored is a stroke-play concept (par × number of contributing
  // scores). It's meaningful for 2-Ball / 3-Ball / Best Ball and stays at 0
  // for Stableford formats, which are points-based and have no team-level
  // "par" reference.
  const isBestN = format === "2_ball" || format === "3_ball" || format === "best_ball";

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
      // par × number of contributing scores. Equals par × bestN on normal
      // holes (where contributingPlayerIds.length === bestN by construction)
      // and par × (count of non-null scorers) on override holes — the par
      // reference scales with the number of scores actually counting.
      if (isBestN) teamParAtScored += hole.par * result.contributingPlayerIds.length;
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

  // Blind-draw aggregation. Stableford-only this session — for best-N
  // formats the engine silently ignores blindDraws (returns 0/{}). The
  // drawn player's CH and stroke-index come from THEIR tee (carried on
  // BlindDrawInput.drawnPlayerHoles), not the short team's tee. Points
  // accrue to a separate accumulator (NOT mutated into perHole[h]
  // .teamScore) so the per-hole invariant "teamScore = sum of
  // perPlayer.points on that hole" stays intact for the team's own roster.
  // TODO: Best-N blind-draw scoring — see ROADMAP TD/D1 follow-up.
  let blindDrawTotal = 0;
  const blindDrawPerHole: Record<number, number> = {};
  const stablefordTable: StablefordPointTable | null =
    format === "stableford_standard"
      ? STABLEFORD_STANDARD_POINTS
      : format === "gobs_stableford"
        ? mergePointTable(GOBS_STABLEFORD_POINTS, formatConfig.point_values)
        : null;

  if (stablefordTable && blindDraws && blindDraws.length > 0) {
    for (const fill of blindDraws) {
      for (let h = fill.holeRangeStart; h <= fill.holeRangeEnd; h++) {
        const drawnHole = fill.drawnPlayerHoles.find(dh => dh.holeNumber === h);
        if (!drawnHole) continue;
        const gross = fill.drawnPlayerScores[h];
        if (gross == null) continue;
        const strokes = getHandicapStrokes(fill.drawnPlayerCourseHandicap, drawnHole.strokeIndex);
        const net = gross - strokes;
        const pts = getStablefordPoints(net, drawnHole.par, stablefordTable);
        blindDrawPerHole[h] = (blindDrawPerHole[h] ?? 0) + pts;
        blindDrawTotal += pts;
      }
    }
  }

  return {
    teamScore: anyTeamScore ? teamScoreTotal : null,
    teamParAtScored,
    perHole,
    perPlayer,
    holesScored,
    blindDrawTotal,
    blindDrawPerHole,
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
