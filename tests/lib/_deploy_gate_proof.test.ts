// TEMPORARY — deliberately-failing test to prove the Vercel deploy gate blocks
// on a red `ci/test` check. Reverted immediately in the very next commit.
import { describe, it, expect } from "vitest";

describe("deploy-gate proof (TEMP — must be reverted)", () => {
  it("intentionally fails so CI posts ci/test=failure", () => {
    expect(1).toBe(2);
  });
});
