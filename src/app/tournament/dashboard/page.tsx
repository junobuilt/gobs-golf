"use client";

// Phase 4 — public tournament dashboard. The scoreboard Dad asked for: a
// tournament-wide USA X — Canada Y (banked/decided only, ½ per halve) plus the
// all-matches list across every day. Same public gating as the landing
// (is_active + is_published). Every value comes from the canonical loader
// (loadDashboard → computeTournamentStandings; status via the shared
// MatchState helpers) — the page computes NOTHING.

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { todayLocal, formatDisplayDate } from "@/lib/date";
import { getTeamColor } from "@/lib/teamColors";
import { getActiveTournament } from "@/lib/tournament/queries";
import { loadDashboard, type DashboardData, type DashboardDay } from "@/lib/tournament/loadDashboard";
import { matchStatusLine } from "@/lib/tournament/dashboardFormat";
import { formatPoints } from "@/lib/tournament/matchScorecard";
import type { LoadedMatch, SessionFormat, Side, Tournament } from "@/lib/tournament/types";

// Side A = blue, Side B = red — the shared §0 palette (landing + scorecard).
const SIDE_COLOR: Record<Side, string> = {
  a: getTeamColor(4).pillText,
  b: getTeamColor(6).pillText,
};

const FORMAT_LABEL: Record<SessionFormat, string> = {
  greensomes: "Alternate Shot",
  four_ball_match: "Best Ball",
  singles_match: "Singles",
};

type State =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ready"; tournament: Tournament; data: DashboardData };

async function load(): Promise<State> {
  const tournament = await getActiveTournament();
  // Player-facing gate: only a Live (published) tournament shows. Test/none →
  // clean empty state (never a crash).
  if (!tournament || !tournament.is_published) return { kind: "empty" };
  const data = await loadDashboard(tournament.id);
  return { kind: "ready", tournament, data };
}

export default function TournamentDashboardPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const doLoad = useCallback(async () => {
    setState(await load());
  }, []);

  useEffect(() => {
    void doLoad();
  }, [doLoad]);

  if (state.kind === "loading") {
    return (
      <Shell>
        <p style={{ color: "#6b7280" }}>Loading…</p>
      </Shell>
    );
  }
  if (state.kind === "empty") {
    return (
      <Shell>
        <div
          data-testid="dashboard-empty"
          style={{
            background: "white",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: "10px",
            padding: "24px 20px",
            textAlign: "center",
            color: "#374151",
          }}
        >
          <div style={{ fontSize: "1.6rem", marginBottom: "8px" }}>🏆</div>
          No tournament is live right now. Check back when the next one starts.
        </div>
      </Shell>
    );
  }

  const { tournament, data } = state;
  const { standings } = data;
  const today = todayLocal();
  const totalMatches = data.days.reduce((n, d) => n + d.matches.length, 0);
  const inPlay = standings.inPlay.length;
  const decided = totalMatches - inPlay;

  return (
    <Shell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: "1.35rem", fontWeight: 800, color: "#0c3057" }}>{tournament.name}</div>
        <Link href="/tournament" data-testid="to-landing" style={{ fontSize: "0.8rem", fontWeight: 600, color: "#1a5a8c", textDecoration: "none", whiteSpace: "nowrap" }}>
          Find your match →
        </Link>
      </div>

      {/* Country score header — banked (decided only, ½ halves). */}
      <div
        data-testid="country-score"
        style={{
          background: "#0c3057",
          borderRadius: 12,
          padding: "18px 16px",
          marginBottom: 12,
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-around",
          textAlign: "center",
        }}
      >
        <ScoreSide name={tournament.side_a_name} points={standings.banked.a} color={getTeamColor(4).pillText} />
        <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#9fb3c8" }}>—</div>
        <ScoreSide name={tournament.side_b_name} points={standings.banked.b} color={getTeamColor(6).pillText} />
      </div>

      {/* Banked / in-play split (no projected — cut by spec). */}
      <div
        data-testid="banked-inplay"
        style={{ display: "flex", gap: 10, marginBottom: 16 }}
      >
        <SplitCard label="Banked" value={`${decided} decided`} sub={`${formatPoints(standings.banked.a)} · ${formatPoints(standings.banked.b)}`} />
        <SplitCard label="In play" value={`${inPlay} live`} sub={inPlay > 0 ? "not yet counted" : "—"} />
      </div>

      {data.days.map((day) => (
        <DaySection
          key={day.session.id}
          day={day}
          isToday={day.session.played_on === today}
          sideAName={tournament.side_a_name}
          sideBName={tournament.side_b_name}
        />
      ))}
    </Shell>
  );
}

function ScoreSide({ name, points, color }: { name: string; points: number; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1 }}>{formatPoints(points)}</div>
      <div style={{ fontSize: "0.85rem", fontWeight: 700, marginTop: 4, color }}>{name}</div>
    </div>
  );
}

function SplitCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{ flex: 1, background: "white", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: "0.68rem", fontWeight: 800, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: "1rem", fontWeight: 700, color: "#0c3057", marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: "0.78rem", color: "#6b7280", marginTop: 1 }}>{sub}</div>
    </div>
  );
}

