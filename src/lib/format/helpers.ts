import type { Format, FormatConfig } from "@/lib/scoring/types";
import { DEFAULT_FORMAT_CONFIG } from "./copy";

export type RoundForFormatGate = {
  format: Format | null;
  is_complete: boolean;
} | null;

export type RoundForLockGate = {
  format_locked_at: string | null;
} | null;

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
