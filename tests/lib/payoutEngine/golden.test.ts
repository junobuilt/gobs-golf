import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { calculatePayouts } from "@/lib/payoutEngine";

// Golden regression contract. golden.csv is READ-ONLY and canonical: if a row
// fails, the engine is wrong, not the CSV (per docs/PAYOUT_ENGINE.md §11).
//
// Columns: players,team_size,balance,exp_1,exp_2,exp_3,exp_4,exp_sweep
//   exp_1..exp_4 are expected PER-PLAYER dollar amounts by place. An empty cell
//   means that place is not paid. exp_sweep is the expected bfb_sweep.
//
// Scope: abstract (no-ties) mode only. Ties are covered in tieResolver.test.ts.

type GoldenRow = {
  players: number;
  team_size: 2 | 3 | 4;
  balance: number;
  expected: number[]; // per-player amounts for each paid place
  exp_sweep: number;
  raw: string;
};

function loadGolden(): GoldenRow[] {
  const csvPath = fileURLToPath(new URL("./golden.csv", import.meta.url));
  const text = readFileSync(csvPath, "utf8");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Drop header row.
  const dataLines = lines.slice(1);

  return dataLines.map((line) => {
    const cells = line.split(",");
    const [players, team_size, balance] = cells.slice(0, 3).map(Number);
    const placeCells = cells.slice(3, 7); // exp_1..exp_4
    const exp_sweep = Number(cells[7]);
    const expected = placeCells
      .filter((c) => c !== "" && c !== undefined)
      .map(Number);
    return {
      players,
      team_size: team_size as 2 | 3 | 4,
      balance,
      expected,
      exp_sweep,
      raw: line,
    };
  });
}

const rows = loadGolden();

describe("payout engine — golden.csv regression contract", () => {
  it("loads ~73 golden rows", () => {
    expect(rows.length).toBeGreaterThanOrEqual(70);
  });

  it.each(rows)(
    "$raw",
    ({ players, team_size, balance, expected, exp_sweep }) => {
      const result = calculatePayouts({ players, team_size, balance });

      expect(result.places_paid).toBe(expected.length);
      expect(result.per_player).toEqual(expected);
      expect(result.bfb_sweep).toBe(exp_sweep);
      // Secondary cross-check: total_paid + sweep reconstitutes the balance.
      expect(result.total_paid).toBe(balance - exp_sweep);
    },
  );
});
