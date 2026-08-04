// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { getSavedHole, setSavedHole } from "@/lib/scorecard/holeMemory";

describe("holeMemory — per-scorecard last-viewed hole", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a saved hole for a key", () => {
    setSavedHole("round:171:team:3", 7);
    expect(getSavedHole("round:171:team:3")).toBe(7);
  });

  it("returns null when nothing was saved for the key", () => {
    expect(getSavedHole("tournament:match:42")).toBeNull();
  });

  it("does not leak across keys (different round / team / match)", () => {
    setSavedHole("round:171:team:3", 7);
    expect(getSavedHole("round:171:team:4")).toBeNull();
    expect(getSavedHole("round:172:team:3")).toBeNull();
    expect(getSavedHole("tournament:match:171")).toBeNull();
  });

  it("ignores an out-of-range hole on write", () => {
    setSavedHole("round:1:team:all", 0);
    expect(getSavedHole("round:1:team:all")).toBeNull();
    setSavedHole("round:1:team:all", 19);
    expect(getSavedHole("round:1:team:all")).toBeNull();
  });

  it("returns null for a corrupt persisted value", () => {
    window.localStorage.setItem("gobs:sc-hole:round:1:team:all", "banana");
    expect(getSavedHole("round:1:team:all")).toBeNull();
  });

  it("namespaces stored keys under gobs:sc-hole:", () => {
    setSavedHole("tournament:match:42", 12);
    expect(window.localStorage.getItem("gobs:sc-hole:tournament:match:42")).toBe("12");
  });
});
