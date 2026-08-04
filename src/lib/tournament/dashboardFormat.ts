// Phase 4 dashboard — pure status-line formatting for the all-matches list.
//
// SSOT: reads a LoadedMatch's canonical `.resolved` (authoritative result —
// admin override already applied) and `.state` (live engine view), reusing the
// SAME label helpers the match scorecard uses (marginWithSide / thruDisplay).
// No recompute. Decided rows read the authoritative result; an admin-forced
// result with zero/partial scores still reads as decided (state may be "pending"
// but resolved.result is set). In-play rows read thruDisplay = closedOutHole ??
// thru — a decided early closeout's margin already encodes its hole.

import type { LoadedMatch } from "./types";
import { marginWithSide, thruDisplay } from "./matchScorecard";

export interface MatchStatusLine {
  decided: boolean;
  adminForced: boolean; // resolved via admin override (source === "admin")
  text: string; // "USA wins 3&2" | "Halved" | "USA 1 UP · thru 7 holes" | "Not started"
}

export function matchStatusLine(m: LoadedMatch): MatchStatusLine {
  const result = m.resolved.result;
  const adminForced = m.resolved.source === "admin";

  if (result != null) {
    // Decided (engine OR admin). A margin string only exists when the engine
    // actually completed the match; an admin force with no/partial scores has
    // none, so we show a bare "wins".
    const engineComplete = m.state.status === "complete";
    if (result === "halved") return { decided: true, adminForced, text: "Halved" };
    const sideName = result === "side_a" ? m.sideA.displayName : m.sideB.displayName;
    const hasMargin = engineComplete && !!m.state.margin && m.state.margin !== "AS";
    const margin = hasMargin ? ` ${m.state.margin}` : "";
    return { decided: true, adminForced, text: `${sideName} wins${margin}` };
  }

  // In play. marginWithSide → "Tied" / "USA 1 UP" / ""; thruDisplay →
  // closedOutHole ?? thru (null closeout while live, so just thru).
  const margin = marginWithSide(m.state, m);
  if (m.state.thru === 0 && !margin) return { decided: false, adminForced, text: "Not started" };
  return { decided: false, adminForced, text: `${margin || "Tied"} · thru ${thruDisplay(m.state)} holes` };
}
