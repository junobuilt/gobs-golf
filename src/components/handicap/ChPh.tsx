// Shared "CH {raw} · PH {playing}" display — the single source for how Course
// Handicap and Playing Handicap render together across every surface (scorecard
// meta row + tee-setup card, History drill-in player row, player profile rows).
// Keeping the literal format ("CH 13 · PH 10") + the accent rule in ONE place
// stops the surfaces from drifting (CLAUDE.md single-source principle).
//
// Definitions:
//   CH (Course Handicap)  — raw, allowance-independent (round_players.course_handicap).
//   PH (Playing Handicap) — CH × allowance%, rounded (getPlayingCourseHandicap).
//   At 100% allowance PH == CH; PH is the number that drives dots/net (display only here).
//
// Accent: when PH ≠ CH (an allowance < 100% is in effect), PH gets the shared
// allowance-orange so the eye catches the scoring number; CH stays plain. At
// 100% (PH == CH) both are plain.

const ALLOWANCE_ORANGE = "#c2410c";

export default function ChPh({
  ch,
  ph,
  style,
}: {
  ch: number | null;
  ph: number | null;
  style?: React.CSSProperties;
}) {
  const accent = ch != null && ph != null && ph !== ch;
  return (
    <span style={style}>
      {`CH ${ch ?? "—"} · `}
      <span style={accent ? { color: ALLOWANCE_ORANGE, fontWeight: 800 } : undefined}>
        {`PH ${ph ?? "—"}`}
      </span>
    </span>
  );
}
