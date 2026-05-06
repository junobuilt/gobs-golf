import { describe, it, expect } from "vitest";
import { getTeamColor } from "@/lib/teamColors";

describe("Vitest setup verification", () => {
  it("runs trivial assertions", () => {
    expect(1 + 1).toBe(2);
  });

  it("can import from project source via the @/ alias", () => {
    const team1 = getTeamColor(1);
    expect(team1.border).toBe("#276e34");
  });
});
