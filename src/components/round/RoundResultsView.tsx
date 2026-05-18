"use client";

// Shared view for the round-results surface. Consumed by:
//   - /round/[id]/summary (historical / completed rounds)
//   - /leaderboard (today's live or completed round)
//
// Owns the visual chrome — round-meta header (date + FormatChip + course +
// status tag), ranked team cards with inline two-level drill-down (team →
// player rows → PlayerHoleGrid), and the cross-team Individual Rankings
// section below.
//
// Drill-down state is internal — multi-expand at both team and player level
// via two independent Set<number>. Data + loading is page-level (consumers
// call `loadRoundResults` from `@/lib/round/results`).

import { useState } from "react";
import { formatTeamTotal } from "@/lib/format/copy";
import { isStablefordFormat, type RankedTeam } from "@/lib/leaderboard/rank";
import type { Format } from "@/lib/scoring";
import FormatChip from "@/components/format/FormatChip";
import PlayerHoleGrid from "@/components/scorecard/PlayerHoleGrid";
import type {
  LoadedRoundResults,
  PlayerRow,
  TeamRow,
  BlindDrawFill,
} from "@/lib/round/results";
import { pairBlindDraws, rangeCopy } from "@/lib/round/blindDrawPairing";

const COURSE_NAME = "Semiahmoo Golf & Country Club";

const C = {
  navy: "#042C53",
  bgWarm: "#f5f4f0",
  bgEmphasis: "#faf8f0",
  cardBorder: "#e2e0db",
  divider: "#e2e8f0",
  textPrimary: "#1a1a1a",
  textSecondary: "#6b6b6b",
  textMuted: "#9a9a9a",
  accentBlue: "#2563eb",
  scoreUnder: "#15803d",
  scoreOver: "#b91c1c",
  scoreEven: "#1a1a1a",
  goldFirst: "#d4a017",
  statusFinal: "#15803d",
  statusFinalBg: "#dcfce7",
};

function formatHeaderDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const md = d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return `${weekday} · ${md}`;
}

function bestNDeltaColor(delta: number): string {
  if (delta === 0) return C.scoreEven;
  return delta < 0 ? C.scoreUnder : C.scoreOver;
}

function scoreColor(value: number, isStableford: boolean): string {
  if (isStableford) return C.accentBlue;
  return bestNDeltaColor(value);
}

function formatLegValue(value: number | null, format: Format): string {
  if (value == null) return "—";
  return formatTeamTotal(value, format);
}

// Best-N player Net display: signed delta vs par-of-played. Stableford: pts.
function formatPlayerNet(value: number, format: Format): string {
  const isStableford = isStablefordFormat(format);
  if (isStableford) {
    if (value < 0) return `−${-value} pts`;
    return `${value} pts`;
  }
  if (value === 0) return "E";
  if (value > 0) return `+${value}`;
  return `−${-value}`;
}

export default function RoundResultsView({ data }: { data: LoadedRoundResults }) {
  const [expandedTeams, setExpandedTeams] = useState<Set<number>>(new Set());
  const [expandedPlayers, setExpandedPlayers] = useState<Set<number>>(new Set());

  function toggleTeam(teamNum: number) {
    setExpandedTeams(prev => {
      const next = new Set(prev);
      if (next.has(teamNum)) next.delete(teamNum);
      else next.add(teamNum);
      return next;
    });
  }

  function togglePlayer(rpId: number) {
    setExpandedPlayers(prev => {
      const next = new Set(prev);
      if (next.has(rpId)) next.delete(rpId);
      else next.add(rpId);
      return next;
    });
  }

  return (
    <>
      <Header data={data} />
      <div style={{ background: C.bgWarm, padding: "16px 12px", minHeight: 200 }}>
        {data.teams.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: C.textMuted }}>
            No team scores yet.
          </div>
        ) : (
          <>
            {data.teams.map(team => (
              <TeamCard
                key={team.id}
                team={team}
                format={data.format}
                isFirst={team.rank === 1}
                isTeamExpanded={expandedTeams.has(team.id)}
                expandedPlayers={expandedPlayers}
                onToggleTeam={toggleTeam}
                onTogglePlayer={togglePlayer}
              />
            ))}
            <IndividualRankings teams={data.teams} format={data.format} />
          </>
        )}
      </div>
    </>
  );
}

