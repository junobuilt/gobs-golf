"use client";

// Shared view for the round-results surface. Consumed by:
//   - /round/[id]/summary (historical / completed rounds)
//   - /leaderboard (today's live or completed round)
// TODO(F.1): the History tab's player-detail view inherits Adj Total via this shared grid.
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
import { useRouter, useSearchParams } from "next/navigation";
import { useIsAdmin, withAdminFlags } from "@/lib/admin";
import { reopenRound } from "@/lib/round/reopenRound";
import DangerModal from "@/app/admin/components/DangerModal";
import { formatTeamTotal, FORMAT_LABELS } from "@/lib/format/copy";
import { isStablefordFormat } from "@/lib/leaderboard/rank";
import type { RankedFormattedTeam } from "@/lib/leaderboard/rankAndFormat";
import { getScoringBasis, isTeamCardFormat, getPlayingCourseHandicap } from "@/lib/format/helpers";
import { sumAdjusted } from "@/lib/scoring";
import type { Format, FormatConfig } from "@/lib/scoring";
import FormatChip from "@/components/format/FormatChip";
import PlayerHoleGrid from "@/components/scorecard/PlayerHoleGrid";
import ChPh from "@/components/handicap/ChPh";
import type {
  LoadedRoundResults,
  PlayerRow,
  TeamRow,
  BlindDrawFill,
  FlightSection,
  IndividualRankingRow,
  IndividualRankingsMode,
} from "@/lib/round/results";
import { pairBlindDraws, rangeCopy } from "@/lib/round/blindDrawPairing";

// D.1 hotfix follow-up: turn a fill's aggregate score into the
// caption-ready trailing label, e.g. "— Net −2" / "— Gross +5" / "— 12 pts".
// Stableford's per-player display already includes "pts" via formatPlayerNet,
// so it gets no prefix; best-N gets a "Net" or "Gross" prefix per the
// round's scoring_basis.
function fillScoreCopy(
  value: number,
  format: Format,
  formatConfig: FormatConfig,
): string {
  const isStableford = isStablefordFormat(format);
  const valueStr = formatPlayerNet(value, format);
  if (isStableford) return valueStr;
  const prefix = getScoringBasis(formatConfig) === "gross" ? "Gross" : "Net";
  return `${prefix} ${valueStr}`;
}

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

  // Flights S3: section the cards under flight headers only when the round has
  // 2+ non-empty flights. Single-flight rounds render the flat list with NO
  // flight chrome — byte-identical to pre-flights.
  const multiFlight = data.flightSections.length >= 2;

  const renderTeamCard = (
    team: RankedFormattedTeam<TeamRow>,
    format: Format,
    formatConfig: FormatConfig,
  ) => (
    <TeamCard
      key={team.id}
      team={team}
      format={format}
      formatConfig={formatConfig}
      isComplete={data.isComplete}
      isFirst={team.rank === 1}
      isTeamExpanded={expandedTeams.has(team.id)}
      expandedPlayers={expandedPlayers}
      onToggleTeam={toggleTeam}
      onTogglePlayer={togglePlayer}
    />
  );

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
            {multiFlight
              ? data.flightSections.map(section => (
                  <div key={section.flightId} style={{ marginBottom: 6 }}>
                    <FlightSectionHeader section={section} />
                    {section.teams.map(team =>
                      renderTeamCard(team, section.format, section.formatConfig),
                    )}
                  </div>
                ))
              : data.teams.map(team =>
                  renderTeamCard(team, data.format, data.formatConfig),
                )}
            {/* Round-wide Individual Rankings. Empty for team-card-only rounds
                (no per-player scores); mixed-format rounds rank by net strokes.
                Order + ranks are canonical (computed in results.ts). */}
            {data.individualRankings.length > 0 && (
              <IndividualRankings
                rows={data.individualRankings}
                mode={data.individualRankingsMode}
              />
            )}
          </>
        )}
        <AdminEditRoundButton data={data} />
      </div>
    </>
  );
}

// Flights S3: compact header above a flight's team cards (multi-flight only).
// Flight name + a small read-only format chip (e.g. "3-Man · 2-Ball").
function FlightSectionHeader({ section }: { section: FlightSection }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "4px 2px 8px",
    }}>
      <span style={{ fontSize: 15, fontWeight: 800, color: C.navy }}>
        {section.flightName}
      </span>
      <span style={{
        fontSize: 11, fontWeight: 700, color: "#33506e",
        background: "#eef2f7", border: "1px solid #dde6ef",
        padding: "2px 9px", borderRadius: 999, whiteSpace: "nowrap",
      }}>
        {FORMAT_LABELS[section.format].title}
      </span>
    </div>
  );
}

