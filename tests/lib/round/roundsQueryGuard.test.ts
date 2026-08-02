// Source-scanning invariant — the structural guard for tournament isolation.
//
// Instead of render-testing all eight inline component queries, this walks the
// whole `src/` tree and asserts EVERY `from("rounds")` read and every
// `rounds!inner` embed is one of:
//   (a) accompanied by a `tournament_id` filter (its statement mentions
//       tournament_id — the top-level `.is("tournament_id", null)` or the
//       embedded `.is("rounds.tournament_id", null)`), OR
//   (b) an explicitly ALLOWLISTED by-id / write path (see ALLOWLIST below,
//       each entry carrying the reason it is exempt).
//
// Why this and not render tests: it is cheap AND it catches a query nobody has
// written yet — the day someone adds an unfiltered league read of `rounds`,
// this test goes red. The negative control at the bottom proves the scanner
// actually fails when a real filter is removed (not a vacuous green).

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const SRC = path.join(REPO_ROOT, "src");

// Every `from("rounds")` / `rounds!inner` occurrence that is intentionally
// UNFILTERED, with the reason. All are either by-id surfaces (operate on one
// round already chosen — tournament rounds are managed/rendered through these)
// or writes. `sig` is a whitespace-normalized substring that uniquely
// identifies the statement within `file`.
type AllowEntry = { file: string; sig: string; why: string };
const ALLOWLIST: AllowEntry[] = [
  {
    file: "src/app/admin/tabs/RoundSetup.tsx",
    sig: 'delete().eq("id", existingRoundId)',
    why: "Delete Round — deletes one round chosen by id, not a league listing.",
  },
  {
    file: "src/lib/round/ensureRoundShell.ts",
    sig: "insert({ played_on: date",
    why: "Creates a LEAGUE round; tournament_id is never set here so it defaults NULL (preserve).",
  },
  {
    file: "src/lib/round/ensureSeasonAndRoundShell.ts",
    sig: "update({ season_id: season.id })",
    why: "Stamps season_id on a freshly created round by id (write).",
  },
  {
    file: "src/lib/round/finalizeRoundAdmin.ts",
    sig: "update({ is_complete: true })",
    why: "Finalizes one round chosen by id (write).",
  },
  {
    file: "src/lib/round/reopenRound.ts",
    sig: 'select("format_config").eq("id", roundId)',
    why: "Reopen reads one round's config by id.",
  },
  {
    file: "src/lib/round/reopenRound.ts",
    sig: "update({ is_complete: false",
    why: "Reopen writes one round by id.",
  },
  {
    file: "src/lib/round/results.ts",
    sig: 'select("id, played_on, is_complete").eq("id", roundId)',
    why: "Shared scoring engine — by-id read reused by /summary, which MUST render tournament rounds (preserve).",
  },
  {
    file: "src/app/round/[id]/scorecard/page.tsx",
    sig: 'select("format_config, is_complete, played_on").eq("id", roundId)',
    why: "Scorecard reads its own round by id.",
  },
  {
    file: "src/app/round/[id]/scorecard/page.tsx",
    sig: 'select("format_config, is_complete").eq("id", roundId)',
    why: "Scorecard reads its own round by id.",
  },
  {
    file: "src/app/round/[id]/scorecard/page.tsx",
    sig: 'select("format_config").eq("id", roundId)',
    why: "Scorecard reads its own round's config by id.",
  },
  {
    file: "src/app/round/[id]/scorecard/page.tsx",
    sig: 'update({ format_config: nextCfg }).eq("id", roundId)',
    why: "Scorecard writes its own round by id.",
  },
  {
    file: "src/app/round/[id]/team-card/page.tsx",
    sig: 'select("format_config, is_complete").eq("id", roundId)',
    why: "Team-card reads its own round by id.",
  },
  {
    file: "src/app/round/[id]/team-card/page.tsx",
    sig: 'select("format_config").eq("id", roundId)',
    why: "Team-card reads its own round's config by id.",
  },
  {
    file: "src/app/round/[id]/team-card/page.tsx",
    sig: 'update({ format_config: nextCfg }).eq("id", roundId)',
    why: "Team-card writes its own round by id.",
  },
  {
    file: "src/components/round/EditModeBanner.tsx",
    sig: 'select("is_complete, was_finalized").eq("id", roundId)',
    why: "Edit banner reads its own round's lifecycle by id.",
  },
];

const norm = (s: string) => s.replace(/\s+/g, " ");
// Signature/window matching is whitespace-insensitive: the source wraps chains
// across indented lines (`.select(...)\n    .eq(...)`), so an exact substring
// with single spaces wouldn't match. Squash ALL whitespace on both sides.
const squash = (s: string) => s.replace(/\s+/g, "");

