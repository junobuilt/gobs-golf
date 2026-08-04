// The ONE completion-detection source for the tournament. Both the day status
// tag (Tournament Home + Scoreboard) AND the cup roll-up (deriveCupBar's
// `decided`/`liveNow`) read `isMatchComplete` here — never a second parallel
// check — so "this day is done" and "this match is banked" can never disagree.
//
// A match is COMPLETE when it has an authoritative result: m.resolved.result is
// set — engine walk-off / 18-hole finish, OR an admin override (resolveMatchResult
// applies the override upstream, so this predicate covers both). null → still in
// play. This is exactly the predicate the cup uses to bank a point.

import type { LoadedMatch } from "./types";

export function isMatchComplete(m: LoadedMatch): boolean {
  return m.resolved.result != null;
}

// A day is COMPLETE when it has at least one match and every match is complete.
// Empty (no pairings yet) is NOT complete — an unpaired day is upcoming/live,
// never "done".
export function isDayComplete(matches: readonly LoadedMatch[]): boolean {
  return matches.length > 0 && matches.every(isMatchComplete);
}

// The day status tag. Precedence COMPLETE > LIVE > UPCOMING: a fully-scored day
// reads COMPLETE regardless of the date (fixes "UPCOMING/​LIVE while already
// finished"); otherwise today is LIVE and any other day is UPCOMING.
// (Wording note: "COMPLETE" — swap to "FINAL"/"DONE" here in one line if wanted.)
export type DayTag = "COMPLETE" | "LIVE" | "UPCOMING";

export function dayTag(matches: readonly LoadedMatch[], isToday: boolean): DayTag {
  if (isDayComplete(matches)) return "COMPLETE";
  return isToday ? "LIVE" : "UPCOMING";
}