function DaySection({
  day,
  isToday,
  sideAName,
  sideBName,
}: {
  day: DashboardDay;
  isToday: boolean;
  sideAName: string;
  sideBName: string;
}) {
  const [open, setOpen] = useState(true);
  const { session, matches, error } = day;

  return (
    <div
      data-testid={`dash-day-${session.id}`}
      style={{
        border: isToday ? "2px solid #0c3057" : "1px solid rgba(0,0,0,0.08)",
        background: "white",
        borderRadius: 10,
        padding: "12px 14px",
        marginBottom: 12,
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
      >
        <span style={{ fontWeight: 800, color: "#0c3057", fontSize: "1rem" }}>
          {session.name}
          {isToday && (
            <span style={{ marginLeft: 8, fontSize: "0.68rem", fontWeight: 800, color: "#276e34", background: "#e7f6ec", borderRadius: 6, padding: "2px 6px", textTransform: "uppercase" }}>
              Today
            </span>
          )}
        </span>
        <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
          {formatDisplayDate(session.played_on ?? "")} · {FORMAT_LABEL[session.format]} {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          {error ? (
            <div style={{ fontSize: "0.8rem", color: "#92400e" }}>Couldn’t load this day’s results — ask the admin.</div>
          ) : matches.length === 0 ? (
            <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>No pairings yet.</div>
          ) : (
            matches.map((m) => <MatchRow key={m.match.id} m={m} sideAName={sideAName} sideBName={sideBName} />)
          )}
        </div>
      )}
    </div>
  );
}

function MatchRow({ m, sideAName, sideBName }: { m: LoadedMatch; sideAName: string; sideBName: string }) {
  const [open, setOpen] = useState(false);
  const status = matchStatusLine(m);
  const aNames = m.sideA.players.map((p) => p.displayName).join(" / ") || sideAName;
  const bNames = m.sideB.players.map((p) => p.displayName).join(" / ") || sideBName;

  return (
    <div data-testid={`dash-match-${m.match.id}`} style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 4px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
      >
        <span style={{ fontSize: "0.9rem", lineHeight: 1.4 }}>
          <span style={{ color: SIDE_COLOR.a, fontWeight: 600 }}>{aNames}</span>
          <span style={{ color: "#9ca3af", fontWeight: 700, margin: "0 6px" }}>v</span>
          <span style={{ color: SIDE_COLOR.b, fontWeight: 600 }}>{bNames}</span>
        </span>
        {/* C6 — the row EXPANDS in place (it doesn't navigate); a rotating
            chevron makes that affordance obvious. */}
        <span style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
          <span
            data-testid={`dash-status-${m.match.id}`}
            style={{ fontSize: "0.78rem", fontWeight: status.decided ? 700 : 600, color: status.decided ? "#0c3057" : "#6b7280" }}
          >
            {status.text}
            {status.adminForced && (
              <span title="Set by admin" style={{ marginLeft: 5, fontSize: "0.62rem", fontWeight: 800, color: "#92400e", background: "#fef3c7", borderRadius: 4, padding: "1px 4px", textTransform: "uppercase" }}>
                admin
              </span>
            )}
          </span>
          <span aria-hidden style={{ fontSize: "0.7rem", color: "#9ca3af", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
            ▾
          </span>
        </span>
      </button>

      {/* Expand to see the group — the foursome's players + each side's live
          points/thru from the same MatchState. */}
      {open && (
        <div data-testid={`dash-group-${m.match.id}`} style={{ padding: "0 4px 10px", fontSize: "0.8rem", color: "#4b5563" }}>
          <GroupSide name={sideAName} color={SIDE_COLOR.a} players={m.sideA.players.map((p) => p.displayName)} points={m.state.pointsA} />
          <GroupSide name={sideBName} color={SIDE_COLOR.b} players={m.sideB.players.map((p) => p.displayName)} points={m.state.pointsB} />
          {/* C7 — open the READ-ONLY review grid, not the editable scorecard
              (a spectator following along shouldn't risk editing a card). */}
          <Link href={`/tournament/match/${m.match.id}/review`} data-testid={`dash-review-${m.match.id}`} style={{ display: "inline-block", marginTop: 6, color: "#1a5a8c", fontWeight: 600, textDecoration: "none", fontSize: "0.78rem" }}>
            Review scorecard →
          </Link>
        </div>
      )}
    </div>
  );
}

function GroupSide({ name, color, players, points }: { name: string; color: string; players: string[]; points: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "2px 0" }}>
      <span>
        <span style={{ color, fontWeight: 700 }}>{name}:</span> {players.join(" / ") || "—"}
      </span>
      <span style={{ color: "#6b7280", whiteSpace: "nowrap" }}>{formatPoints(points)} pt{points === 1 ? "" : "s"}</span>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        maxWidth: "560px",
        margin: "0 auto",
        padding: "16px",
        // C8 — clear the app's position:fixed bottom nav. Without this the last
        // day card sits under the nav at desktop widths (where the document
        // barely overflows 100vh, so there's no scroll distance to reveal it);
        // the extra bottom padding gives that scroll room. Matches the global
        // `.page-content { padding-bottom: 80px }` convention.
        paddingBottom: "96px",
        fontFamily: "Inter, -apple-system, system-ui, sans-serif",
        background: "#f2f1ed",
        minHeight: "100vh",
      }}
    >
      {children}
    </main>
  );
}