function Header({ data }: { data: LoadedRoundResults }) {
  const dateLabel = formatHeaderDate(data.playedOn);
  return (
    <div style={{
      background: "white",
      borderBottom: `1px solid ${C.cardBorder}`,
      padding: 16,
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 12,
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 18, fontWeight: 700, color: C.textPrimary, marginBottom: 6,
          }}>
            {dateLabel}
          </div>
          <div style={{ marginBottom: 8 }}>
            <FormatChip
              roundId={data.roundId}
              currentFormat={data.format}
              currentConfig={data.formatConfig}
              formatLocked={data.formatLocked}
            />
          </div>
          <div style={{ fontSize: 12, color: C.textMuted }}>
            {COURSE_NAME}
          </div>
        </div>
        <StatusTag isComplete={data.isComplete} maxThru={data.maxThru} />
      </div>
    </div>
  );
}

function StatusTag({ isComplete, maxThru }: { isComplete: boolean; maxThru: number }) {
  if (isComplete) {
    return (
      <span style={{
        background: C.statusFinalBg,
        color: C.statusFinal,
        fontSize: 11, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.4px",
        padding: "4px 10px", borderRadius: 999,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}>
        Final
      </span>
    );
  }
  return (
    <span style={{
      color: C.textSecondary,
      fontSize: 11, fontWeight: 600,
      textTransform: "uppercase", letterSpacing: "0.4px",
      padding: "4px 0",
      whiteSpace: "nowrap",
      flexShrink: 0,
    }}>
      In progress · thru {maxThru}
    </span>
  );
}

function TeamCard({
  team,
  format,
  isFirst,
  isTeamExpanded,
  expandedPlayers,
  onToggleTeam,
  onTogglePlayer,
}: {
  team: RankedTeam<TeamRow>;
  format: Format;
  isFirst: boolean;
  isTeamExpanded: boolean;
  expandedPlayers: Set<number>;
  onToggleTeam: (teamNum: number) => void;
  onTogglePlayer: (rpId: number) => void;
}) {
  const isStableford = isStablefordFormat(format);
  const totalColor = scoreColor(team.total, isStableford);
  const { dropoutPairings, roundStartFills, unmatchedPlayers } = pairBlindDraws(team);
  // Map for quick lookup during PlayerSection rendering.
  const dropoutFillByRpId = new Map<number, BlindDrawFill>(
    dropoutPairings.map(p => [p.player.rpId, p.fill]),
  );
  const unmatchedSet = new Set<number>(unmatchedPlayers.map(p => p.rpId));

  return (
    <div style={{
      background: "white",
      border: `1px solid ${C.cardBorder}`,
      borderRadius: 12,
      marginBottom: 10,
      overflow: "hidden",
    }}>
      <button
        type="button"
        onClick={() => onToggleTeam(team.id)}
        aria-expanded={isTeamExpanded}
        aria-label={isTeamExpanded ? `Collapse ${team.name}` : `Expand ${team.name}`}
        style={{
          width: "100%",
          background: isFirst ? C.bgEmphasis : "white",
          border: "none",
          padding: "14px 14px 14px 10px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        <RankBadge rank={team.rank} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 16, fontWeight: 700, color: C.textPrimary,
            marginBottom: 3,
          }}>
            {team.name}
          </div>
          <div style={{
            fontSize: 12, color: C.textSecondary,
            overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap", lineHeight: 1.3,
            marginBottom: 4,
          }}>
            {team.rosterDisplay}
          </div>
          {team.blindDraws.length > 0 && (
            <div style={{
              fontSize: 11, color: C.textMuted,
              marginBottom: 4, lineHeight: 1.4,
            }}>
              {team.blindDraws.map((bd, i) => (
                <div key={i} style={{
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  🎲 Blind draw: {bd.drawnPlayerName} ({rangeCopy(bd)})
                </div>
              ))}
            </div>
          )}
          <div style={{
            fontSize: 11, color: C.textMuted,
            letterSpacing: "0.3px",
          }}>
            <span style={{ fontWeight: 600, color: C.textSecondary }}>F9</span>{" "}
            {formatLegValue(team.f9Total, format)}
            <span style={{ margin: "0 6px", opacity: 0.5 }}>·</span>
            <span style={{ fontWeight: 600, color: C.textSecondary }}>B9</span>{" "}
            {formatLegValue(team.b9Total, format)}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0, minWidth: 64 }}>
          <div style={{
            fontSize: 24, fontWeight: 700, lineHeight: 1,
            color: totalColor,
          }}>
            {formatTeamTotal(team.total, format)}
          </div>
          <div style={{
            fontSize: 10, color: C.textMuted,
            textTransform: "uppercase", letterSpacing: "0.3px",
            marginTop: 4, fontWeight: 600,
          }}>
            {isStableford ? "Net pts" : "Net"}
          </div>
        </div>
        <Chevron expanded={isTeamExpanded} />
      </button>

      {isTeamExpanded && (
        <div style={{ borderTop: `1px solid ${C.divider}`, background: "white" }}>
          {team.players.map((player, idx) => {
            const fill = dropoutFillByRpId.get(player.rpId);
            const isLastRow =
              idx === team.players.length - 1 && roundStartFills.length === 0;
            return (
              <PlayerSection
                key={player.rpId}
                player={player}
                format={format}
                expanded={expandedPlayers.has(player.rpId)}
                isLast={isLastRow}
                onToggle={() => onTogglePlayer(player.rpId)}
                dropoutFill={fill}
                isUnmatchedDropout={unmatchedSet.has(player.rpId)}
              />
            );
          })}
          {roundStartFills.map((fill, idx) => (
            <BlindDrawPseudoPlayerSection
              key={`bd-fill-${idx}`}
              fill={fill}
              isLast={idx === roundStartFills.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerSection({
  player,
  format,
  expanded,
  isLast,
  onToggle,
  dropoutFill,
  isUnmatchedDropout,
}: {
  player: PlayerRow;
  format: Format;
  expanded: boolean;
  isLast: boolean;
  onToggle: () => void;
  // D.1: when present, the expanded grid merges the dropped player's
  // pre-drop scores with this fill's post-drop scores, and shows the
  // "Holes N+1–18: blind draw from [Name]" caption above the grid.
  dropoutFill?: BlindDrawFill;
  // D.1: dropped player whose fill we couldn't pair (round not finalized,
  // or pairing skipped). Show the "left after hole N" caption but no
  // merge. Display falls back to the player's own scores only.
  isUnmatchedDropout?: boolean;
}) {
  const isStableford = isStablefordFormat(format);
  const netColor = scoreColor(player.netValue, isStableford);

  // For mid-round dropouts with a paired fill, construct the merged
  // 18-hole array. Holes 1..N use the dropped player's actual scores
  // (already in player.scores); holes N+1..18 use the drawn player's
  // scores from the fill.
  const gridScores: (number | null)[] = (() => {
    if (!dropoutFill) return player.scores;
    const merged = [...player.scores];
    for (let i = dropoutFill.holeRangeStart - 1; i <= dropoutFill.holeRangeEnd - 1; i++) {
      merged[i] = dropoutFill.drawnPlayerScores[i];
    }
    return merged;
  })();

  return (
    <div style={{ borderBottom: isLast ? "none" : `1px solid ${C.divider}` }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={expanded ? `Collapse ${player.displayName}` : `Expand ${player.displayName}`}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: C.textPrimary,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {player.displayName}
            {(dropoutFill || isUnmatchedDropout) && player.droppedAfterHole != null && (
              <span style={{
                fontSize: 11, fontWeight: 500, color: C.textMuted,
                marginLeft: 6, fontStyle: "italic",
              }}>
                left after hole {player.droppedAfterHole}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{
              fontSize: 10, color: C.textMuted,
              textTransform: "uppercase", letterSpacing: "0.3px", fontWeight: 600,
            }}>
              Gross
            </div>
            <div style={{
              fontSize: 16, fontWeight: 700, color: C.textPrimary, lineHeight: 1.1,
            }}>
              {player.holesPlayed === 0 ? "—" : player.grossTotal}
            </div>
          </div>
          <div style={{ textAlign: "right", minWidth: 56 }}>
            <div style={{
              fontSize: 10, color: C.textMuted,
              textTransform: "uppercase", letterSpacing: "0.3px", fontWeight: 600,
            }}>
              Net
            </div>
            <div style={{
              fontSize: 16, fontWeight: 700, color: netColor, lineHeight: 1.1,
            }}>
              {player.holesPlayed === 0 ? "—" : formatPlayerNet(player.netValue, format)}
            </div>
          </div>
        </div>
        <Chevron expanded={expanded} small />
      </button>

      {expanded && (
        <div style={{ padding: "0 14px 12px" }}>
          {dropoutFill && (
            <div style={{
              fontSize: 11, color: C.textMuted,
              marginBottom: 6, fontStyle: "italic",
            }}>
              🎲 Holes {dropoutFill.holeRangeStart}–{dropoutFill.holeRangeEnd}:
              {" "}blind draw from {dropoutFill.drawnPlayerName}
              {" "}(Team {dropoutFill.fromTeamNumber})
            </div>
          )}
          <PlayerHoleGrid
            scores={gridScores}
            par={player.par}
            showRunningTotal={false}
          />
        </div>
      )}
    </div>
  );
}

// D.1: synthetic player row for a round-start blind-draw fill. Renders the
// drawn player's full 18-hole scores under the team. Mirrors PlayerSection's
// chrome (header + chevron + expandable grid) but uses a different identity
// pattern: no rpId (the team doesn't have a round_players row for the fill),
// expansion is locally managed.
function BlindDrawPseudoPlayerSection({
  fill,
  isLast,
}: {
  fill: BlindDrawFill;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  // Drawn player's par baseline isn't tracked here (would require the drawn
  // player's tee, which isn't loaded on this team's row). Use par 4 as a
  // neutral fallback for the notation marks — the data point is the score
  // values, not the +/− delta against par. Acceptable trade-off because
  // round-start fills are full-18 from a complete player; the deltas would
  // be derivable from /summary on the drawn player's own team.
  const neutralPar = Array.from({ length: 18 }, () => 4);
  return (
    <div style={{ borderBottom: isLast ? "none" : `1px solid ${C.divider}` }}>
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse blind-draw fill" : "Expand blind-draw fill"}
        style={{
          width: "100%", background: "transparent", border: "none",
          padding: "12px 14px",
          display: "flex", alignItems: "center", gap: 10,
          cursor: "pointer", textAlign: "left", fontFamily: "inherit",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: C.textPrimary,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            🎲 {fill.drawnPlayerName}
            <span style={{
              fontSize: 11, fontWeight: 500, color: C.textMuted,
              marginLeft: 6, fontStyle: "italic",
            }}>
              blind draw fill ({rangeCopy(fill)}, from Team {fill.fromTeamNumber})
            </span>
          </div>
        </div>
        <Chevron expanded={expanded} small />
      </button>
      {expanded && (
        <div style={{ padding: "0 14px 12px" }}>
          <PlayerHoleGrid
            scores={fill.drawnPlayerScores}
            par={neutralPar}
            showRunningTotal={false}
          />
        </div>
      )}
    </div>
  );
}

// Cross-team flat list of every player, ranked by net (best-N: ascending,
// lowest wins) or by points (Stableford: descending, highest wins). Tie
// handling mirrors rankTeams in `src/lib/leaderboard/rank.ts`: tied entries
// share the same rank, the next position is then skipped (1, 2, 2, 4).
// Read-only — no expand, no tap actions.
function IndividualRankings({
  teams,
  format,
}: {
  teams: ReadonlyArray<RankedTeam<TeamRow>>;
  format: Format;
}) {
  const isStableford = isStablefordFormat(format);

  // D.1 S7: only rank players who completed all 18 holes themselves.
  // Blind-draw fills aren't in team.players at all (no round_players row),
  // so they're automatically excluded. Dropouts are filtered here. Drawn
  // players still appear once, on their OWN team, with their own scores.
  const rows = teams.flatMap(team =>
    team.players
      .filter(p => p.holesPlayed > 0 && p.droppedAfterHole == null)
      .map(p => ({
        rpId: p.rpId,
        displayName: p.displayName,
        teamName: team.name,
        grossTotal: p.grossTotal,
        netTotal: p.netTotal,
      })),
  );

  if (rows.length === 0) return null;

  const decorated = rows.map((row, idx) => ({ row, idx }));
  decorated.sort((a, b) => {
    const diff = isStableford
      ? b.row.netTotal - a.row.netTotal
      : a.row.netTotal - b.row.netTotal;
    if (diff !== 0) return diff;
    return a.idx - b.idx;
  });

  // Skip-tie rank assignment (matches rankTeams semantics).
  let lastRank = 0;
  const withRank = decorated.map(({ row }, i) => {
    const prev = i > 0 ? decorated[i - 1].row : null;
    const isTieWithPrev = prev !== null && prev.netTotal === row.netTotal;
    const rank = isTieWithPrev ? lastRank : i + 1;
    lastRank = rank;
    return { ...row, rank };
  });

  return (
    <div style={{
      background: "white",
      border: `1px solid ${C.cardBorder}`,
      borderRadius: 12,
      marginTop: 16,
      overflow: "hidden",
    }}>
      <div style={{
        padding: "14px 14px 10px 14px",
        borderBottom: `1px solid ${C.divider}`,
      }}>
        <div style={{
          fontSize: 16, fontWeight: 700, color: C.textPrimary,
        }}>
          Individual Rankings
        </div>
        <div style={{
          fontSize: 11, color: C.textMuted,
          marginTop: 2, letterSpacing: "0.3px",
        }}>
          {isStableford
            ? "Sorted by total points · highest wins"
            : "Sorted by net score · lowest wins"}
        </div>
      </div>
      {withRank.map((row, i) => (
        <div
          key={row.rpId}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 14px",
            borderBottom: i === withRank.length - 1 ? "none" : `1px solid ${C.divider}`,
          }}
        >
          <div style={{
            width: 28, textAlign: "right",
            fontSize: 14, fontWeight: 700,
            color: row.rank === 1 ? C.goldFirst : C.textSecondary,
            flexShrink: 0,
          }}>
            {row.rank}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 14, fontWeight: 600, color: C.textPrimary,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              lineHeight: 1.2,
            }}>
              {row.displayName}
            </div>
            <div style={{
              fontSize: 11, color: C.textMuted, marginTop: 2,
            }}>
              {row.teamName}
            </div>
          </div>
          {isStableford ? (
            <div style={{
              textAlign: "right",
              fontSize: 16, fontWeight: 700, color: C.accentBlue,
              minWidth: 60,
            }}>
              {row.netTotal} pts
            </div>
          ) : (
            <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
              <div style={{ textAlign: "right" }}>
                <div style={{
                  fontSize: 10, color: C.textMuted,
                  textTransform: "uppercase", letterSpacing: "0.3px", fontWeight: 600,
                }}>
                  Gross
                </div>
                <div style={{
                  fontSize: 16, fontWeight: 700, color: C.textPrimary, lineHeight: 1.1,
                }}>
                  {row.grossTotal}
                </div>
              </div>
              <div style={{ textAlign: "right", minWidth: 40 }}>
                <div style={{
                  fontSize: 10, color: C.textMuted,
                  textTransform: "uppercase", letterSpacing: "0.3px", fontWeight: 600,
                }}>
                  Net
                </div>
                <div style={{
                  fontSize: 16, fontWeight: 700, color: C.textPrimary, lineHeight: 1.1,
                }}>
                  {row.netTotal}
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const isFirst = rank === 1;
  return (
    <div style={{
      width: 36, height: 36, borderRadius: "50%",
      background: isFirst ? C.goldFirst : C.navy,
      color: "white",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 700, fontSize: 17,
      flexShrink: 0,
    }}>
      {rank}
    </div>
  );
}

function Chevron({ expanded, small }: { expanded: boolean; small?: boolean }) {
  const size = small ? 14 : 16;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={C.textMuted} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
      style={{
        flexShrink: 0,
        transform: expanded ? "rotate(180deg)" : "none",
        transition: "transform 0.15s",
      }}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
