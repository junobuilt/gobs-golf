"use client";

// F.1 Part 4 — admin Settings → History tab. Renders the SAME finalized-round
// list component as the global /history tab (do not fork), composed with an
// admin-only "In progress" section pinned at the top. That pinned section is
// the only place a round left open 2+ days ago surfaces: the homepage only
// shows today + yesterday's unfinished rounds, and the Leaderboard shows today
// only — so a stale open round is invisible everywhere else.
//
// Finalized rows → /round/[id]/summary (via HistoryRoundList). In-progress rows
// → the live scorecard so the admin can resume/correct scoring.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { loadRoundsList, type RoundListItem } from "@/lib/round/loadRoundsList";
import HistoryRoundList from "@/components/history/HistoryRoundList";

type InProgressRound = { id: number; played_on: string };

function formatDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

export default function History() {
  const [rounds, setRounds] = useState<RoundListItem[]>([]);
  const [inProgress, setInProgress] = useState<InProgressRound[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [items, { data: openRows }] = await Promise.all([
        loadRoundsList(),
        supabase
          .from("rounds")
          .select("id, played_on")
          .eq("is_complete", false)
          .order("played_on", { ascending: false }),
      ]);
      if (cancelled) return;
      setRounds(items);
      setInProgress((openRows ?? []) as InProgressRound[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "0.88rem" }}>
        Loading history…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "24px 16px" }}>
      {inProgress.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: "#92400e", textTransform: "uppercase",
            letterSpacing: "0.5px", marginBottom: 8, paddingLeft: 2,
          }}>
            In progress
          </div>
          {inProgress.map(r => (
            <Link
              key={r.id}
              href={`/round/${r.id}/scorecard?admin=1`}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                textDecoration: "none", color: "inherit",
                background: "#fff6e0", border: "1px solid #ecd9a6", borderRadius: 12,
                padding: "13px 15px", marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700, color: "#042C53" }}>
                {formatDate(r.played_on)}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, color: "#92400e",
                  background: "#fdebc4", borderRadius: 999, padding: "2px 9px",
                }}>
                  In progress
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#8c5010" }}>Resume →</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      <HistoryRoundList rounds={rounds} />
    </div>
  );
}
