"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { todayLocal } from "@/lib/date";
import { getTournamentMode } from "@/lib/tournament/mode";
import { loadDashboard, type DashboardData, type DashboardDay } from "@/lib/tournament/loadDashboard";
import { deriveCupBar } from "@/lib/tournament/cup";
import { CupHero } from "./CupHero";
import { TournamentMatchCard } from "./TournamentMatchCard";
import { TOURNAMENT_TOKENS as T, FOCUS_CLASS } from "@/lib/tournament/tokens";
import type { SessionFormat, Tournament } from "@/lib/tournament/types";

// Homepage tournament block (mock v4 "Home"). Self-contained (its own fetch) so
// the league homepage is byte-identical when there's nothing to show: renders
// NULL unless tournament mode is publicly ON. When on, it shows the standardized
// cup hero (PointsBar) + today's tournament match cards — all slaved to the
// admin Live/Test toggle via getTournamentMode(). SSOT: the bar is deriveCupBar
// over the same loadDashboard the Scoreboard uses.

const FORMAT_LABEL: Record<SessionFormat, string> = {
  greensomes: "Modified Alternate Shot",
  four_ball_match: "Best Ball",
  singles_match: "Singles",
};

interface Ready {
  tournament: Tournament;
  data: DashboardData;
}

function currentDayNumber(days: DashboardDay[], today: string): number {
  const todays = days.find((d) => d.session.played_on === today);
  if (todays) return todays.session.day_number;
  const past = days.filter((d) => (d.session.played_on ?? "") !== "" && (d.session.played_on ?? "") <= today);
  if (past.length) return Math.max(...past.map((d) => d.session.day_number));
  return days[0]?.session.day_number ?? 1;
}

export default function TournamentHero() {
  const [ready, setReady] = useState<Ready | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const tournament = await getTournamentMode();
        if (cancelled || !tournament) return;
        const data = await loadDashboard(tournament.id, tournament);
        if (!cancelled) setReady({ tournament, data });
      } catch {
        /* homepage must not break on a tournament-read failure */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!ready) return null;
  const { tournament, data } = ready;
  const today = todayLocal();
  const bar = deriveCupBar(data, tournament);
  const dayNo = currentDayNumber(data.days, today);
  const todayDay = data.days.find((d) => d.session.played_on === today) ?? null;
  const todaysMatches = todayDay?.matches ?? [];

  return (
    <div data-testid="tournament-hero" style={{ marginBottom: 16 }}>
      <CupHero eyebrow={`🏁 Tournament · Day ${dayNo} of ${data.days.length}`} title={tournament.name} bar={bar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 13, gap: 10, background: "rgba(255,255,255,0.08)", borderRadius: 11, padding: "10px 12px" }}>
          {todayDay ? (
            <div style={{ fontSize: 12, lineHeight: 1.45 }}>
              <span style={{ display: "block", fontWeight: 800, letterSpacing: "0.02em", fontSize: 13 }}>Day {todayDay.session.day_number}</span>
              <span style={{ opacity: 0.82 }}>{FORMAT_LABEL[todayDay.session.format]}</span>
            </div>
          ) : (
            <div style={{ fontSize: 12, opacity: 0.82 }}>Follow the cup</div>
          )}
          <Link href="/tournament" data-testid="hero-to-tournament" className={FOCUS_CLASS} style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: "#fff", background: "rgba(255,255,255,0.16)", borderRadius: 8, padding: "9px 12px", textDecoration: "none" }}>
            Tournament Home →
          </Link>
        </div>
      </CupHero>

      {todaysMatches.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted, margin: "0 4px 9px" }}>Today’s matches · tap to score</div>
          {todaysMatches.map((m) => (
            <TournamentMatchCard key={m.match.id} m={m} />
          ))}
          <p data-testid="cardsplit-hint" style={{ fontSize: 11, color: T.muted, textAlign: "center", margin: "4px 0 0" }}>
            A regular league card appears plain grey — never counted toward the cup.
          </p>
        </div>
      )}
    </div>
  );
}
