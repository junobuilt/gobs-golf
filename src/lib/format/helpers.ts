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
