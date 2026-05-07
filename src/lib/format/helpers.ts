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