// F.1 Part 6: admin-only "Edit this round" entry point on the summary. Players
// never see it (gated on useIsAdmin). Intentionally re-adds an Edit entry that
// D2.7 removed — but via the cleaner withAdminFlags path (TD20) and routed
// through the existing D2 reopen DangerModal, not straight into edit mode.
// Approved 2026-06-09 (see ROADMAP D2.7). Finalized rounds only — a live round
// is already open, so admins edit it from the scorecard directly.
function AdminEditRoundButton({ data }: { data: LoadedRoundResults }) {
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!isAdmin || !data.isComplete) return null;

  const blindDrawCount = data.teams.reduce((n, t) => n + t.blindDraws.length, 0);

  const doEdit = async () => {
    setBusy(true);
    try {
      await reopenRound(data.roundId);
      // TD20: carry admin + edit through to the scorecard's edit mode.
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("admin", "1");
      params.set("edit", "1");
      router.push(withAdminFlags(`/round/${data.roundId}/scorecard`, params));
    } catch (err) {
      setBusy(false);
      setConfirming(false);
      alert("Error reopening round: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div style={{ padding: "16px 0 0" }}>
      <button
        type="button"
        data-testid="summary-edit-round-button"
        onClick={() => setConfirming(true)}
        disabled={busy}
        style={{
          width: "100%", padding: "12px", borderRadius: 10,
          border: "1.5px solid #c0392b", background: "white",
          color: "#8c2424", fontSize: 14, fontWeight: 700,
          cursor: busy ? "default" : "pointer", fontFamily: "inherit",
        }}
      >
        {busy ? "Opening…" : "Edit this round"}
      </button>
      {confirming && (
        <DangerModal
          title="Reopen this round?"
          description={
            blindDrawCount > 0
              ? `This round has ${blindDrawCount} blind ${blindDrawCount === 1 ? "draw" : "draws"} on file — they will be preserved and NOT recomputed against any new teams you add. Do not add players to teams that already had blind draws applied — their drawn scores will become stale.`
              : "The round will return to active state until you finalize it again."
          }
          confirmLabel="Reopen round"
          cannotBeUndone={false}
          onConfirm={doEdit}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

function Header({ data }: { data: LoadedRoundResults }) {
  const dateLabel = formatHeaderDate(data.playedOn);
  // Phase D.2: the admin-entry "Edit Round Scores" button on this header
  // was the D1.11 entry point; superseded by the Edit Round button on the
  // admin Round Setup tab (single source of entry). Removed 2026-05-27.
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
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 8,
          flexShrink: 0,
        }}>
          <StatusTag isComplete={data.isComplete} maxThru={data.maxThru} />
        </div>
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
  formatConfig,
  isComplete,
  isFirst,
  isTeamExpanded,
  expandedPlayers,
  onToggleTeam,
  onTogglePlayer,
}: {
  team: RankedFormattedTeam<TeamRow>;
  format: Format;
  formatConfig: FormatConfig;
  isComplete: boolean;
  isFirst: boolean;
  isTeamExpanded: boolean;
  expandedPlayers: Set<number>;
  onToggleTeam: (teamNum: number) => void;
  onTogglePlayer: (rpId: number) => void;
}) {
  const isStableford = isStablefordFormat(format);
  const isTeamCard = isTeamCardFormat(format);
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
                  {" — "}
                  {fillScoreCopy(bd.drawnPlayerNetValue, format, formatConfig)}
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
          {/* Phase 1C: NET team-card formats — the single team-handicap
              deduction behind the net headline (the big number = net delta vs
              par). F9/B9 above stay gross. */}
          {isTeamCard && team.teamHandicap != null && team.teamNet != null && (
            <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: "0.3px", marginTop: 2 }}>
              <span style={{ fontWeight: 600, color: C.textSecondary }}>Gross</span>{" "}
              {team.rawTeamScore}
              <span style={{ margin: "0 6px", opacity: 0.5 }}>·</span>
              <span style={{ fontWeight: 600, color: C.textSecondary }}>HCP</span>{" "}
              {team.teamHandicap}
              <span style={{ margin: "0 6px", opacity: 0.5 }}>·</span>
              <span style={{ fontWeight: 600, color: C.textSecondary }}>Net</span>{" "}
              {team.teamNet}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0, minWidth: 64 }}>
          <div style={{
            fontSize: 24, fontWeight: 700, lineHeight: 1,
            color: totalColor,
          }}>
            {team.totalLabel}
          </div>
          <div style={{
            fontSize: 10, color: C.textMuted,
            textTransform: "uppercase", letterSpacing: "0.3px",
            marginTop: 4, fontWeight: 600,
          }}>
            {isComplete
              ? "FINAL"
              : team.thru > 0
                ? `THRU ${team.thru}`
                : "—"}
          </div>
        </div>
        <Chevron expanded={isTeamExpanded} />
      </button>

      {isTeamExpanded && (
        <div style={{ borderTop: `1px solid ${C.divider}`, background: "white" }}>
          {isTeamCard ? (
            // Wave 1B: team-card rounds show ONE team hole-by-hole row (the
            // team's summed score per hole), not per-player rows — there are
            // no individual scores.
            <div style={{ padding: "12px 14px" }}>
              <PlayerHoleGrid
                scores={team.teamGrid?.scores ?? Array.from({ length: 18 }, () => null)}
                par={team.teamGrid?.par ?? Array.from({ length: 18 }, () => 0)}
              />
            </div>
          ) : (
            <>
              {team.players.map((player, idx) => {
                const fill = dropoutFillByRpId.get(player.rpId);
                const isLastRow =
                  idx === team.players.length - 1 && roundStartFills.length === 0;
                return (
                  <PlayerSection
                    key={player.rpId}
                    player={player}
                    format={format}
                    formatConfig={formatConfig}
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
                  format={format}
                  formatConfig={formatConfig}
                  isLast={idx === roundStartFills.length - 1}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PlayerSection({
  player,
  format,
  formatConfig,
  expanded,
  isLast,
  onToggle,
  dropoutFill,
  isUnmatchedDropout,
}: {
  player: PlayerRow;
  format: Format;
  formatConfig: FormatConfig;
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
          {/* F.1 Part 5 + CH/PH split: per-round CH (raw) · PH (allowance-adjusted
              playing) + GHIN Adjusted total, for real players (skip blind-draw
              fills/dropouts and team-card roster rows, mirroring the Individual
              Rankings exclusion). PH matches the scorecard's scoring number;
              GHIN Adjusted is the NDB-capped total players post to GHIN. */}
          {player.holesPlayed > 0
            && player.droppedAfterHole == null
            && !dropoutFill
            && !isUnmatchedDropout && (() => {
              const playingCH = getPlayingCourseHandicap(player.courseHandicap, formatConfig);
              const adjTotal = sumAdjusted(player.adjScores);
              return (
                <div style={{
                  display: "flex", gap: 18, flexWrap: "wrap", alignItems: "baseline",
                  padding: "10px 0 4px", fontSize: 12.5, color: C.textSecondary,
                }}>
                  <ChPh ch={player.courseHandicap} ph={playingCH} style={{ fontWeight: 700, color: C.textPrimary }} />
                  <span>
                    <span style={{ fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.3px", fontSize: 10, marginRight: 6 }}>
                      GHIN Adjusted
                    </span>
                    <span style={{ fontWeight: 700, color: "#c2410c" }}>
                      {adjTotal ?? "—"}
                    </span>
                  </span>
                </div>
              );
            })()}
          {dropoutFill && (
            <div style={{
              fontSize: 11, color: C.textMuted,
              marginBottom: 6, fontStyle: "italic",
            }}>
              🎲 Holes {dropoutFill.holeRangeStart}–{dropoutFill.holeRangeEnd}:
              {" "}blind draw from {dropoutFill.drawnPlayerName}
              {" "}(Team {dropoutFill.fromTeamNumber})
              {" — "}
              {fillScoreCopy(dropoutFill.drawnPlayerNetValue, format, formatConfig)}
            </div>
          )}
          <PlayerHoleGrid
            scores={gridScores}
            par={player.par}
            showRunningTotal={false}
            // Wave 1A: GHIN Adjusted column. Skipped for dropout-merged grids —
            // the post-drop holes are the drawn player's scores (different
            // CH/SI), so player.adjScores wouldn't line up with gridScores.
            adjScores={dropoutFill ? undefined : player.adjScores}
            // 2026-06-09: handicap stroke dots from the adjusted playing CH.
            // Skipped on dropout merges for the same CH/SI-mismatch reason.
            strokeAllocation={dropoutFill ? undefined : player.strokeAllocation}
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
  format,
  formatConfig,
  isLast,
}: {
  fill: BlindDrawFill;
  format: Format;
  formatConfig: FormatConfig;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
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
              {" — "}
              {fillScoreCopy(fill.drawnPlayerNetValue, format, formatConfig)}
            </span>
          </div>
        </div>
        <Chevron expanded={expanded} small />
      </button>
      {expanded && (
        <div style={{ padding: "0 14px 12px" }}>
          <PlayerHoleGrid
            scores={fill.drawnPlayerScores}
            par={fill.drawnPlayerPar}
            showRunningTotal={false}
          />
        </div>
      )}
    </div>
  );
}

// Cross-team flat list of every player, ranked round-wide. Order + ranks are
// canonical (computed in results.ts → data.individualRankings):
//   stableford  → by points, highest wins ("N pts" display)
//   best_n      → by net strokes, lowest wins (Gross/Net display)
//   net_strokes → mixed-format rounds: every individual-format player by net
//                 strokes (each under their own flight's allowance)
// Read-only — no expand, no tap actions.
function IndividualRankings({
  rows,
  mode,
}: {
  rows: ReadonlyArray<IndividualRankingRow>;
  mode: IndividualRankingsMode;
}) {
  if (rows.length === 0) return null;
  const isStableford = mode === "stableford";
  const withRank = rows;

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
              {row.points} pts
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
                  {row.netStrokes}
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
