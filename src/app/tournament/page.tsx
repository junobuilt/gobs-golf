"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { todayLocal, formatDisplayDate } from "@/lib/date";
import { getTeamColor } from "@/lib/teamColors";
import { getActiveTournament, getTournamentSessions } from "@/lib/tournament/queries";
import { loadSessionMatches } from "@/lib/tournament/loadMatch";
import { findMatchForPlayer, tournamentPlayersFromDays } from "@/lib/tournament/findPlayerMatch";
import { getStoredPlayerId, setStoredPlayerId, clearStoredPlayerId } from "@/lib/deviceMemory";
import type { LoadedMatch, SessionFormat, Side, Tournament, TournamentSession } from "@/lib/tournament/types";

// Side A = blue, Side B = red — the §0 shared palette used across pairings + the
// match scorecard.
const SIDE_COLOR: Record<Side, string> = {
  a: getTeamColor(4).pillText,
  b: getTeamColor(6).pillText,
};

const FORMAT_LABEL: Record<SessionFormat, string> = {
  greensomes: "Alternate Shot",
  four_ball_match: "Best Ball",
  singles_match: "Singles",
};

interface DayData {
  session: TournamentSession;
  matches: LoadedMatch[];
  error: boolean;
}
type LandingState =
  | { kind: "loading" }
  | { kind: "empty" } // no published, active tournament
  | { kind: "ready"; tournament: Tournament; days: DayData[] };

async function loadLanding(): Promise<LandingState> {
  const tournament = await getActiveTournament();
  // Player-facing gate: only a Live (published) tournament is shown. A Test one,
  // or none, → clean empty state (never a crash).
  if (!tournament || !tournament.is_published) return { kind: "empty" };

  const sessions = await getTournamentSessions(tournament.id); // day-ordered
  // Per-day isolation: one misconfigured day (mixed tees / missing holes) shows a
  // note, never blanks the page.
  const results = await Promise.allSettled(
    sessions.map((s) => (s.round_id != null ? loadSessionMatches(s.id) : Promise.resolve([] as LoadedMatch[]))),
  );
  const days: DayData[] = sessions.map((session, i) => {
    const r = results[i];
    return r.status === "fulfilled"
      ? { session, matches: r.value, error: false }
      : { session, matches: [], error: true };
  });
  return { kind: "ready", tournament, days };
}

export default function TournamentLandingPage() {
  const [state, setState] = useState<LandingState>({ kind: "loading" });
  // Device memory (localStorage) — the player's identity on THIS device. Read
  // post-mount to stay SSR/hydration-safe; null until known.
  const [storedId, setStoredId] = useState<number | null>(null);

  const doLoad = useCallback(async () => {
    // Read device memory here (inside the async callback, past the effect's
    // await boundary) so it's not a synchronous setState in the effect body.
    setStoredId(getStoredPlayerId());
    setState(await loadLanding());
  }, []);

  useEffect(() => {
    void (async () => {
      await doLoad();
    })();
  }, [doLoad]);

  const pickPlayer = useCallback((id: number) => {
    setStoredPlayerId(id);
    setStoredId(id);
  }, []);
  const switchPlayer = useCallback(() => {
    clearStoredPlayerId();
    setStoredId(null);
  }, []);

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
          data-testid="tournament-empty"
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

  const today = todayLocal();
  return (
    <Shell>
      <div style={{ marginBottom: "14px" }}>
        <div style={{ fontSize: "1.35rem", fontWeight: 800, color: "#0c3057" }}>{state.tournament.name}</div>
        <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>
          <span style={{ color: SIDE_COLOR.a }}>{state.tournament.side_a_name}</span>
          <span style={{ color: "#9ca3af", margin: "0 6px" }}>vs</span>
          <span style={{ color: SIDE_COLOR.b }}>{state.tournament.side_b_name}</span>
        </div>
      </div>

      <DeviceMemoryPanel
        days={state.days}
        today={today}
        storedId={storedId}
        onPick={pickPlayer}
        onSwitch={switchPlayer}
      />

      {state.days.map((day) => (
        <DaySection
          key={day.session.id}
          day={day}
          isToday={day.session.played_on === today}
          sideAName={state.tournament.side_a_name}
          sideBName={state.tournament.side_b_name}
        />
      ))}
    </Shell>
  );
}

