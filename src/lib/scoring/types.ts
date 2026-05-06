export type Format =
  | "2_ball"
  | "3_ball"
  | "stableford_standard"
  | "stableford_modified"
  | "gobs_house";

export type FormatConfig = {
  basis: "net" | "gross";
  best_n?: number;
  point_values?: Record<string, number>;
  override_holes?: number[];
};

export type HoleInfo = {
  holeNumber: number;
  par: number;
  strokeIndex: number;
};

export type PlayerScoreInput = {
  playerId: string;
  grossScore: number | null;
  courseHandicap: number | null;
};

export type PlayerHoleResult = {
  playerId: string;
  grossScore: number | null;
  netScore: number | null;
  handicapStrokes: number;
  isContributing: boolean;
};

export type HoleResult = {
  teamScore: number | null;
  contributingPlayerIds: string[];
  perPlayer: PlayerHoleResult[];
};

export type HoleInput = {
  format: Format;
  formatConfig: FormatConfig;
  hole: HoleInfo;
  players: PlayerScoreInput[];
  manualContributors?: string[];
};

export type RoundInput = {
  format: Format;
  formatConfig: FormatConfig;
  holes: HoleInfo[];
  players: Array<{
    playerId: string;
    courseHandicap: number | null;
    grossScores: Record<number, number | null>;
  }>;
  manualContributors?: Record<number, string[]>;
};

export type RoundResult = {
  teamScore: number | null;
  teamParAtScored: number;
  perHole: Array<{ holeNumber: number; result: HoleResult }>;
  perPlayer: Array<{
    playerId: string;
    grossTotal: number;
    netTotal: number;
    holesPlayed: number;
  }>;
  holesScored: number;
};
