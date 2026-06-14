"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useIsMobile } from "@/lib/useIsMobile";
import type { Format, FormatConfig } from "@/lib/scoring/types";
import { GOBS_STABLEFORD_POINTS } from "@/lib/scoring/engine";
import { FORMAT_ORDER, FORMAT_LABELS } from "@/lib/format/copy";
import { defaultConfigFor, getScoringBasis, getOverrideHoles, getTeamBallCount } from "@/lib/format/helpers";
import { getPrimaryFlightForRound, getTeamFlightMap } from "@/lib/flights/resolve";
import DangerModal from "@/app/admin/components/DangerModal";

// GOBS Stableford editable point-value rows. Order is best-result-first so
// admins reading the section see albatross → double bogey top-to-bottom.
const GOBS_STABLEFORD_POINT_KEYS = [
  { key: "albatross",          label: "Albatross" },
  { key: "eagle",              label: "Eagle" },
  { key: "birdie",             label: "Birdie" },
  { key: "par",                label: "Par" },
  { key: "bogey",              label: "Bogey" },
  { key: "doubleBogeyOrWorse", label: "Double Bogey or worse" },
] as const;
type GobsPointKey = (typeof GOBS_STABLEFORD_POINT_KEYS)[number]["key"];

const GOBS_STABLEFORD_DEFAULTS: Record<GobsPointKey, number> = {
  albatross:          GOBS_STABLEFORD_POINTS.albatross,
  eagle:              GOBS_STABLEFORD_POINTS.eagle,
  birdie:             GOBS_STABLEFORD_POINTS.birdie,
  par:                GOBS_STABLEFORD_POINTS.par,
  bogey:              GOBS_STABLEFORD_POINTS.bogey,
  doubleBogeyOrWorse: GOBS_STABLEFORD_POINTS.doubleBogeyOrWorse,
};

const POINT_VALUE_MIN = -10;
const POINT_VALUE_MAX = 10;

function readGobsPointValues(config: FormatConfig | null | undefined): Record<GobsPointKey, number> {
  const pv = config?.point_values ?? {};
  return {
    albatross:          typeof pv.albatross          === "number" ? pv.albatross          : GOBS_STABLEFORD_DEFAULTS.albatross,
    eagle:              typeof pv.eagle              === "number" ? pv.eagle              : GOBS_STABLEFORD_DEFAULTS.eagle,
    birdie:             typeof pv.birdie             === "number" ? pv.birdie             : GOBS_STABLEFORD_DEFAULTS.birdie,
    par:                typeof pv.par                === "number" ? pv.par                : GOBS_STABLEFORD_DEFAULTS.par,
    bogey:              typeof pv.bogey              === "number" ? pv.bogey              : GOBS_STABLEFORD_DEFAULTS.bogey,
    doubleBogeyOrWorse: typeof pv.doubleBogeyOrWorse === "number" ? pv.doubleBogeyOrWorse : GOBS_STABLEFORD_DEFAULTS.doubleBogeyOrWorse,
  };
}

interface FormatPickerProps {
  open: boolean;
  roundId: number;
  // Session 2 (Flights): the flight this picker writes to. When provided, the
  // save targets THIS flight; when omitted, it falls back to the round's primary
  // flight (back-compat). currentFormat/currentConfig/formatLocked must be
  // sourced from the SAME flight.
  flightId?: number;
  currentFormat?: Format | null;
  currentConfig?: FormatConfig | null;
  formatLocked?: boolean;
  onClose: () => void;
  onSaved: (chosen: Format) => void;
}

const C = {
  navy: "#0b2d50",
  midNavy: "#0e4270",
  gold: "#e8a800",
  goldText: "#1a1a1a",
  bg: "#f2f1ed",
  cardBorder: "#e4e4e4",
  text: "#1a1a1a",
  subtext: "#64748b",
  muted: "#94a3b8",
  pillBg: "#eef2f7",
  errorBg: "#fef2f2",
  errorBorder: "#fca5a5",
  errorText: "#a32d2d",
  font: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
};

