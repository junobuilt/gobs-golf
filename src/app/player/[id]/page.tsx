"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchPlayerStats, type PlayerStats } from "@/lib/playerStats";
import { getDisplayName, type PlayerLike } from "@/lib/players/displayName";
import { getActiveSeason, type Season } from "@/lib/seasons";

type SeasonFilter = "this_season" | "all_time";

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
};

type Partner = {
  id: number;
  display_name: string;
  rounds_together: number;
};

type NeverPlayed = {
  id: number;
  display_name: string;
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
  const [showAllNever, setShowAllNever] = useState(false);

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
            course_handicap,
            tees ( color ),
            rounds!inner ( played_on, is_complete ),
            scores ( strokes )
          `)
          .eq("player_id", playerId)
          .eq("rounds.is_complete", true);

        roundPlayers?.sort((a: any, b: any) =>
          new Date(b.rounds.played_on).getTime() - new Date(a.rounds.played_on).getTime()
        );

        if (roundPlayers) {
          const results: RoundResult[] = roundPlayers
            .filter((rp: any) => rp.scores && rp.scores.length > 0)
            .map((rp: any) => ({
              round_id: rp.round_id,
              played_on: rp.rounds?.played_on || "",
              tee_color: rp.tees?.color || "?",
              total_strokes: rp.scores.reduce(
                (sum: number, s: any) => sum + (s.strokes || 0),
                0
              ),
              course_handicap: rp.course_handicap,
            }));
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
      // round_players (not the played_with_matrix table, which is keyed by
      // full_name text strings and has unverified freshness post-H.5 import).
      try {
        let rpQuery = supabase
          .from("round_players")
          .select("round_id, team_number, player_id, rounds!inner ( is_complete, season_id )")
          .eq("rounds.is_complete", true)
          .gt("team_number", 0);
        // E5: scope to the active season's rounds when "this season" is picked.
        if (filter === "this_season" && seasonId != null) {
          rpQuery = rpQuery.eq("rounds.season_id", seasonId);
        }

        const [{ data: rpRows, error: rpErr }, { data: allPlayers, error: pErr }] =
          await Promise.all([
            rpQuery,
            supabase
              .from("players")
              .select("id, full_name, display_name, is_active"),
          ]);

        if (rpErr) throw rpErr;
        if (pErr) throw pErr;
        if (!rpRows || !allPlayers) throw new Error("missing data");

        const focalId = Number(playerId);
        // Disambiguate against the full active roster (display_name ignored,
        // per the locked naming convention) so partner/never-played names
        // match every other surface. The focal player's own full name still
        // shows in the page title above.
        const activeRoster: PlayerLike[] = (allPlayers as any[]).map((p) => ({
          id: p.id,
          full_name: p.full_name,
          is_active: p.is_active,
        }));
        const nameOf = (p: { id: number; full_name: string }) =>
          p.full_name ? getDisplayName({ id: p.id, full_name: p.full_name }, activeRoster) : `Player ${p.id}`;
        const nameMap = new Map<number, string>();
        allPlayers.forEach((p: any) => nameMap.set(p.id, nameOf(p)));

        const focalKeys = new Set<string>();
        rpRows.forEach((rp: any) => {
          if (rp.player_id === focalId) {
            focalKeys.add(`${rp.round_id}:${rp.team_number}`);
          }
        });

        const partnerCounts = new Map<number, number>();
        rpRows.forEach((rp: any) => {
          if (rp.player_id === focalId) return;
          if (!focalKeys.has(`${rp.round_id}:${rp.team_number}`)) return;
          partnerCounts.set(rp.player_id, (partnerCounts.get(rp.player_id) || 0) + 1);
        });

        const partnerList: Partner[] = Array.from(partnerCounts.entries()).map(
          ([id, count]) => ({
            id,
            display_name: nameMap.get(id) || `Player ${id}`,
            rounds_together: count,
          })
        );

        const partnerIds = new Set(partnerCounts.keys());
        const neverPlayedList: NeverPlayed[] = allPlayers
          .filter(
            (p: any) =>
              p.is_active && p.id !== focalId && !partnerIds.has(p.id)
          )
          .map((p: any) => ({ id: p.id, display_name: nameOf(p) }));

        setPartners(partnerList);
        setNeverPlayed(neverPlayedList);
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
                href={`/round/${round.round_id}/scorecard`}
                className="player-row"
              >
                <div>
                  <div className="player-name">{formatDate(round.played_on)}</div>
                  <div className="player-meta">
                    {round.tee_color} tees
                    {round.course_handicap !== null &&
                      ` · Course Handicap: ${round.course_handicap}`}
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
              showAllNever={showAllNever}
              onToggleShowAllNever={() => setShowAllNever((v) => !v)}
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

const NEVER_PLAYED_CAP = 20;

function partnerSort(a: Partner, b: Partner) {
  return (
    b.rounds_together - a.rounds_together ||
    a.display_name.localeCompare(b.display_name)
  );
}

// E5 — "This season / All-time" pill toggle for the Played With card header.
// Uses the page's green palette (the profile has no navy token). aria-pressed
// marks the active option. Stops click propagation so it doesn't toggle the
// surrounding accordion.
function SeasonToggle({
  value,
  onChange,
}: {
  value: SeasonFilter;
  onChange: (v: SeasonFilter) => void;
}) {
  const opt = (key: SeasonFilter, label: string) => {
    const selected = value === key;
    return (
      <button
        type="button"
        aria-pressed={selected}
        onClick={(e) => {
          e.stopPropagation();
          onChange(key);
        }}
        style={{
          padding: "4px 10px",
          borderRadius: "999px",
          fontSize: "0.72rem",
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "inherit",
          border: "1px solid var(--green-700)",
          background: selected ? "var(--green-700)" : "transparent",
          color: selected ? "#fff" : "var(--green-700)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div style={{ display: "flex", gap: "4px" }}>
      {opt("this_season", "This season")}
      {opt("all_time", "All-time")}
    </div>
  );
}

function PlayedWithPanel({
  partners,
  neverPlayed,
  showAllNever,
  onToggleShowAllNever,
  seasonScoped,
}: {
  partners: Partner[];
  neverPlayed: NeverPlayed[];
  showAllNever: boolean;
  onToggleShowAllNever: () => void;
  // When true, the view is scoped to the active season — empty-partner copy
  // reads "this season" rather than the all-time "Not yet" per bucket.
  seasonScoped: boolean;
}) {
  const sorted = [...partners].sort(partnerSort);
  const mostFrequent = sorted.filter((p) => p.rounds_together >= 6);
  const someHistory = sorted.filter(
    (p) => p.rounds_together >= 3 && p.rounds_together <= 5
  );
  const onceOrTwice = sorted.filter(
    (p) => p.rounds_together >= 1 && p.rounds_together <= 2
  );
  const neverSorted = [...neverPlayed].sort((a, b) =>
    a.display_name.localeCompare(b.display_name)
  );
  const neverVisible = showAllNever
    ? neverSorted
    : neverSorted.slice(0, NEVER_PLAYED_CAP);
  const neverHasMore = neverSorted.length > NEVER_PLAYED_CAP;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {seasonScoped && partners.length === 0 ? (
        <div style={{
          fontStyle: "italic",
          color: "var(--text-muted)",
          fontSize: "0.85rem",
        }}>
          No partners this season yet
        </div>
      ) : (
        <>
          <BucketSection title="Most frequent · 6+ rounds">
            {mostFrequent.length === 0 ? (
              <NotYet />
            ) : (
              <FrequentBars partners={mostFrequent} />
            )}
          </BucketSection>

          <BucketSection title="Some history · 3–5 rounds">
            {someHistory.length === 0 ? (
              <NotYet />
            ) : (
              <PillRow
                partners={someHistory}
                bg="var(--green-100)"
                color="var(--green-800)"
                showCount
              />
            )}
          </BucketSection>

          <BucketSection title="Just once or twice · 1–2 rounds">
            {onceOrTwice.length === 0 ? (
              <NotYet />
            ) : (
              <PillRow
                partners={onceOrTwice}
                bg="var(--cream-dark)"
                color="var(--text-secondary)"
                showCount
              />
            )}
          </BucketSection>
        </>
      )}

      <BucketSection title="Never played together · 0 rounds">
        {neverSorted.length === 0 ? (
          <div style={{
            fontStyle: "italic",
            color: "var(--text-muted)",
            fontSize: "0.85rem",
          }}>
            You&apos;ve played with everyone
          </div>
        ) : (
          <>
            <PillRow
              partners={neverVisible.map((n) => ({
                id: n.id,
                display_name: n.display_name,
                rounds_together: 0,
              }))}
              bg="var(--red-100)"
              color="var(--red-500)"
              showCount={false}
            />
            {neverHasMore && (
              <button
                type="button"
                onClick={onToggleShowAllNever}
                style={{
                  marginTop: "8px",
                  background: "transparent",
                  border: "none",
                  color: "var(--green-700)",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: "4px 0",
                  textAlign: "left",
                }}
              >
                {showAllNever
                  ? "Show fewer"
                  : `Show all (${neverSorted.length})`}
              </button>
            )}
          </>
        )}
      </BucketSection>
    </div>
  );
}

function BucketSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{
        fontSize: "0.72rem",
        fontWeight: 700,
        color: "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginBottom: "8px",
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function NotYet() {
  return (
    <div style={{
      fontStyle: "italic",
      color: "var(--text-muted)",
      fontSize: "0.85rem",
    }}>
      Not yet
    </div>
  );
}

function FrequentBars({ partners }: { partners: Partner[] }) {
  const max = partners[0]?.rounds_together || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {partners.map((p) => {
        const widthPct = Math.max(8, (p.rounds_together / max) * 100);
        return (
          <Link
            key={p.id}
            href={`/player/${p.id}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "8px 10px",
              borderRadius: "8px",
              textDecoration: "none",
              background: "var(--green-50)",
              color: "var(--text-primary)",
            }}
          >
            <span style={{
              flex: "0 0 auto",
              minWidth: "100px",
              fontSize: "0.9rem",
              fontWeight: 600,
            }}>
              {p.display_name}
            </span>
            <div style={{
              flex: "1 1 auto",
              height: "8px",
              background: "var(--green-100)",
              borderRadius: "999px",
              overflow: "hidden",
            }}>
              <div style={{
                width: `${widthPct}%`,
                height: "100%",
                background: "var(--green-700)",
                borderRadius: "999px",
              }} />
            </div>
            <span style={{
              flex: "0 0 auto",
              minWidth: "32px",
              textAlign: "right",
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "var(--green-900)",
            }}>
              {p.rounds_together}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function PillRow({
  partners,
  bg,
  color,
  showCount,
}: {
  partners: Partner[];
  bg: string;
  color: string;
  showCount: boolean;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {partners.map((p) => (
        <Link
          key={p.id}
          href={`/player/${p.id}`}
          style={{
            display: "inline-block",
            padding: "5px 11px",
            borderRadius: "999px",
            background: bg,
            color,
            fontSize: "0.85rem",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {showCount
            ? `${p.display_name} · ${p.rounds_together}`
            : p.display_name}
        </Link>
      ))}
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