// Blank out full-line `//` comments before scanning. Two hazards they create:
//   1. A comment that merely MENTIONS `rounds!inner` (prose) is not a query.
//   2. A comment containing a `;` (e.g. "tournaments.season_id); this filter")
//      would truncate the statement window before its `.is(...)` filter,
//      making a genuinely-guarded query look unguarded.
// Trailing inline comments (line starts with code) are left alone — they never
// carry a stray `from("rounds")`/`rounds!inner`, and the guarded queries keep
// their `tournament_id` on the code portion of the line.
const stripLineComments = (content: string) =>
  content
    .split("\n")
    .map((l) => (/^\s*\/\//.test(l) ? "" : l))
    .join("\n");

// One occurrence of a rounds read: the file, the char index, and its statement
// window (from the match to the next `;` — Supabase chains are single
// statements with no interior semicolons).
type Occ = { file: string; index: number; window: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(abs, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(abs);
    }
  }
  return out;
}

function collectOccurrences(files: { rel: string; content: string }[]): Occ[] {
  const occ: Occ[] = [];
  const patterns = [/from\("rounds"\)/g, /rounds!inner/g];
  for (const { rel, content: raw } of files) {
    const content = stripLineComments(raw);
    for (const re of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const end = content.indexOf(";", m.index);
        const window = content.slice(m.index, end === -1 ? m.index + 600 : end);
        occ.push({ file: rel, index: m.index, window });
      }
    }
  }
  return occ;
}

// Returns { violations, matchedEntries } — a violation is an unfiltered rounds
// read not covered by any allowlist entry; matchedEntries lets us flag stale
// allowlist rows that no longer match anything.
function audit(files: { rel: string; content: string }[], allowlist: AllowEntry[]) {
  const occ = collectOccurrences(files);
  const violations: Occ[] = [];
  const matchedEntries = new Set<AllowEntry>();
  for (const o of occ) {
    if (o.window.includes("tournament_id")) continue; // guarded (a)
    const sWin = squash(o.window);
    const entry = allowlist.find((e) => e.file === o.file && sWin.includes(squash(e.sig)));
    if (entry) {
      matchedEntries.add(entry);
      continue; // allowlisted (b)
    }
    violations.push(o);
  }
  return { violations, matchedEntries, total: occ.length };
}

function loadSrcFiles() {
  return walk(SRC).map((abs) => ({
    rel: path.relative(REPO_ROOT, abs).split(path.sep).join("/"),
    content: fs.readFileSync(abs, "utf8"),
  }));
}

describe("rounds query guard — every league read of rounds excludes tournament rounds", () => {
  it("sanity: the scanner actually finds rounds reads in src/", () => {
    const { total } = audit(loadSrcFiles(), ALLOWLIST);
    // Guards against a broken walker/glob silently passing with zero occurrences.
    expect(total).toBeGreaterThan(20);
  });

  it("has NO unfiltered, non-allowlisted rounds read", () => {
    const { violations } = audit(loadSrcFiles(), ALLOWLIST);
    const report = violations.map((v) => `${v.file}: ${norm(v.window).slice(0, 90)}`);
    expect(report).toEqual([]);
  });

  it("has no stale allowlist entries (every entry still matches a real query)", () => {
    const { matchedEntries } = audit(loadSrcFiles(), ALLOWLIST);
    const stale = ALLOWLIST.filter((e) => !matchedEntries.has(e)).map((e) => `${e.file} :: ${e.sig}`);
    expect(stale).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // NEGATIVE CONTROLS — prove the scanner fails when a filter is removed.
  // -------------------------------------------------------------------------
  it("NEGATIVE CONTROL: removing the tournament_id filter from loadRoundsList is caught", () => {
    const real = fs.readFileSync(path.join(SRC, "lib/round/loadRoundsList.ts"), "utf8");
    expect(real).toContain('.is("tournament_id", null)'); // precondition: filter is present
    const stripped = real.replace(/\s*\.is\("tournament_id", null\)[^\n]*/, "");
    const { violations } = audit(
      [{ rel: "src/lib/round/loadRoundsList.ts", content: stripped }],
      ALLOWLIST, // loadRoundsList is NOT allowlisted — it must rely on the filter
    );
    expect(violations.length).toBe(1);
    expect(violations[0].file).toBe("src/lib/round/loadRoundsList.ts");
  });

  it("NEGATIVE CONTROL: a brand-new unfiltered league read in a non-allowlisted file is caught", () => {
    const synthetic = {
      rel: "src/app/some/new/page.tsx",
      content:
        'const { data } = await supabase.from("rounds").select("id").eq("is_complete", true);',
    };
    const { violations } = audit([synthetic], ALLOWLIST);
    expect(violations.length).toBe(1);
  });
});
