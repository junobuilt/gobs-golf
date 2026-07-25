// Documentation-as-test (approved deviation 1). The roundsQueryGuard scanner
// treats ANY `from("rounds")` statement mentioning the substring "tournament_id"
// as "guarded" — it does NOT distinguish `.is("tournament_id", null)` (league)
// from `.eq("tournament_id", id)` (tournament). That imprecision is accepted for
// now and logged as tech debt; the guard is deliberately NOT tightened this
// session.
//
// This test pins down INTENT that the guard can't see: every `from("rounds")`
// touch in the tournament data layer is deliberately tournament-scoped
// (`.eq("tournament_id", …)`), never NULL-filtered. If someone later tightens
// the scanner to require `.is(..., null)`, this enumerates exactly which sites
// are the intentional `.eq`-filtered exceptions.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "src", "lib", "tournament");

function roundsStatements(file: string): string[] {
  // Strip `//` comments so header prose mentioning from("rounds") isn't counted.
  const content = fs
    .readFileSync(path.join(SRC, file), "utf8")
    .replace(/\/\/[^\n]*/g, "");
  const out: string[] = [];
  const re = /from\("rounds"\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const end = content.indexOf(";", m.index);
    out.push(content.slice(m.index, end === -1 ? m.index + 400 : end));
  }
  return out;
}

describe("tournament data layer — rounds reads are intentionally .eq-filtered", () => {
  it("every from(\"rounds\") in mutations.ts is tournament-scoped, never NULL-filtered", () => {
    const stmts = roundsStatements("mutations.ts");
    // ensureTournamentRound: lookup + 23505 re-fetch + insert; deleteSession:
    // delete; editSession: the date-move round update. = 5
    expect(stmts.length).toBe(5);
    for (const s of stmts) {
      expect(s.includes("tournament_id")).toBe(true); // intentional tournament scope
      expect(s.includes('.is("tournament_id", null)')).toBe(false); // NOT a league read
    }
  });

  it("queries.ts touches rounds only via league-scoped helpers (none direct)", () => {
    // The tournament READS live on tournament_* tables; the only rounds touch is
    // getSessionRoundStatus reading round_players/scores (not `rounds`).
    expect(roundsStatements("queries.ts").length).toBe(0);
  });
});
