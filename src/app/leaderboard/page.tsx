"use client";

// /leaderboard — today's live or completed round.
//
// Four states:
//   - loading
//   - no_round: no row in `rounds` for today's date
//   - no_format: round exists but format not yet picked
//   - results: round exists with format → render shared <RoundResultsView/>
//
// Empty states (no_round / no_format) stay on this page only. The shared
// view replaces the prior bare team cards so tapping a team now drills in
// inline (no extra navigation to /round/[id]/summary). Past rounds will
// route through /round/[id]/summary via the History tab (not yet built).

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import type { Format } from "@/lib/scoring";
import { todayLocal } from "@/lib/date";
import RoundResultsView from "@/components/round/RoundResultsView";
import {
  loadRoundResults,
  type LoadedRoundResults,
} from "@/lib/round/results";

type LeaderboardState =
  | { kind: "loading" }
  | { kind: "no_round"; today: string }
  | { kind: "no_format"; today: string }
  | { kind: "results"; data: LoadedRoundResults };

function prettyDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const C = {
  navy: "#0c3057",
  bgWarm: "#f5f4f0",
  cardBg: "#ffffff",
  cardBorder: "#e2e0db",
  textPrimary: "#1a1a1a",
  textSecondary: "#6b6b6b",
  accentBlue: "#2563eb",
  accentBlueBg: "#eef2ff",
  font: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
};

export default function LeaderboardPage() {
  const [state, setState] = useState<LeaderboardState>({ kind: "loading" });

  const load = useCallback(async () => {
    const today = todayLocal();

    const { data: rounds } = await supabase
      .from("rounds")
      .select("id, format, format_config")
      .eq("played_on", today)
      .order("played_on", { ascending: false })
      .limit(1);

    if (!rounds || rounds.length === 0) {
      setState({ kind: "no_round", today });
      return;
    }

    const round = rounds[0] as { id: number; format: Format | null; format_config: unknown };

    if (round.format === null || round.format_config === null) {
      setState({ kind: "no_format", today });
      return;
    }

    const outcome = await loadRoundResults(round.id);
    if (outcome.status === "missing_round") {
      // Race between the today-query and a deletion. Surface as no-round.
      setState({ kind: "no_round", today });
      return;
    }
    if (outcome.status === "missing_format") {
      setState({ kind: "no_format", today });
      return;
    }
    setState({ kind: "results", data: outcome.data });
  }, []);

  useEffect(() => { load(); }, [load]);

  return <LeaderboardView state={state} />;
}

function LeaderboardView({ state }: { state: LeaderboardState }) {
  if (state.kind === "loading") {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.textSecondary, fontFamily: C.font }}>
        Loading…
      </div>
    );
  }

  // In-page navy state strip mirrors the leaderboard's prior chrome.
  const subtitle = (() => {
    if (state.kind === "no_round") return "No round today";
    if (state.kind === "no_format") return "Round in progress";
    return state.data.isComplete ? "Round complete" : "Round in progress";
  })();

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", fontFamily: C.font, paddingBottom: 140 }}>
      <div style={{
        background: C.navy, color: "white",
        padding: "12px 16px",
      }}>
        <div style={{ fontSize: 11, opacity: 0.85, letterSpacing: "0.3px" }}>
          Semiahmoo · {subtitle}
        </div>
      </div>

      {state.kind === "no_round" || state.kind === "no_format" ? (
        <EmptyHeader dateStr={state.today} />
      ) : (
        <RoundResultsView data={state.data} />
      )}

      {(state.kind === "no_round" || state.kind === "no_format") && <EmptyBody />}
    </div>
  );
}

// Centered "Today's Round" header retained for the empty states so the page
// still feels grounded when there's no round to drill into.
function EmptyHeader({ dateStr }: { dateStr: string }) {
  return (
    <div style={{
      background: "white",
      borderBottom: `1px solid ${C.cardBorder}`,
      padding: 16, textAlign: "center",
    }}>
      <div style={{
        fontSize: 12, color: C.textSecondary,
        textTransform: "uppercase", letterSpacing: "0.5px",
        marginBottom: 6,
      }}>
        Today&apos;s Round
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary }}>
        {prettyDate(dateStr)}
      </div>
    </div>
  );
}

function EmptyBody() {
  return (
    <>
      <div style={{
        background: "white",
        border: `2px dashed ${C.cardBorder}`,
        borderRadius: 12,
        padding: "40px 20px", textAlign: "center",
        margin: 16,
      }}>
        <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.5 }}>⛳</div>
        <div style={{
          fontSize: 16, fontWeight: 600,
          color: C.textPrimary, marginBottom: 6,
        }}>
          No round started yet
        </div>
        <div style={{
          fontSize: 13, color: C.textSecondary,
          lineHeight: 1.4,
        }}>
          Once today&apos;s round begins and a format is picked,
          team standings will show here.
        </div>
      </div>
      <div style={{ textAlign: "center", marginTop: 4 }}>
        <Link href="/season" style={{
          fontSize: 13, color: C.navy,
          textDecoration: "none", fontWeight: 600,
        }}>
          View season stats →
        </Link>
      </div>
    </>
  );
}

