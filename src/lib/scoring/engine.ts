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

export function computeHoleResult(input: HoleInput): HoleResult {
  switch (input.format) {
    case "2_ball":
    case "3_ball":
      return computeBestNHole(input);
    case "stableford_standard":
    case "stableford_modified":
    case "gobs_house":
      throw new Error(`Format ${input.format} not yet supported`);
  }
}

export function computeRoundResult(input: RoundInput): RoundResult {
  const { format, formatConfig, holes, players, manualContributors } = input;

  const perHole: Array<{ holeNumber: number; result: HoleResult }> = [];
  let teamScoreTotal = 0;
  let teamParAtScored = 0;
  let holesScored = 0;
  let anyTeamScore = false;

  const bestN = formatConfig.best_n ?? defaultBestN(format);

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
      teamParAtScored += hole.par * bestN;
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
