"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchPlayerStats, type PlayerStats } from "@/lib/playerStats";
import { excludedFromIndividualStats, getPlayingCourseHandicap } from "@/lib/format/helpers";
import { getActiveSeason, type Season } from "@/lib/seasons";
import {
  loadPlayedWith as loadPlayedWithBuckets,
  type Partner,
  type NeverPlayed,
} from "@/lib/playedWith/compute";
import PlayedWithPanel from "@/components/playedWith/PlayedWithPanel";
import ChPh from "@/components/handicap/ChPh";
import SeasonToggle, { type SeasonFilter } from "@/components/season/SeasonToggle";
import { computeAdjustedHoleScores, sumAdjusted } from "@/lib/scoring";

type Player = {
  id: number;
  full_name: string;
  display_name: string | null;
  handicap_index: number | null;
};

type RoundResult = {
  round_id: number;
  played_on: string;
  tee_color: string;
  total_strokes: number;
  course_handicap: number | null;
  // CH/PH split: PH = CH × this round's allowance, rounded (getPlayingCourseHandicap).
  // Equals course_handicap at 100% allowance. Display-only.
  playing_handicap: number | null;
  // Wave 1A: GHIN Adjusted (Net Double Bogey) round total at 100% handicap.
  // null when hole-level data is unavailable for the round's tee.
  adj_total: number | null;
};

