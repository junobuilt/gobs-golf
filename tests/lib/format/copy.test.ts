import { describe, it, expect } from "vitest";
import { formatTeamTotal } from "@/lib/format/copy";

// C3: format-aware team total display. Helper has two modes:
//   - best-N (2_ball / 3_ball): input is a stroke delta vs par, output is
//     "+N" / "−N" / "E". Uses Unicode U+2212 for negative.
//   - Stableford-family (standard / modified): input is absolute team
//     points, output is "${total} pts". Negative totals are legal for
//     GOBS Stableford (Modified branch) and rendered with Unicode U+2212.
//
// Tests pin down exact strings — the helper's contract is the source of
// truth for downstream display, so any drift would visibly affect the
// scorecard pill and round summary.

describe("formatTeamTotal", () => {
  it("2_ball: positive delta renders as '+N'", () => {
    expect(formatTeamTotal(5, "2_ball")).toBe("+5");
  });

  it("2_ball: negative delta renders with Unicode minus (U+2212)", () => {
    expect(formatTeamTotal(-3, "2_ball")).toBe("−3");
  });

  it("2_ball: zero delta renders as 'E'", () => {
    expect(formatTeamTotal(0, "2_ball")).toBe("E");
  });

  it("stableford_standard: positive total renders as '${N} pts'", () => {
    expect(formatTeamTotal(14, "stableford_standard")).toBe("14 pts");
  });

  it("gobs_stableford: negative total renders with Unicode minus", () => {
    expect(formatTeamTotal(-3, "gobs_stableford")).toBe("−3 pts");
  });
});