const STABLEFORD_FORMATS: Format[] = ["stableford_standard", "gobs_stableford"];

export default function FormatPicker({
  open,
  roundId,
  flightId,
  currentFormat,
  currentConfig,
  formatLocked = false,
  onClose,
  onSaved,
}: FormatPickerProps) {
  const isMobile = useIsMobile();
  const [selectedFormat, setSelectedFormat] = useState<Format | null>(currentFormat ?? null);
  const [scoringBasis, setScoringBasis] = useState<"net" | "gross">(getScoringBasis(currentConfig));
  const [overrideHoles, setOverrideHoles] = useState<number[]>(() =>
    [...getOverrideHoles(currentConfig)].sort((a, b) => a - b),
  );
  const [pointValues, setPointValues] = useState<Record<GobsPointKey, number>>(() =>
    readGobsPointValues(currentConfig),
  );
  // Wave 1B: team-card ball count (Shambles: 1 or 2). Inert for other formats.
  const [ballCount, setBallCount] = useState<number>(() => getTeamBallCount(currentConfig));
  // Phase 1C: this round's team sizes (team_number → headcount), loaded when the
  // picker opens. Powers the Alternate Shot "exactly 2 per team" selection guard.
  const [teamSizes, setTeamSizes] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dangerOpen, setDangerOpen] = useState(false);

  // Reset local state every time the picker (re)opens. Keeps state in sync
  // with the latest props after a save round-trip and avoids leaking stale
  // selections across openings.
  useEffect(() => {
    if (open) {
      setSelectedFormat(currentFormat ?? null);
      setScoringBasis(getScoringBasis(currentConfig));
      setOverrideHoles([...getOverrideHoles(currentConfig)].sort((a, b) => a - b));
      setPointValues(readGobsPointValues(currentConfig));
      setBallCount(getTeamBallCount(currentConfig));
      setSaving(false);
      setErrorMessage(null);
      setDangerOpen(false);
    }
  }, [open, currentFormat, currentConfig]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Phase 1C: load this round's team sizes so the Alternate Shot guard can block
  // selection unless every assigned team is exactly 2.
  //
  // Flights S3: when the picker is scoped to a specific flight (flightId set,
  // i.e. a per-flight card), count ONLY the teams resolved to THAT flight — a
  // 3-man team in flight B must not block Alt-Shot on flight A. With no flightId
  // (the single-flight default button) every team counts, as before.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("round_players")
        .select("team_number")
        .eq("round_id", roundId)
        .gt("team_number", 0);

      let inScope: (teamNumber: number) => boolean = () => true;
      if (flightId != null) {
        const teamFlightMap = await getTeamFlightMap(roundId);
        inScope = (tn) => teamFlightMap.get(tn)?.id === flightId;
      }
      if (cancelled) return;

      const sizes: Record<number, number> = {};
      for (const r of (data ?? []) as Array<{ team_number: number }>) {
        if (!inScope(r.team_number)) continue;
        sizes[r.team_number] = (sizes[r.team_number] ?? 0) + 1;
      }
      setTeamSizes(sizes);
    })();
    return () => { cancelled = true; };
  }, [open, roundId, flightId]);

  const baseline = useMemo(() => {
    const baselinePoints = readGobsPointValues(currentConfig);
    return {
      format: currentFormat ?? null,
      basis: getScoringBasis(currentConfig),
      holes: [...getOverrideHoles(currentConfig)].sort((a, b) => a - b).join(","),
      pointsKey: GOBS_STABLEFORD_POINT_KEYS.map(k => `${k.key}:${baselinePoints[k.key]}`).join("|"),
      ballCount: getTeamBallCount(currentConfig),
    };
  }, [currentFormat, currentConfig]);

  const pointsKeyNow = GOBS_STABLEFORD_POINT_KEYS.map(k => `${k.key}:${pointValues[k.key]}`).join("|");
  const pointsChanged = selectedFormat === "gobs_stableford" && pointsKeyNow !== baseline.pointsKey;

  const isStableford = selectedFormat != null && STABLEFORD_FORMATS.includes(selectedFormat);
  const isBestBall = selectedFormat === "best_ball";
  // Wave 1B follow-up: Shambles is a net best-ball format — lock the basis to
  // net exactly like Best Ball, keep the 1/2 ball-count control, and let the
  // override-holes section render (it's a best-N family format).
  const isShambles = selectedFormat === "shambles";
  // Phase 1C: NET team-card formats. Net-locked like Best Ball; override-holes
  // are a no-op (one team score per hole), shown dimmed like Stableford.
  const isTeamCardNet =
    selectedFormat === "texas_scramble" || selectedFormat === "alternate_shot";
  // Par Competition: individual best-1 NET selection mapped to ±1/0/−1 vs par.
  // Net-locked like Best Ball; override-holes are a no-op (record is per-hole vs
  // par), shown dimmed like Stableford.
  const isParCompetition = selectedFormat === "par_competition";
  // Best Ball, Shambles, Par Competition, and the team-card NET formats are
  // locked to net. Use a derived effective basis instead of mutating state in an
  // effect — the toggle UI reads from this, and commitSave persists this value,
  // so any stale choice from a previous format can't leak.
  const isNetLocked = isBestBall || isShambles || isTeamCardNet || isParCompetition;
  const effectiveScoringBasis: "net" | "gross" =
    isNetLocked ? "net" : scoringBasis;
  // Override-holes have no effect for Stableford, team-card, or Par Competition.
  const isOverrideNoOp = isStableford || isTeamCardNet || isParCompetition;
  // Alternate Shot is 2-person only. Block selecting it unless every assigned
  // team is exactly 2 (and at least one team exists).
  const teamSizeValues = Object.values(teamSizes);
  const altShotTeamsOk =
    teamSizeValues.length > 0 && teamSizeValues.every((n) => n === 2);
  const altShotBlocked = selectedFormat === "alternate_shot" && !altShotTeamsOk;

  const hasChanges =
    selectedFormat !== baseline.format ||
    effectiveScoringBasis !== baseline.basis ||
    [...overrideHoles].sort((a, b) => a - b).join(",") !== baseline.holes ||
    pointsChanged ||
    (isShambles && ballCount !== baseline.ballCount);

  if (!open) return null;

  function toggleHole(h: number) {
    setOverrideHoles(prev =>
      prev.includes(h) ? prev.filter(x => x !== h) : [...prev, h].sort((a, b) => a - b),
    );
  }

  function applyPreset9And18() {
    setOverrideHoles(prev => {
      const next = new Set(prev);
      next.add(9);
      next.add(18);
      return [...next].sort((a, b) => a - b);
    });
  }

  function clearAllHoles() {
    setOverrideHoles([]);
  }

  function setPointValue(key: GobsPointKey, raw: string) {
    // Empty / "-" / "+" parsed as 0 — admin can keep typing past the sign.
    // Caller-side clamp to [MIN, MAX] prevents typo blow-ups (e.g. 100).
    let next: number;
    if (raw === "" || raw === "-" || raw === "+") {
      next = 0;
    } else {
      const parsed = Number(raw);
      next = Number.isFinite(parsed) ? parsed : pointValues[key];
    }
    if (next > POINT_VALUE_MAX) next = POINT_VALUE_MAX;
    if (next < POINT_VALUE_MIN) next = POINT_VALUE_MIN;
    setPointValues(prev => ({ ...prev, [key]: next }));
  }

  function resetPointsToDefaults() {
    setPointValues({ ...GOBS_STABLEFORD_DEFAULTS });
  }

  async function commitSave() {
    if (!selectedFormat) return;
    setSaving(true);
    setErrorMessage(null);

    // Start from defaults for the chosen format so we don't carry stale keys
    // (e.g., best_n) across format swaps. Then layer admin choices on top.
    const baseConfig = defaultConfigFor(selectedFormat);
    const nextConfig: FormatConfig = {
      ...baseConfig,
      scoring_basis: effectiveScoringBasis,
      override_holes: [...overrideHoles].sort((a, b) => a - b),
    };

    // GOBS Stableford carries an editable point table per round. Other formats
    // ignore point_values entirely — leave them on whatever the format default
    // is so the engine never sees a stale table from a previous selection.
    if (selectedFormat === "gobs_stableford") {
      nextConfig.point_values = { ...pointValues };
    }

    // Wave 1B follow-up: Shambles carries the per-round ball count (1/2).
    // effectiveScoringBasis already forced net above.
    if (isShambles) {
      nextConfig.team_ball_count = ballCount;
    }

    // Wave 1A: handicap allowance is an independent control (set on the Round
    // Setup tab, not here). Carry any existing value across a format change so
    // picking/changing the format doesn't silently reset it back to 100%.
    if (typeof currentConfig?.handicap_allowance === "number") {
      nextConfig.handicap_allowance = currentConfig.handicap_allowance;
    }

    // Format ownership lives on the flight (Session 1). nextConfig holds only
    // flight-level keys — submitted_teams stays on the round. Session 2: write
    // to the SPECIFIC flight when given; else the round's primary flight.
    let targetFlightId = flightId;
    if (targetFlightId == null) {
      const flight = await getPrimaryFlightForRound(roundId);
      if (!flight) {
        setSaving(false);
        setErrorMessage("Couldn't find the round's flight. Tap Save to retry.");
        return;
      }
      targetFlightId = flight.id;
    }
    const { error } = await supabase
      .from("flights")
      .update({ format: selectedFormat, format_config: nextConfig })
      .eq("id", targetFlightId);

    if (error) {
      setSaving(false);
      setErrorMessage(error.message || "Couldn't save. Tap Save to retry.");
      return;
    }

    onSaved(selectedFormat);
    onClose();
  }

  function handleSaveClick() {
    if (!selectedFormat || !hasChanges) return;
    // Phase 1C: never persist Alternate Shot with a non-2 team.
    if (altShotBlocked) return;
    if (formatLocked) {
      setDangerOpen(true);
      return;
    }
    void commitSave();
  }

  const containerStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed", left: 0, right: 0, bottom: 0,
        background: "#fff",
        borderTopLeftRadius: 18, borderTopRightRadius: 18,
        boxShadow: "0 -8px 32px rgba(0,0,0,0.18)",
        padding: "12px 16px 28px",
        maxHeight: "92vh", overflowY: "auto",
      }
    : {
        position: "relative",
        background: "#fff",
        borderRadius: 14,
        maxWidth: 520, width: "100%",
        padding: "24px 24px 22px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        maxHeight: "88vh", overflowY: "auto",
      };

  const overlayStyle: React.CSSProperties = {
    position: "fixed", inset: 0, zIndex: 1000,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: isMobile ? "flex-end" : "center",
    justifyContent: "center",
    padding: isMobile ? 0 : 24,
    fontFamily: C.font,
  };

  return (
    <>
    <div
      style={overlayStyle}
      onClick={() => { if (!saving) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Choose today's format"
    >
      <div
        style={containerStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {isMobile && (
          <div style={{
            width: 44, height: 4, borderRadius: 999,
            background: "#cbd5e1",
            margin: "0 auto 14px",
          }} />
        )}

        <div style={{ marginBottom: 16 }}>
          <h2 style={{
            margin: "0 0 4px",
            fontSize: isMobile ? "1.15rem" : "1.25rem",
            fontWeight: 700,
            color: C.navy,
            letterSpacing: "-0.01em",
          }}>
            Choose today&apos;s format
          </h2>
          <p style={{
            margin: 0,
            fontSize: "0.85rem",
            color: C.subtext,
            lineHeight: 1.4,
          }}>
            Format locks once the first score is entered.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {FORMAT_ORDER.map((f) => {
            const { title, oneLiner } = FORMAT_LABELS[f];
            const isSelected = selectedFormat === f;
            const isCurrent = currentFormat === f;
            // Phase 1C: Alternate Shot is 2-person only — block selecting it
            // unless every assigned team is exactly 2.
            const blocked = f === "alternate_shot" && !altShotTeamsOk;
            const disabled = saving || blocked;
            return (
              <button
                key={f}
                onClick={() => { if (!blocked) setSelectedFormat(f); }}
                disabled={disabled}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 12,
                  width: "100%",
                  padding: "14px 16px",
                  border: isSelected ? `1.5px solid ${C.navy}` : `0.5px solid ${C.cardBorder}`,
                  borderRadius: 10,
                  background: isSelected ? "#f5f8fc" : "#fff",
                  textAlign: "left",
                  cursor: disabled ? "default" : "pointer",
                  opacity: saving ? 0.6 : blocked ? 0.5 : 1,
                  fontFamily: C.font,
                  transition: "border-color 0.15s, background 0.15s",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    color: C.text,
                    marginBottom: 2,
                  }}>
                    {title}
                    {isCurrent && (
                      <span style={{
                        marginLeft: 8,
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        color: C.navy,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}>
                        · current
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: "0.8rem",
                    color: C.subtext,
                    lineHeight: 1.4,
                  }}>
                    {blocked
                      ? "Needs exactly 2 players on every team. Adjust teams first."
                      : oneLiner}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Rules sections — only shown after a format is selected. */}
        {selectedFormat && (
          <>
            {/* Net / Gross segmented control. Best Ball and Shambles are locked
                to net — UI disables the control and renders a small caption. */}
            <div style={{ marginTop: 20, opacity: isNetLocked ? 0.55 : 1 }}>
              <div style={{
                fontSize: "0.78rem", fontWeight: 700, color: C.navy,
                textTransform: "uppercase", letterSpacing: "0.06em",
                marginBottom: 8,
              }}>
                Scoring basis
                {isBestBall && (
                  <span style={{
                    marginLeft: 8, fontSize: "0.7rem", fontWeight: 600,
                    color: C.muted, textTransform: "none", letterSpacing: 0,
                  }}>
                    (Best Ball is always net)
                  </span>
                )}
                {isShambles && (
                  <span style={{
                    marginLeft: 8, fontSize: "0.7rem", fontWeight: 600,
                    color: C.muted, textTransform: "none", letterSpacing: 0,
                  }}>
                    (Shambles is always net)
                  </span>
                )}
                {isTeamCardNet && (
                  <span style={{
                    marginLeft: 8, fontSize: "0.7rem", fontWeight: 600,
                    color: C.muted, textTransform: "none", letterSpacing: 0,
                  }}>
                    (team handicap — always net)
                  </span>
                )}
                {isParCompetition && (
                  <span style={{
                    marginLeft: 8, fontSize: "0.7rem", fontWeight: 600,
                    color: C.muted, textTransform: "none", letterSpacing: 0,
                  }}>
                    (Par Competition is always net)
                  </span>
                )}
              </div>
              <div role="group" aria-label="Scoring basis"
                   style={{
                     display: "flex", gap: 0,
                     border: `1px solid ${C.cardBorder}`,
                     borderRadius: 10,
                     overflow: "hidden",
                     fontFamily: C.font,
                   }}>
                {(["net", "gross"] as const).map((opt, idx) => {
                  const active = effectiveScoringBasis === opt;
                  const disabled = saving || isNetLocked;
                  return (
                    <button
                      key={opt}
                      onClick={() => { if (!isNetLocked) setScoringBasis(opt); }}
                      disabled={disabled}
                      style={{
                        flex: 1,
                        padding: "10px 12px",
                        border: "none",
                        borderLeft: idx === 0 ? "none" : `1px solid ${C.cardBorder}`,
                        background: active ? C.navy : "#fff",
                        color: active ? "#fff" : C.text,
                        fontSize: "0.88rem",
                        fontWeight: active ? 700 : 500,
                        cursor: disabled ? "default" : "pointer",
                        textTransform: "capitalize",
                        fontFamily: C.font,
                      }}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Wave 1B follow-up: Shambles ball count (1 or 2). Count-1 takes
                the best net ball; count-2 sums the two best net balls per hole. */}
            {isShambles && (
              <div style={{ marginTop: 20 }}>
                <div style={{
                  fontSize: "0.78rem", fontWeight: 700, color: C.navy,
                  textTransform: "uppercase", letterSpacing: "0.06em",
                  marginBottom: 8,
                }}>
                  Balls per hole
                </div>
                <div role="group" aria-label="Balls per hole"
                     style={{
                       display: "flex", gap: 0,
                       border: `1px solid ${C.cardBorder}`,
                       borderRadius: 10, overflow: "hidden", fontFamily: C.font,
                     }}>
                  {[1, 2].map((n, idx) => {
                    const active = ballCount === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setBallCount(n)}
                        disabled={saving}
                        style={{
                          flex: 1, padding: "10px 12px", border: "none",
                          borderLeft: idx === 0 ? "none" : `1px solid ${C.cardBorder}`,
                          background: active ? C.navy : "#fff",
                          color: active ? "#fff" : C.text,
                          fontSize: "0.88rem", fontWeight: active ? 700 : 500,
                          cursor: saving ? "default" : "pointer", fontFamily: C.font,
                        }}
                      >
                        {n === 1 ? "1 ball" : "2 balls"}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Override-holes section. Applies to every per-player engine format
                (best-N family incl. Shambles); dimmed + no-op for Stableford and
                the team-card NET formats (one team score per hole). */}
            <div style={{ marginTop: 20, opacity: isOverrideNoOp ? 0.55 : 1 }}>
              <div style={{
                fontSize: "0.78rem", fontWeight: 700, color: C.navy,
                textTransform: "uppercase", letterSpacing: "0.06em",
                marginBottom: 8,
              }}>
                All scores count on these holes
                {isStableford && (
                  <span style={{
                    marginLeft: 8, fontSize: "0.7rem", fontWeight: 600,
                    color: C.muted, textTransform: "none",
                    letterSpacing: 0,
                  }}>
                    (no effect on Stableford formats)
                  </span>
                )}
                {isTeamCardNet && (
                  <span style={{
                    marginLeft: 8, fontSize: "0.7rem", fontWeight: 600,
                    color: C.muted, textTransform: "none",
                    letterSpacing: 0,
                  }}>
                    (no effect — one team score per hole)
                  </span>
                )}
                {isParCompetition && (
                  <span style={{
                    marginLeft: 8, fontSize: "0.7rem", fontWeight: 600,
                    color: C.muted, textTransform: "none",
                    letterSpacing: 0,
                  }}>
                    (no effect on Par Competition)
                  </span>
                )}
              </div>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, 1fr)",
                gap: 6,
              }}>
                {Array.from({ length: 18 }, (_, i) => i + 1).map(h => {
                  const active = overrideHoles.includes(h);
                  return (
                    <button
                      key={h}
                      onClick={() => toggleHole(h)}
                      disabled={saving}
                      style={{
                        padding: "10px 0",
                        border: active ? `1.5px solid ${C.navy}` : `1px solid ${C.cardBorder}`,
                        background: active ? C.navy : "#fff",
                        color: active ? "#fff" : C.text,
                        borderRadius: 8,
                        fontSize: "0.85rem",
                        fontWeight: active ? 700 : 500,
                        cursor: saving ? "default" : "pointer",
                        fontFamily: C.font,
                      }}
                    >
                      {h}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  onClick={applyPreset9And18}
                  disabled={saving}
                  style={{
                    flex: 1, padding: "9px 10px",
                    border: `1px solid ${C.cardBorder}`,
                    background: "#fff",
                    borderRadius: 8,
                    fontSize: "0.82rem", fontWeight: 600, color: C.navy,
                    cursor: saving ? "default" : "pointer",
                    fontFamily: C.font,
                  }}
                >
                  9 &amp; 18
                </button>
                <button
                  onClick={clearAllHoles}
                  disabled={saving}
                  style={{
                    flex: 1, padding: "9px 10px",
                    border: `1px solid ${C.cardBorder}`,
                    background: "#fff",
                    borderRadius: 8,
                    fontSize: "0.82rem", fontWeight: 600, color: C.subtext,
                    cursor: saving ? "default" : "pointer",
                    fontFamily: C.font,
                  }}
                >
                  Clear all
                </button>
              </div>
            </div>

            {/* GOBS Stableford editable point-values section. Only renders for
                gobs_stableford — Standard's table is locked at the constant
                and intentionally has no admin UI. */}
            {selectedFormat === "gobs_stableford" && (
              <div style={{ marginTop: 20 }}>
                <div style={{
                  fontSize: "0.78rem", fontWeight: 700, color: C.navy,
                  textTransform: "uppercase", letterSpacing: "0.06em",
                  marginBottom: 8,
                }}>
                  Point values
                  <span style={{
                    marginLeft: 8, fontSize: "0.7rem", fontWeight: 600,
                    color: C.muted, textTransform: "none", letterSpacing: 0,
                  }}>
                    (per round)
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {GOBS_STABLEFORD_POINT_KEYS.map(({ key, label }) => (
                    <div
                      key={key}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "8px 12px",
                        background: "#fff",
                        border: `1px solid ${C.cardBorder}`,
                        borderRadius: 8,
                      }}
                    >
                      <span style={{ fontSize: "0.88rem", fontWeight: 500, color: C.text }}>
                        {label}
                      </span>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={pointValues[key]}
                        onChange={e => setPointValue(key, e.target.value)}
                        disabled={saving}
                        min={POINT_VALUE_MIN}
                        max={POINT_VALUE_MAX}
                        step={1}
                        aria-label={`${label} points`}
                        style={{
                          width: 64, padding: "6px 8px",
                          border: `1px solid ${C.cardBorder}`, borderRadius: 6,
                          fontSize: "0.95rem", fontWeight: 600,
                          color: C.text, background: "#fff",
                          textAlign: "right",
                          fontFamily: C.font,
                          outline: "none",
                        }}
                      />
                    </div>
                  ))}
                </div>
                <button
                  onClick={resetPointsToDefaults}
                  disabled={saving}
                  type="button"
                  style={{
                    marginTop: 10,
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    fontSize: "0.8rem", fontWeight: 600, color: C.navy,
                    cursor: saving ? "default" : "pointer",
                    fontFamily: C.font,
                    textDecoration: "underline",
                  }}
                >
                  Reset to defaults
                </button>
              </div>
            )}
          </>
        )}

        {errorMessage && (
          <div style={{
            marginTop: 14,
            padding: "10px 12px",
            background: C.errorBg,
            border: `1px solid ${C.errorBorder}`,
            borderRadius: 8,
            fontSize: "0.82rem",
            color: C.errorText,
          }}>
            {errorMessage}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              flex: 1, padding: "12px",
              background: "transparent",
              border: `1px solid ${C.cardBorder}`,
              borderRadius: 10,
              color: C.subtext,
              fontSize: "0.9rem",
              fontWeight: 500,
              cursor: saving ? "default" : "pointer",
              opacity: saving ? 0.5 : 1,
              fontFamily: C.font,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSaveClick}
            disabled={saving || !selectedFormat || !hasChanges || altShotBlocked}
            style={{
              flex: 2, padding: "12px",
              background: (!selectedFormat || !hasChanges || altShotBlocked) ? "#e2e8f0" : C.gold,
              border: "none",
              borderRadius: 10,
              color: (!selectedFormat || !hasChanges || altShotBlocked) ? C.muted : C.goldText,
              fontSize: "0.95rem",
              fontWeight: 700,
              cursor: (saving || !selectedFormat || !hasChanges || altShotBlocked) ? "default" : "pointer",
              fontFamily: C.font,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>

    {dangerOpen && (
      <DangerModal
        title="Change scoring rules mid-round?"
        description="Scores will be re-totaled under the new rules."
        cannotBeUndone={false}
        confirmLabel="Change rules"
        onConfirm={() => { setDangerOpen(false); void commitSave(); }}
        onCancel={() => setDangerOpen(false)}
      />
    )}
    </>
  );
}
