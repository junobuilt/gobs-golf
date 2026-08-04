// The ONE match-play status formatter for every read surface (Scoreboard row,
// homepage match card, Tournament Home pairing card). Canonical match state →
// approved vocabulary + a leader tone. Pure: reads a LoadedMatch's `.state`
// (live engine view) and `.resolved` (authoritative result — admin override
// already applied); recomputes NO outcome/margin/point. This SUPERSEDES the
// shipped "Tied" wording — the engine still emits the canonical "AS"/"3&2"
// (goldens assert it); this is the DISPLAY layer.
//
// Approved words (mock v4): "All Square", "2 UP", "Dormie", "3 & 2" (spaced),
// "Halved", "Not started", and the full sentence "USA wins 3 & 2".

import { formatCupPoints } from "./cup";
import type { LoadedMatch, Side } from "./types";

export type StatusTone = "usa" | "canada" | "square" | "pre";

export interface MatchStatusView {
  text: string; // the compact chip: "2 UP" | "All Square" | "Dormie" | "3 & 2" | "Halved" | "Not started"
  tone: StatusTone; // color selector (usa=blue A up, canada=red C up, square=neutral, pre=muted)
  leaderSide: Side | null;
  decided: boolean;
  thruText: string; // right-column context: "thru 13 holes" | "Final" | "Not started"
  winnerSentence: string | null; // full form for aria / any sentence surface: "USA wins 3 & 2" | "Halved"
}

// "3&2" → "3 & 2"; "2 UP" is already spaced (no "&"). Display only.
export function spaceMargin(margin: string): string {
  return margin.replace("&", " & ");
}

const TOTAL_HOLES = 18;

export function matchStatus(m: LoadedMatch): MatchStatusView {
  const st = m.state;
  const resolved = m.resolved.result; // authoritative (admin override applied upstream)

  if (resolved != null) {
    if (resolved === "halved") {
      return { text: "Halved", tone: "square", leaderSide: null, decided: true, thruText: "Final", winnerSentence: "Halved" };
    }
    const leader: Side = resolved === "side_a" ? "a" : "b";
    const name = leader === "a" ? m.sideA.displayName : m.sideB.displayName;
    // A margin string only exists when the ENGINE actually completed the match;
    // an admin force with no/partial scores has none → a bare "wins".
    const engineComplete = st.status === "complete";
    const marginRaw = engineComplete && st.margin && st.margin !== "AS" ? st.margin : null;
    const margin = marginRaw ? spaceMargin(marginRaw) : null;
    return {
      text: margin ?? "Won",
      tone: leader === "a" ? "usa" : "canada",
      leaderSide: leader,
      decided: true,
      thruText: "Final",
      winnerSentence: `${name} wins${margin ? ` ${margin}` : ""}`,
    };
  }

  // In play.
  if (st.thru === 0) {
    return { text: "Not started", tone: "pre", leaderSide: null, decided: false, thruText: "Not started", winnerSentence: null };
  }
  if (st.holesUp === 0) {
    return { text: "All Square", tone: "square", leaderSide: null, decided: false, thruText: `thru ${st.thru} holes`, winnerSentence: null };
  }
  const leader: Side = st.holesUp > 0 ? "a" : "b";
  const lead = Math.abs(st.holesUp);
  const remaining = TOTAL_HOLES - st.thru;
  // Dormie: the lead exactly equals the holes remaining (a win-or-halve lock).
  // The engine already closes out when lead EXCEEDS remaining, so this only
  // fires while still live. Reads state fields only — no recompute.
  const text = lead === remaining ? "Dormie" : `${lead} UP`;
  return {
    text,
    tone: leader === "a" ? "usa" : "canada",
    leaderSide: leader,
    decided: false,
    thruText: `thru ${st.thru} holes`,
    winnerSentence: null,
  };
}

// Per-match tally shown as "pts" on each side. Points come from MatchState
// (holes won + ½ per halve, through `thru`); a not-yet-started match shows "—".
// One helper so every surface renders the SAME pts (SSOT with the status).
export function matchSidePoints(m: LoadedMatch): { a: string; b: string } {
  if (m.state.thru === 0) return { a: "—", b: "—" };
  return { a: formatCupPoints(m.state.pointsA), b: formatCupPoints(m.state.pointsB) };
}
