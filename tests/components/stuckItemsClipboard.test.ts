import { describe, it, expect } from "vitest";
import {
  formatStuckItemsForClipboard,
  formatStaleItemsForClipboard,
} from "@/components/scorecard/stuckItemsClipboard";

describe("formatStuckItemsForClipboard (Phase D)", () => {
  it("renders header + items as plain text", () => {
    const text = formatStuckItemsForClipboard(
      [
        { hole_label: "Hole 3", player_name: "Wayne H", strokes: 5 },
        { hole_label: "Hole 7", player_name: "Kevin I", strokes: 4 },
        { hole_label: "Hole 12", player_name: "Greg W", strokes: 6 },
      ],
      91,
      "2026-05-11",
    );
    expect(text).toBe(
      [
        "GOBS Golf — failed sync",
        "Round 91 — 2026-05-11",
        "",
        "Hole 3, Wayne H: 5 strokes",
        "Hole 7, Kevin I: 4 strokes",
        "Hole 12, Greg W: 6 strokes",
      ].join("\n"),
    );
  });

  it("omits the date suffix when playedOn is missing", () => {
    const text = formatStuckItemsForClipboard(
      [{ hole_label: "Hole 1", player_name: "Alice", strokes: 4 }],
      42,
    );
    expect(text).toContain("Round 42");
    expect(text).not.toContain("undefined");
    expect(text).not.toMatch(/Round 42 —/);
  });

  it("handles a single-item list", () => {
    const text = formatStuckItemsForClipboard(
      [{ hole_label: "Hole 9", player_name: "Bob", strokes: 6 }],
      1,
      "2026-05-13",
    );
    expect(text.split("\n").filter(l => l.length > 0)).toHaveLength(3);
  });
});

describe("formatStaleItemsForClipboard (Phase E)", () => {
  it("groups items by round_id with per-round headers", () => {
    const text = formatStaleItemsForClipboard([
      { hole_label: "Hole 3", player_name: "Wayne H", strokes: 5, round_id: 90, round_date: "2026-05-11" },
      { hole_label: "Hole 7", player_name: "Kevin I", strokes: 4, round_id: 90, round_date: "2026-05-11" },
      { hole_label: "Hole 12", player_name: "Greg W", strokes: 6, round_id: 91, round_date: "2026-05-11" },
    ]);
    expect(text).toBe(
      [
        "GOBS Golf — failed sync (last session)",
        "",
        "Round 90 — 2026-05-11:",
        "  Hole 3, Wayne H: 5 strokes",
        "  Hole 7, Kevin I: 4 strokes",
        "",
        "Round 91 — 2026-05-11:",
        "  Hole 12, Greg W: 6 strokes",
      ].join("\n"),
    );
  });

  it("omits the date when round_date is missing", () => {
    const text = formatStaleItemsForClipboard([
      { hole_label: "Hole 1", player_name: "Alice", strokes: 4, round_id: 42 },
    ]);
    expect(text).toContain("Round 42:");
    expect(text).not.toContain("undefined");
    expect(text).not.toMatch(/Round 42 —/);
  });

  it("returns just the header for an empty list", () => {
    expect(formatStaleItemsForClipboard([])).toBe(
      "GOBS Golf — failed sync (last session)",
    );
  });
});
