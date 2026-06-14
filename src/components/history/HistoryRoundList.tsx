"use client";

// F.1 Parts 1/2/4 — the ONE read-only past-rounds list, rendered on both the
// global-nav History tab (/history) and the admin Settings → History tab. Two
// surfaces, one component (do not fork). Rows tap through to the existing
// /round/[id]/summary (RoundResultsView) — no new detail surface.
//
// Default mode: each row is a compact mini-leaderboard (up to 5 ranked team
// lines + a bold "+N more" line). Filtered mode (a player picked in the parent):
// one compact row per round that player was in, showing their team line + place.
//
// Team rank, total string ("−4" / "12 pts") and place ("T2 of 8") come straight
// from loadRoundsList → rankAndFormatTeams, so they are IDENTICAL to the detail.

import Link from "next/link";
import type { RoundListItem, HistoryTeamLine } from "@/lib/round/loadRoundsList";
import { FORMAT_LABELS } from "@/lib/format/copy";
import { isStablefordFormat } from "@/lib/leaderboard/rank";
import type { Format } from "@/lib/scoring";

const MAX_LINES = 5;

const C = {
  navy: "#042C53",
  gold: "#C9A227",
  faint: "#94a3b8",
  muted: "#64748b",
  ink: "#0f172a",
  line: "#e2e8f0",
  card: "#fff",
  under: "#15803d",
  over: "#b91c1c",
  points: "#2563eb",
};

// "Mon, Jun 8" — matches the locked v2 mockup (no year; F1.5 date nav deferred).
function formatRowDate(d: string): string {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

function scoreColor(total: number, format: Format): string {
  if (isStablefordFormat(format)) return C.points;
  // Par Competition record: OPPOSITE sign convention to best-N — positive (up on
  // the course) is green, negative is red.
  if (format === "par_competition") {
    if (total > 0) return C.under;
    if (total < 0) return C.over;
    return C.ink;
  }
  if (total < 0) return C.under;
  if (total > 0) return C.over;
  return C.ink;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999,
      background: "#eef2f7", color: "#33506e", border: "1px solid #dde6ef",
      whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}

// One ranked team line.
function TeamLineRow({ t, format }: { t: HistoryTeamLine; format: Format }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 9, padding: "5px 0",
    }}>
      <span style={{
        width: 18, textAlign: "center", fontSize: 12, fontWeight: 800,
        color: t.rank === 1 ? C.gold : C.faint,
      }}>
        {t.rank}
      </span>
      <span style={{
        flex: 1, minWidth: 0, fontSize: 13.5, color: C.ink,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {t.rosterDisplay}
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 800, color: scoreColor(t.total, format) }}>
        {t.totalLabel}
      </span>
    </div>
  );
}

// Small flight label (multi-flight only): "Flight A · 2-Ball".
function SectionLabel({ name, format }: { name: string; format: Format }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase",
      letterSpacing: "0.04em", marginTop: 8, marginBottom: 1,
    }}>
      {name} · {FORMAT_LABELS[format].title}
    </div>
  );
}

function OverflowLine({ overflow }: { overflow: number }) {
  if (overflow <= 0) return null;
  return (
    // Handoff override of the mockup: navy + BOLD (not faint grey) for the
    // 60–80 demographic's eyes.
    <div style={{
      fontSize: 12.5, fontWeight: 700, color: C.navy, marginTop: 8, textAlign: "right",
    }}>
      {`+${overflow} more ${overflow === 1 ? "team" : "teams"} · tap for full result`}
    </div>
  );
}

