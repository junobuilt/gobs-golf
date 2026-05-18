"use client";

// /round/[id]/summary — historical or completed-round results view.
// Loads round data via the shared `loadRoundResults` helper and renders
// the shared `RoundResultsView` component (also used by /leaderboard for
// today's round). Adds a "← Back" affordance specific to this page.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import RoundResultsView from "@/components/round/RoundResultsView";
import {
  loadRoundResults,
  type LoadRoundResultsOutcome,
} from "@/lib/round/results";

const FONT = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif";
const TEXT_SECONDARY = "#6b6b6b";

type PageState = LoadRoundResultsOutcome | { status: "loading" };

export default function RoundSummaryPage() {
  const params = useParams();
  const roundIdNum = Number(params.id as string);

  const [state, setState] = useState<PageState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const outcome = await loadRoundResults(roundIdNum);
      if (!cancelled) setState(outcome);
    })();
    return () => { cancelled = true; };
  }, [roundIdNum]);

  if (state.status === "loading") {
    return (
      <div style={{ padding: 40, textAlign: "center", color: TEXT_SECONDARY, fontFamily: FONT }}>
        Loading…
      </div>
    );
  }
  if (state.status === "missing_round") {
    return (
      <div style={{ padding: 40, textAlign: "center", color: TEXT_SECONDARY, fontFamily: FONT }}>
        Round not found.
      </div>
    );
  }
  if (state.status === "missing_format") {
    return (
      <div style={{ padding: 40, textAlign: "center", color: TEXT_SECONDARY, fontFamily: FONT }}>
        Format not yet picked for this round.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", fontFamily: FONT, paddingBottom: 140 }}>
      <div style={{
        padding: "12px 16px 0",
        background: "white",
        fontSize: 12, fontWeight: 600, color: TEXT_SECONDARY,
      }}>
        <Link href="/" style={{ color: "inherit", textDecoration: "none" }}>← Back</Link>
      </div>
      <RoundResultsView data={state.data} />
    </div>
  );
}
