"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { getActiveTournament } from "@/lib/tournament/queries";
import type { Tournament } from "@/lib/tournament/types";

// Homepage tournament hero. Self-contained (its own fetch) so the league
// homepage is byte-identical when there's nothing to show: it renders NULL
// unless a LIVE (is_published) tournament that hasn't ended (ended_on IS NULL)
// exists. Tapping it → the public /tournament landing.
export default function TournamentHero() {
  const [tournament, setTournament] = useState<Tournament | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const t = await getActiveTournament();
        if (cancelled) return;
        if (t && t.is_published && t.ended_on == null) setTournament(t);
      } catch {
        /* homepage must not break on a tournament-read failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!tournament) return null;

  return (
    <Link
      href="/tournament"
      data-testid="tournament-hero"
      style={{
        display: "block",
        textDecoration: "none",
        background: "linear-gradient(135deg, #0e4270, #0b2d50)",
        color: "white",
        borderRadius: "12px",
        padding: "16px 18px",
        marginBottom: "16px",
      }}
    >
      <div style={{ fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.85 }}>
        🏆 Tournament
      </div>
      <div style={{ fontSize: "1.15rem", fontWeight: 800, marginTop: "2px" }}>{tournament.name}</div>
      <div style={{ fontSize: "0.85rem", marginTop: "6px", opacity: 0.9 }}>
        {tournament.side_a_name} vs {tournament.side_b_name} · View pairings →
      </div>
    </Link>
  );
}
