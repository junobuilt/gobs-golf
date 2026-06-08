export function getHandicapStrokes(
  courseHandicap: number | null,
  strokeIndex: number,
): number {
  if (courseHandicap === null || courseHandicap === 0) return 0;
  const ch = Math.abs(courseHandicap);
  const fullStrokes = Math.floor(ch / 18);
  const remainder = ch % 18;
  let strokes = fullStrokes + (strokeIndex <= remainder ? 1 : 0);
  if (courseHandicap < 0) strokes = -strokes;
  return strokes;
}

// Wave 1A — handicap allowance. The SINGLE place the per-round allowance
// percentage is applied to a course handicap. Every stroke-allocation read
// site (dots + the net engine input on every surface) routes raw CH through
// here before the engine sees it; the displayed CH *number* label stays raw.
//
// Playing strokes = round(rawCH × allowance / 100), nearest whole stroke,
// with .5 rounding up (Math.round). 100% is the identity (round(rawCH) ===
// rawCH for the integer CH we store). A null CH stays null.
//
// Deliberately NOT used by the GHIN Adjusted Score, which is always computed
// at 100% (full handicap) and ignores the allowance — see types.ts.
export function getPlayingStrokes(
  rawCourseHandicap: number | null,
  allowancePercent: number,
): number | null {
  if (rawCourseHandicap === null) return null;
  return Math.round((rawCourseHandicap * allowancePercent) / 100);
}

export function computeCourseHandicap(
  handicapIndex: number | null,
  slope: number,
  rating: number,
  par: number,
): number | null {
  if (handicapIndex === null) return null;
  return Math.round(handicapIndex * slope / 113 + (rating - par));
}