// "Who are you?" (first visit) → "Go to your match" (per current day) + switch.
// Stores IDENTITY, so it resolves the player's NEW match on day 2/3 with no
// re-ask. localStorage only, no accounts.
function DeviceMemoryPanel({
  days,
  today,
  storedId,
  onPick,
  onSwitch,
}: {
  days: DayData[];
  today: string;
  storedId: number | null;
  onPick: (playerId: number) => void;
  onSwitch: () => void;
}) {
  const roster = tournamentPlayersFromDays(days.map((d) => d.matches));
  if (roster.length === 0) return null;

  const cardStyle: React.CSSProperties = {
    background: "#eef5fc",
    border: `1px solid ${getTeamColor(4).border}`,
    borderRadius: "10px",
    padding: "12px 14px",
    marginBottom: "14px",
  };

  // Not-yet-identified → the one-time picker.
  if (storedId == null) {
    return (
      <div data-testid="who-are-you" style={cardStyle}>
        <div style={{ fontWeight: 800, color: "#0c3057", marginBottom: "8px" }}>Who are you?</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {roster.map((p) => (
            <button
              key={p.playerId}
              data-testid={`whoami-${p.playerId}`}
              onClick={() => onPick(p.playerId)}
              style={{
                minHeight: "40px",
                padding: "0 14px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                background: "white",
                color: "#0c3057",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {p.displayName}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Identified → resolve THIS device's player to their match for the current day.
  const storedName = roster.find((p) => p.playerId === storedId)?.displayName ?? "you";
  const todayDay = days.find((d) => d.session.played_on === today);
  const myMatch = todayDay ? findMatchForPlayer(todayDay.matches, storedId) : undefined;

  return (
    <div data-testid="device-identity" style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, color: "#0c3057" }}>You’re {storedName}</span>
        <button
          data-testid="switch-player"
          onClick={onSwitch}
          style={{ background: "transparent", border: "none", color: "#1a5a8c", fontWeight: 600, cursor: "pointer", fontSize: "0.82rem" }}
        >
          Not you? Switch player
        </button>
      </div>
      {myMatch ? (
        <Link
          href={`/tournament/match/${myMatch.match.id}`}
          data-testid="go-to-your-match"
          style={{
            display: "block",
            marginTop: "10px",
            textAlign: "center",
            background: "#0c3057",
            color: "white",
            borderRadius: "8px",
            padding: "12px",
            fontWeight: 800,
            textDecoration: "none",
          }}
        >
          Go to your match →
        </Link>
      ) : (
        <div data-testid="no-match-today" style={{ marginTop: "8px", fontSize: "0.82rem", color: "#6b7280" }}>
          No match for you today — check the days below.
        </div>
      )}
    </div>
  );
}

function DaySection({
  day,
  isToday,
  sideAName,
  sideBName,
}: {
  day: DayData;
  isToday: boolean;
  sideAName: string;
  sideBName: string;
}) {
  // All days visible by default (so a future-dated tournament shows every
  // pairing); collapsible per day; the current day highlighted.
  const [open, setOpen] = useState(true);
  const { session, matches, error } = day;

  return (
    <div
      data-testid={`day-${session.id}`}
      style={{
        border: isToday ? "2px solid #0c3057" : "1px solid rgba(0,0,0,0.08)",
        background: "white",
        borderRadius: "10px",
        padding: "12px 14px",
        marginBottom: "12px",
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "8px",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ fontWeight: 800, color: "#0c3057", fontSize: "1rem" }}>
          {session.name}
          {isToday && (
            <span
              style={{
                marginLeft: "8px",
                fontSize: "0.68rem",
                fontWeight: 800,
                color: "#276e34",
                background: "#e7f6ec",
                borderRadius: "6px",
                padding: "2px 6px",
                textTransform: "uppercase",
              }}
            >
              Today
            </span>
          )}
        </span>
        <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
          {formatDisplayDate(session.played_on ?? "")} · {FORMAT_LABEL[session.format]} {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: "10px" }}>
          {error ? (
            <div style={{ fontSize: "0.8rem", color: "#92400e" }}>
              Couldn’t load this day’s pairings — ask the admin.
            </div>
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
  const aNames = m.sideA.players.map((p) => p.displayName).join(" / ") || sideAName;
  const bNames = m.sideB.players.map((p) => p.displayName).join(" / ") || sideBName;
  return (
    <Link
      href={`/tournament/match/${m.match.id}`}
      data-testid={`match-row-${m.match.id}`}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "10px",
        padding: "10px 8px",
        borderTop: "1px solid rgba(0,0,0,0.06)",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <span style={{ fontSize: "0.9rem", lineHeight: 1.4 }}>
        <span style={{ color: SIDE_COLOR.a, fontWeight: 600 }}>{aNames}</span>
        <span style={{ color: "#9ca3af", fontWeight: 700, margin: "0 6px" }}>v</span>
        <span style={{ color: SIDE_COLOR.b, fontWeight: 600 }}>{bNames}</span>
      </span>
      <span style={{ fontSize: "0.78rem", color: "#6b7280", whiteSpace: "nowrap" }}>—</span>
    </Link>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        maxWidth: "560px",
        margin: "0 auto",
        padding: "16px",
        fontFamily: "Inter, -apple-system, system-ui, sans-serif",
        background: "#f2f1ed",
        minHeight: "100vh",
      }}
    >
      {children}
    </main>
  );
}