export default function PlayerProfilePage() {
  const params = useParams();
  const playerId = params.id as string;

  const [player, setPlayer] = useState<Player | null>(null);
  const [rounds, setRounds] = useState<RoundResult[]>([]);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [neverPlayed, setNeverPlayed] = useState<NeverPlayed[]>([]);
  const [playedWithOpen, setPlayedWithOpen] = useState(false);
  const [playedWithError, setPlayedWithError] = useState(false);

  // E5 — season scope for the Played With card. activeSeason loads once on
  // mount; when null (no active season) the toggle hides and we force all-time.
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [seasonLoaded, setSeasonLoaded] = useState(false);
  const [seasonFilter, setSeasonFilter] = useState<SeasonFilter>("this_season");
  const effectiveFilter: SeasonFilter = activeSeason ? seasonFilter : "all_time";

  useEffect(() => {
    async function load() {
      const { data: playerData } = await supabase
        .from("players")
        .select("id, full_name, display_name, handicap_index")
        .eq("id", playerId)
        .single();

      if (playerData) {
        setPlayer(playerData);

        // TD26 fix (2026-05-22): sort the outer round_players rows by the
        // joined rounds.played_on. After the historical import (H.5) round
        // IDs no longer correspond to chronological date — older imports
        // landed with higher IDs than pre-existing live rounds.
        //
        // Done client-side because supabase-js's `.order("played_on",
        // { referencedTable: "rounds" })` sorts the *nested* rounds array
        // inside each row, not the outer rows. For a 1:1 `rounds!inner`
        // join (one rounds row per round_players row) that nested sort is
        // a no-op, so PostgREST returned outer rows in arbitrary
        // (insertion-ish) order and the history list rendered out of
        // chronological order. Sort here after the fetch instead.
        const { data: roundPlayers } = await supabase
          .from("round_players")
          .select(`
            id,
            round_id,
            tee_id,
            course_handicap,
            tees ( color ),
            rounds!inner ( played_on, is_complete, format, format_config ),
            scores ( hole_number, strokes )
          `)
          .eq("player_id", playerId)
          .eq("rounds.is_complete", true);

        roundPlayers?.sort((a: any, b: any) =>
          new Date(b.rounds.played_on).getTime() - new Date(a.rounds.played_on).getTime()
        );

        if (roundPlayers) {
          // Wave 1A: load hole pars + stroke indexes for each tee in play so we
          // can compute the GHIN Adjusted (Net Double Bogey) total per round.
          // Adj is ALWAYS at 100% handicap (raw course_handicap) by design.
          const teeIds = [
            ...new Set(
              roundPlayers.map((rp: any) => rp.tee_id).filter(Boolean),
            ),
          ] as number[];
          const holesByTee: Record<number, { hole_number: number; par: number; stroke_index: number }[]> = {};
          for (const teeId of teeIds) {
            const { data: h } = await supabase
              .from("holes")
              .select("hole_number, par, stroke_index")
              .eq("tee_id", teeId);
            holesByTee[teeId] = (h ?? []) as any[];
          }

          const results: RoundResult[] = roundPlayers
            // Wave 1B follow-up: exclude rounds that don't feed per-player
            // history + GHIN-adjusted totals — team-card formats (no individual
            // scores) AND Shambles (its per-player scores exist but aren't
            // authoritative: picked-up balls, relaxed close). For Shambles the
            // format filter — not the length guard — is the load-bearing one.
            .filter(
              (rp: any) =>
                rp.scores &&
                rp.scores.length > 0 &&
                !excludedFromIndividualStats(rp.rounds?.format ?? null),
            )
            .map((rp: any) => {
              const total_strokes = rp.scores.reduce(
                (sum: number, s: any) => sum + (s.strokes || 0),
                0,
              );
              const scoresByHole: Record<number, number> = {};
              rp.scores.forEach((s: any) => {
                if (s.hole_number != null) scoresByHole[s.hole_number] = s.strokes ?? 0;
              });
              const teeHoles = holesByTee[rp.tee_id] ?? [];
              const scores18 = Array.from({ length: 18 }, (_, i) => scoresByHole[i + 1] ?? null);
              const par18 = Array.from(
                { length: 18 },
                (_, i) => teeHoles.find(h => h.hole_number === i + 1)?.par ?? null,
              );
              const si18 = Array.from(
                { length: 18 },
                (_, i) => teeHoles.find(h => h.hole_number === i + 1)?.stroke_index ?? null,
              );
              const adj = computeAdjustedHoleScores(scores18, par18, si18, rp.course_handicap);
              return {
                round_id: rp.round_id,
                played_on: rp.rounds?.played_on || "",
                tee_color: rp.tees?.color || "?",
                total_strokes,
                course_handicap: rp.course_handicap,
                playing_handicap: getPlayingCourseHandicap(rp.course_handicap, rp.rounds?.format_config ?? null),
                adj_total: sumAdjusted(adj),
              };
            });
          setRounds(results);
        }

        const s = await fetchPlayerStats(Number(playerId));
        setStats(s);

        // E5: load the active season once. Drives the Played With season
        // toggle (the actual partner/never-played query lives in its own
        // effect so toggling re-queries only that data). Non-fatal on
        // failure — the toggle just hides and we fall back to all-time.
        try {
          setActiveSeason(await getActiveSeason());
        } catch (err) {
          console.error("Failed to load active season", err);
        } finally {
          setSeasonLoaded(true);
        }
      }
      setLoading(false);
    }
    load();
  }, [playerId]);

  // E5 — Played With data load, season-scoped. Split from the main load so the
  // season toggle re-queries only this (not player/rounds/stats). Computation
  // is identical to the pre-E5 inline block, parameterized by `filter`.
  const loadPlayedWith = useCallback(
    async (filter: SeasonFilter, seasonId: number | null) => {
      // Played With — partners + never-played buckets. Live JOIN against
      // round_players (E6 extracted the query + bucket math to
      // @/lib/playedWith/compute, shared with the admin Played-With tab).
      try {
        // E5: scope to the active season's rounds when "this season" is picked.
        const scopedSeasonId =
          filter === "this_season" && seasonId != null ? seasonId : null;
        const { partners, neverPlayed } = await loadPlayedWithBuckets(
          Number(playerId),
          scopedSeasonId,
        );
        setPartners(partners);
        setNeverPlayed(neverPlayed);
        setPlayedWithError(false);
      } catch (err) {
        console.error("Failed to load played-with data", err);
        setPlayedWithError(true);
      }
    },
    [playerId],
  );

  // Run (and re-run) the Played With query once the active season is known and
  // whenever the effective season filter changes.
  useEffect(() => {
    if (!seasonLoaded) return;
    void loadPlayedWith(effectiveFilter, activeSeason?.id ?? null);
  }, [seasonLoaded, effectiveFilter, activeSeason, loadPlayedWith]);

  if (loading) {
    return (
      <div className="page-content">
        <div className="loading">
          <div className="loading-dot" />
          <div className="loading-dot" />
          <div className="loading-dot" />
        </div>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="page-content">
        <div className="card empty-state">
          <p>Player not found</p>
          <Link href="/players" className="btn btn-secondary mt-4">
            Back to Players
          </Link>
        </div>
      </div>
    );
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  function scoreLabel(strokes: number) {
    const diff = strokes - 72;
    if (diff === 0) return "E";
    return diff > 0 ? `+${diff}` : `${diff}`;
  }

  return (
    <div className="page-content">
      {/* Player header */}
      <div style={{ marginBottom: "20px" }}>
        <Link
          href="/players"
          style={{
            fontSize: "0.85rem",
            color: "var(--green-700)",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            marginBottom: "8px",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
          All Players
        </Link>
        <h2 className="page-title" style={{ marginBottom: "4px" }}>
          {player.full_name}
        </h2>
        {player.handicap_index !== null && (
          <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
            Handicap Index: <strong>{player.handicap_index}</strong>
          </p>
        )}
      </div>

      {/* I3 — Season Stats accordion */}
      <AccordionSection
        title="Season Stats"
        open={statsOpen}
        onToggle={() => setStatsOpen((v) => !v)}
      >
        <SeasonStatsPanel stats={stats} />
      </AccordionSection>

      {/* I1 — Round History accordion */}
      <AccordionSection
        title={`Round History (${rounds.length})`}
        open={historyOpen}
        onToggle={() => setHistoryOpen((v) => !v)}
      >
        {rounds.length === 0 ? (
          <div className="empty-state" style={{ padding: "12px 0" }}>
            <p style={{ fontWeight: 600 }}>No rounds recorded yet</p>
            <p style={{ fontSize: "0.85rem" }}>
              Scores will appear here after the first round
            </p>
          </div>
        ) : (
          <div style={{
            background: "var(--white)",
            borderRadius: "var(--card-radius)",
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            border: "1px solid rgba(0,0,0,0.04)",
          }}>
            {rounds.map((round) => (
              <Link
                key={round.round_id}
                href={`/round/${round.round_id}/summary`}
                className="player-row"
              >
                <div>
                  <div className="player-name">{formatDate(round.played_on)}</div>
                  <div className="player-meta">
                    {round.tee_color} tees
                    {round.course_handicap !== null && (
                      <>
                        {" · "}
                        <ChPh ch={round.course_handicap} ph={round.playing_handicap} />
                      </>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{
                    fontSize: "1.3rem",
                    fontWeight: 700,
                    color: "var(--green-900)",
                  }}>
                    {round.total_strokes}
                  </div>
                  <div style={{
                    fontSize: "0.8rem",
                    color: round.total_strokes <= 72
                      ? "var(--green-600)"
                      : "var(--text-muted)",
                  }}>
                    {scoreLabel(round.total_strokes)}
                  </div>
                  {/* Wave 1A: GHIN Adjusted total (orange), alongside actual. */}
                  {round.adj_total !== null && (
                    <div style={{
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      color: "#c2410c",
                      marginTop: "2px",
                    }}>
                      Adj {round.adj_total}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </AccordionSection>

      {/* E1 — Played With accordion. Hidden entirely when focal player has
          zero completed rounds (same approach as Round History empty card). */}
      {rounds.length > 0 && (
        <AccordionSection
          title="Played With"
          open={playedWithOpen}
          onToggle={() => setPlayedWithOpen((v) => !v)}
          headerRight={
            activeSeason ? (
              <SeasonToggle value={seasonFilter} onChange={setSeasonFilter} />
            ) : null
          }
        >
          {playedWithError ? (
            <div style={{
              padding: "12px 0",
              fontStyle: "italic",
              color: "var(--text-muted)",
              fontSize: "0.9rem",
            }}>
              Couldn&apos;t load play history.
            </div>
          ) : (
            <PlayedWithPanel
              partners={partners}
              neverPlayed={neverPlayed}
              seasonScoped={effectiveFilter === "this_season"}
            />
          )}
        </AccordionSection>
      )}
    </div>
  );
}

function AccordionSection({
  title,
  open,
  onToggle,
  children,
  headerRight,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  // Optional control rendered to the right of the title (before the chevron),
  // visible collapsed + expanded. Rendered as a SIBLING of the toggle buttons
  // (not nested inside them) so its own buttons stay valid HTML.
  headerRight?: React.ReactNode;
}) {
  return (
    <div style={{
      marginBottom: "12px",
      background: "var(--white)",
      borderRadius: "var(--card-radius)",
      overflow: "hidden",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      border: "1px solid rgba(0,0,0,0.04)",
    }}>
      {/* Header is a flex row, NOT a single button — the title and chevron are
          separate toggle buttons so an interactive headerRight (with its own
          buttons) can sit between them without nesting buttons. */}
      <div style={{
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
      }}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            font: "inherit",
            textAlign: "left",
          }}
        >
          <span style={{
            fontFamily: "var(--font-display)",
            fontSize: "1.05rem",
            fontWeight: 700,
            color: "var(--green-900)",
          }}>
            {title}
          </span>
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {headerRight}
          <button
            type="button"
            onClick={onToggle}
            aria-label={open ? "Collapse" : "Expand"}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            <svg
              width="16" height="16" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth={2}
              style={{
                color: "var(--text-muted)",
                transition: "transform 150ms ease",
                transform: open ? "rotate(180deg)" : "rotate(0deg)",
              }}
              aria-hidden
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <div style={{
          padding: "0 16px 16px",
          borderTop: "1px solid rgba(0,0,0,0.04)",
          paddingTop: "12px",
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

function SeasonStatsPanel({ stats }: { stats: PlayerStats | null }) {
  if (!stats || stats.roundsPlayed === 0) {
    return (
      <div className="empty-state" style={{ padding: "12px 0" }}>
        <p style={{ fontWeight: 600 }}>No rounds yet</p>
      </div>
    );
  }

  const showComparison =
    stats.recent5AvgGross != null &&
    stats.avgGross != null &&
    stats.roundsPlayed > 1;

  let trendLabel: string | null = null;
  let trendDelta: string | null = null;
  if (showComparison) {
    const delta = (stats.recent5AvgGross as number) - (stats.avgGross as number);
    if (Math.abs(delta) < 0.1) {
      trendLabel = "trending steady";
    } else if (delta < 0) {
      trendLabel = "trending better";
      trendDelta = `↓ ${Math.abs(delta).toFixed(1)}`;
    } else {
      trendLabel = "trending worse";
      trendDelta = `↑ ${delta.toFixed(1)}`;
    }
  }

  const recentN = Math.min(5, stats.recent5.length);

  return (
    <div>
      {/* Base stats line */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: "6px",
        marginBottom: "12px",
      }}>
        <StatTile label="Rounds" value={stats.roundsPlayed} />
        <StatTile label="Avg Gross" value={stats.avgGross ?? "—"} />
        <StatTile label="Avg Net" value={stats.avgNet ?? "—"} />
        <StatTile label="Best" value={stats.best ?? "—"} />
        <StatTile label="Worst" value={stats.worst ?? "—"} />
      </div>

      {/* Comparison + trend */}
      {showComparison && (
        <div style={{
          fontSize: "0.85rem",
          color: "var(--text-secondary)",
          marginBottom: "8px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
        }}>
          <span>
            Last {recentN}: <strong>{stats.recent5AvgGross?.toFixed(1)}</strong>
          </span>
          <span>·</span>
          <span>
            all-time: <strong>{stats.avgGross?.toFixed(1)}</strong>
          </span>
          {trendDelta && (
            <>
              <span>·</span>
              <span style={{
                color: trendLabel === "trending better"
                  ? "var(--green-600)"
                  : "var(--text-secondary)",
                fontWeight: 600,
              }}>
                {trendDelta}
              </span>
            </>
          )}
          {trendLabel && (
            <>
              <span>·</span>
              <span style={{
                fontStyle: "italic",
                color: "var(--text-muted)",
              }}>
                {trendLabel}
              </span>
            </>
          )}
        </div>
      )}

      {/* Sparkline */}
      <Sparkline totals={stats.allTotals} />

      {/* Recent scores list */}
      {stats.recent5.length > 0 && (
        <div style={{
          fontSize: "0.85rem",
          color: "var(--text-secondary)",
          marginTop: "10px",
        }}>
          Recent: {stats.recent5.join(", ")}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{
      background: "var(--bg-warm, #f2f1ed)",
      border: "1px solid rgba(0,0,0,0.04)",
      borderRadius: "8px",
      padding: "8px 4px",
      textAlign: "center",
    }}>
      <div style={{
        fontSize: "1.05rem",
        fontWeight: 700,
        color: "var(--green-900)",
      }}>
        {value}
      </div>
      <div style={{
        fontSize: "0.65rem",
        color: "var(--text-muted)",
        marginTop: "2px",
      }}>
        {label}
      </div>
    </div>
  );
}

function Sparkline({ totals }: { totals: number[] }) {
  if (totals.length < 2) return null;
  const W = 320;
  const H = 50;
  const PAD = 4;
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  const range = max - min || 1;
  const xStep = (W - 2 * PAD) / (totals.length - 1);
  const pts = totals.map((t, i) => ({
    x: PAD + i * xStep,
    y: PAD + ((max - t) / range) * (H - 2 * PAD),
  }));
  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "50px", display: "block", marginTop: "4px" }}
      aria-hidden
    >
      <path d={d} fill="none" stroke="var(--green-700)" strokeWidth={1.5} />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2} fill="var(--green-700)" />
      ))}
    </svg>
  );
}