// One mini-leaderboard row (default mode).
function FullRow({ round }: { round: RoundListItem }) {
  const multiFlight = round.sections.length >= 2;

  return (
    <Link
      href={`/round/${round.roundId}/summary`}
      style={{
        display: "block", textDecoration: "none", color: "inherit",
        background: C.card, border: `1px solid ${C.line}`, borderRadius: 14,
        padding: "13px 15px", marginBottom: 11,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>
          {formatRowDate(round.playedOn)}
        </span>
        {/* Multi-flight: per-section labels carry each format, so the top chip
            is omitted to avoid implying one round-wide format. */}
        {!multiFlight && <Chip>{FORMAT_LABELS[round.format].title}</Chip>}
        {round.hasBlindDraws && <Chip>🎲</Chip>}
      </div>

      <div style={{ marginTop: 9, borderTop: "1px solid #eef2f6", paddingTop: 6 }}>
        {multiFlight ? <MultiFlightBody round={round} /> : <SingleFlightBody round={round} />}
      </div>
    </Link>
  );
}

// Single-flight body: byte-identical to the pre-flights row (flat top-5 + "+N").
function SingleFlightBody({ round }: { round: RoundListItem }) {
  const visible = round.teams.slice(0, MAX_LINES);
  const overflow = round.teams.length - visible.length;
  return (
    <>
      {visible.map(t => (
        <TeamLineRow key={t.teamNumber} t={t} format={round.format} />
      ))}
      <OverflowLine overflow={overflow} />
    </>
  );
}

// Multi-flight body: per-round 5-line budget across section headers. A section
// gets header + lines only while budget remains; a section that would get 0
// lines is dropped entirely (no orphaned header) and folded into "+N more".
function MultiFlightBody({ round }: { round: RoundListItem }) {
  let remaining = MAX_LINES;
  let shown = 0;
  const blocks: { flightId: number; name: string; format: Format; teams: HistoryTeamLine[] }[] = [];
  for (const section of round.sections) {
    if (remaining <= 0) break;
    const take = Math.min(section.teams.length, remaining);
    if (take === 0) continue;
    blocks.push({
      flightId: section.flightId,
      name: section.flightName,
      format: section.format,
      teams: section.teams.slice(0, take),
    });
    remaining -= take;
    shown += take;
  }
  const overflow = round.teams.length - shown;
  return (
    <>
      {blocks.map(b => (
        <div key={b.flightId}>
          <SectionLabel name={b.name} format={b.format} />
          {b.teams.map(t => (
            <TeamLineRow key={t.teamNumber} t={t} format={b.format} />
          ))}
        </div>
      ))}
      <OverflowLine overflow={overflow} />
    </>
  );
}

// One compact filtered row — the chosen player's team line + place.
function FilteredRow({ round, playerId }: { round: RoundListItem; playerId: number }) {
  const team = round.teams.find(t => t.playerIds.includes(playerId));
  if (!team) return null;

  // The player's team plays under its OWN flight's format (single-flight → the
  // round's one format). Resolve it so the chip + score color match the team.
  const teamFormat =
    round.sections.find(s => s.teams.some(t => t.teamNumber === team.teamNumber))?.format
    ?? round.format;

  // Bold the filtered player within the roster (names are in playerIds order).
  const names = team.rosterDisplay.split(" · ");
  const isStableford = isStablefordFormat(teamFormat);
  const placeSuffix = team.rank === 1
    ? `🥇 ${team.placeLabel} teams · won the round`
    : `${team.placeLabel} teams`;

  return (
    <Link
      href={`/round/${round.roundId}/summary`}
      style={{
        display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: "inherit",
        background: C.card, border: `1px solid ${C.line}`, borderRadius: 14,
        padding: "13px 15px", marginBottom: 11,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>
          {formatRowDate(round.playedOn)}
        </div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {names.map((n, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {team.playerIds[i] === playerId
                ? <b style={{ color: C.ink }}>{n}</b>
                : n}
            </span>
          ))}
          {" · "}{FORMAT_LABELS[teamFormat].title}
        </div>
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4 }}>
          {placeSuffix}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: scoreColor(team.total, teamFormat) }}>
          {team.totalLabel}
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, letterSpacing: "0.4px" }}>
          {teamFormat === "par_competition" ? "RECORD" : isStableford ? "TEAM PTS" : "TEAM NET"}
        </div>
      </div>
    </Link>
  );
}

export default function HistoryRoundList({
  rounds,
  filterPlayerId = null,
}: {
  rounds: RoundListItem[];
  filterPlayerId?: number | null;
}) {
  if (filterPlayerId != null) {
    const mine = rounds.filter(r => r.teams.some(t => t.playerIds.includes(filterPlayerId)));
    if (mine.length === 0) {
      return (
        <div style={{ textAlign: "center", color: C.muted, padding: "32px 16px", fontSize: 14 }}>
          No finished rounds for this player yet.
        </div>
      );
    }
    return (
      <div>
        {mine.map(r => <FilteredRow key={r.roundId} round={r} playerId={filterPlayerId} />)}
      </div>
    );
  }

  if (rounds.length === 0) {
    return (
      <div style={{ textAlign: "center", color: C.muted, padding: "40px 16px", fontSize: 14 }}>
        No finished rounds yet.
      </div>
    );
  }

  return (
    <div>
      {rounds.map(r => <FullRow key={r.roundId} round={r} />)}
    </div>
  );
}
