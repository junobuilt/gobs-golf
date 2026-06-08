import { describe, it, expect } from "vitest";
import { scorecardHref } from "@/lib/round/scorecardHref";

describe("scorecardHref (Wave 1B routing)", () => {
  it("routes individual formats to the individual scorecard", () => {
    expect(scorecardHref(100, 2, "2_ball")).toBe("/round/100/scorecard?team=2");
    expect(scorecardHref(100, 1, "best_ball")).toBe("/round/100/scorecard?team=1");
    expect(scorecardHref(100, 1, "gobs_stableford")).toBe("/round/100/scorecard?team=1");
  });

  it("routes team-card formats (shambles) to the team-card surface", () => {
    expect(scorecardHref(100, 3, "shambles")).toBe("/round/100/team-card?team=3");
  });

  it("treats null/undefined format as individual", () => {
    expect(scorecardHref(100, 1, null)).toBe("/round/100/scorecard?team=1");
    expect(scorecardHref(100, 1, undefined)).toBe("/round/100/scorecard?team=1");
  });

  it("appends admin/edit params for both surfaces", () => {
    expect(scorecardHref(7, 1, "2_ball", { admin: true, edit: true })).toBe(
      "/round/7/scorecard?team=1&admin=1&edit=1",
    );
    expect(scorecardHref(7, 1, "shambles", { admin: true, edit: true })).toBe(
      "/round/7/team-card?team=1&admin=1&edit=1",
    );
  });
});
