// Tournament (Ryder Cup) color + geometry tokens — the SINGLE source of truth
// for the livery, ported verbatim from the signed-off mock
// `docs/design/gobs-ryder-mock-v4.html` (`:root`). USA = blue, always LEFT
// (side "a"); Canada = red, always RIGHT (side "b"). These SUPERSEDE the
// getTeamColor(4)/(6) hues the tournament surfaces borrowed before.
//
// Pure constants — no React/Supabase — so lib helpers and components share one
// definition and can be unit-tested.

import type { Side } from "./types";
import type { DayTag } from "./completion";

export const TOURNAMENT_TOKENS = {
  usa: "#14509E",
  usaInk: "#0E3B75",
  usaBright: "#2f83e6",
  usaDark: "#4d9bff",
  can: "#C8102E",
  canInk: "#8E0B20",
  canBright: "#e6304a",
  canDark: "#ff4d55",
  gold: "#C9A227",
  chromeA: "#0A2E5C",
  chromeB: "#061F3D",
  ink: "#132540",
  muted: "#5B6B82",
  line: "#E4E8EF",
  bg: "#E9EDF2",
  card: "#FFFFFF",
  soft: "#F4F6F9",
  ok: "#1E7D46",
} as const;

const T = TOURNAMENT_TOKENS;

// The unified hero / points-bar gradient (mock `.hero` / `.barwrap`).
export const CHROME_GRADIENT = `linear-gradient(150deg, ${T.chromeA}, ${T.chromeB})`;

// Per-side color families. `a` = USA/blue, `b` = Canada/red — structural, never
// keyed off the admin-set side NAME (the name may read "USA"/"Canada" or
// anything; the slot decides the color + the left/right position).
export const SIDE_TOKENS: Record<Side, { base: string; ink: string; bright: string; dark: string }> = {
  a: { base: T.usa, ink: T.usaInk, bright: T.usaBright, dark: T.usaDark },
  b: { base: T.can, ink: T.canInk, bright: T.canBright, dark: T.canDark },
};

// Day status-tag pill styling (uppercase caps set by the callers). One map so
// the Tournament Home + Scoreboard day tags read identically. LIVE keeps the
// prior red-on-pink; UPCOMING the muted grey; COMPLETE the green `ok` tone.
export const DAY_TAG_STYLE: Record<DayTag, { bg: string; color: string }> = {
  COMPLETE: { bg: "#E7F3EC", color: T.ok },
  LIVE: { bg: "#fdecec", color: T.can },
  UPCOMING: { bg: T.soft, color: T.muted },
};

export function sideColor(side: Side): string {
  return SIDE_TOKENS[side].base;
}
export function sideInk(side: Side): string {
  return SIDE_TOKENS[side].ink;
}

// The gold keyboard-focus ring the mock uses on every interactive element
// (`outline:3px solid var(--gold)`). Applied via the `.tourn-focusable` class
// (globals.css) so focus is always visible for the 60–80 audience.
export const FOCUS_CLASS = "tourn-focusable";
