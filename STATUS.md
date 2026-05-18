# GOBS Status

*Auto-maintained by Claude Code at end of each session. For session handoff. Single source of truth for "what's the state right now."*

**Last updated:** 2026-05-17 PM5 (end of Phase A.1 polish session)
**Session purpose:** Three small scorecard polish commits — drop redundant `Tot` from the team-pill F9/B9 row, replace green-text birdie with traditional concentric notation marks on `PlayerHoleGrid` score cells, and refresh the three-row visual hierarchy on hole/par/gross.

---

## Today's work — 2026-05-17 PM5 (Phase A.1 polish)

Three small commits to refine the surfaces introduced by A1.6 + A1.7. All three are scorecard-only at the file level; `PlayerHoleGrid` changes in P2 + P3 naturally propagate to `<RoundResultsView/>` consumers (`/leaderboard` + `/round/[id]/summary`) since it's the shared per-player grid — that propagation is the intended consequence of the A1.7 extraction, not a separate edit.

### P1 — Drop "Tot" from team-pill F9/B9/Tot row (commit `370c7df`)

File: `src/app/round/[id]/scorecard/page.tsx`. The headline team-net delta on the navy pill IS the total by construction (Nassau settles each leg separately; F9 + B9 = headline always), so the trailing `· Tot [val]` segment was redundant. Row is now `F9 [val] · B9 [val]`. Removed the `getTeamNetDeltaForHoles(ALL_HOLES)` call and the now-unused `ALL_HOLES` constant. Empty state preserved as `F9 — · B9 —`.

### P2 — Traditional notation marks on score cells (commit `00a54c3`)

File: `src/components/scorecard/PlayerHoleGrid.tsx`. Replaces the prior `COLOR_BIRDIE = #3B6D11` text-color treatment with concentric circles (under-par) or squares (over-par). The shape now carries the over/under-par signal uniformly across all cells.

Mapping by `delta = score − par`:

| delta | mark |
| --- | --- |
| ≤ −3 (incl. par-4/5 ace) | triple circle |
| −2 (incl. par-3 ace) | double circle |
| −1 | single circle |
| 0 | bare number |
| +1 | single square |
| +2 | double square |
| ≥ +3 | triple square |

New internal `<ScoreMark>` subcomponent wraps the number in nested fixed-size divs (`1px solid currentColor`, `boxSizing: border-box`) with `borderRadius: 50%` for circles or `"0"` for squares. Tiered sizing 22 / [26, 20] / [28, 22, 18] per spec. Score cell `minHeight: 32px` so triple notation has breathing room above the F9/B9 divider; the cell is now flex-centered so the shape sits in the middle. Notation renders on top of the current-hole highlight via currentColor. `COLOR_BIRDIE` constant removed.

### P3 — Three-row visual hierarchy (commit `23d7379`)

Same file. Restyles the three rows so the eye reads header → reference → data without labels:

| Row | Treatment |
| --- | --- |
| Hole numbers + F9/B9 label | navy primary `#042C53`, weight 500 |
| Par + par subtotal | italic, muted `#94a3b8`, weight 500 |
| Gross + gross subtotal | primary `#1e293b`, weight 600 |

Hole-number cells no longer special-case the current-hole color (was `#1e40af`) — the `#dbeafe` background still marks the current hole on its own, and keeping the navy uniform reads cleaner. The new `COLOR_NAVY = #042C53` constant.

### Verification

- `tsc --noEmit` clean across all three commits.
- **259/259 unit tests pass** across 25 files (251 prior + 8 new in `tests/components/PlayerHoleGrid.test.tsx`). New tests cover each notation tier (single/double/triple for both circle + square), par no-mark, ace cap (par-5 score=1 → triple circle), +5 cap (still triple square), and that the legacy `#3B6D11` is absent regardless of birdies.
- Browser preview at iPhone SE (375 × 812) on round 95 team 1:
  - **Team pill:** renders `TEAM NET −5` headline + `F9 −6 · B9 +1` row (no Tot segment).
  - **Expanded grid:** 1 birdie circle (22px), 10 single-square bogeys (22px), 1 double-square double-bogey (26 outer + 20 inner). Distribution captured via `getComputedStyle`.
  - **No green `#3B6D11`** anywhere in the rendered HTML (confirmed via DOM scan).
  - **Hierarchy verification** via `getComputedStyle` on representative cells: hole `rgb(4,44,83)` / weight 500 / normal; par `rgb(148,163,184)` / weight 500 / italic; gross `rgb(30,41,59)` / weight 600 / normal. F9/B9 subtotal column tracks the same per-row treatment.
- `preview_screenshot` skipped (consistent 30s browser-side timeout on this Windows preview; same as PM2/PM3/PM4 sessions); structural verification via `preview_eval` covers all spec requirements.

### Side-effect propagation (worth flagging for the next session)

P2 and P3 touch the shared `PlayerHoleGrid` component. This is the same component consumed by `<RoundResultsView/>` on `/leaderboard` and `/round/[id]/summary`. The visual changes therefore propagate to those routes uniformly — birdies on the summary expand-grids now show as circles instead of green text, and the hole/par/gross rows on those routes pick up the new hierarchy. The spec marked leaderboard / summary as out of scope; this propagation is the intended consequence of the A1.7 extraction, not a separate edit. Behavior unchanged on those routes — only visuals shift.

### ROADMAP updates

- New `### Phase A.1 polish — 2026-05-17 (post-A1.7)` subsection at the bottom of the Phase A.1 block, with a 3-row table summarizing P1 / P2 / P3 + commit hashes.
- A1.6 row gets an `**Update 2026-05-17 (polish P1):**` annotation noting Tot was removed.
- A1.7 row gets an `**Update 2026-05-17 (polish P2 + P3):**` annotation noting the notation marks + hierarchy refresh.
- New `May 17 (PM5)` session log entry above the `May 17 (PM4)` entry.
- Top-of-file last-updated banner refreshed.

---

## Earlier today — 2026-05-17 PM4 (shared RoundResultsView extraction)

### Shared round-results surface

**New file `src/lib/round/results.ts`** — pure async loader + types:
- Types: `PlayerRow`, `TeamRow`, `LoadedRoundResults`, `LoadRoundResultsOutcome`.
- `loadRoundResults(roundId): Promise<LoadRoundResultsOutcome>` — performs the Supabase round / round_players / scores / holes queries, computes engine results, derives F9/B9 leg splits, rolls up per-player Stableford points (when applicable), ranks teams via `rankTeams`, and returns the full shape both pages need.
- Outcome variants: `{status: "ok", data: LoadedRoundResults}` / `{status: "missing_round"}` / `{status: "missing_format"}`. Page-level `useEffect` wraps the call with a `cancelled` flag.

**New file `src/components/round/RoundResultsView.tsx`** — visual component:
- Props: `data: LoadedRoundResults`. That's it. The component is fully driven by the loader output.
- Renders: round-meta header (date "Weekday · Month Day", read-only `FormatChip`, course name "Semiahmoo Golf & Country Club", status tag "Final" / "In progress · thru N"), then a warm-bg body section with ranked team cards (gold rank-1 badge, navy others, F9/B9 row, format-aware total color) and the Individual Rankings section below.
- Owns the multi-expand state via two internal `useState<Set<number>>` for `expandedTeams` (keyed by `team_number`) and `expandedPlayers` (keyed by `round_player.id`). Same toggle semantics as the previous summary page.
- TeamCard / PlayerSection / IndividualRankings / RankBadge / Chevron are all internal helpers — not exported. Lifting them out for reuse is not yet warranted.

**Refactored `src/app/round/[id]/summary/page.tsx`** — ~770 lines → ~60 lines:
- `useEffect` calls `loadRoundResults(roundIdNum)` and stores the outcome.
- Loading / `missing_round` / `missing_format` outcomes render dedicated centered messages.
- `ok` outcome renders a wrapper div (maxWidth 600, font, paddingBottom 140 for the bottom nav) with a small "← Back" link strip above `<RoundResultsView data={state.data}/>`.
- No types or helpers remain in this file — all moved to the shared module.

**Refactored `src/app/leaderboard/page.tsx`** — ~450 lines → ~180 lines:
- `useCallback` loader does the today's-round Supabase lookup (`played_on = todayLocal()`, latest by `created_at`), branches into the four states (`loading` / `no_round` / `no_format` / `results`), and for `results` calls `loadRoundResults(round.id)` to populate `data`.
- View component renders the navy state strip ("Semiahmoo · Round in progress" / "Round complete" / "No round today") at the top, then either `<RoundResultsView/>` (results state) or the centered "Today's Round" empty header + ⛳ dashed-border empty card + "View season stats →" link (no_round / no_format states).
- Race protection: if the today's-round lookup finds a row but `loadRoundResults` then returns `missing_round` (deletion race), the page surfaces as `no_round`. Same for `missing_format`.
- Deleted: `LeaderboardState` (old type), `TeamForBoard`, `RoundRow`, `Leaderboard`, `RankBadge`, `ScoreLabel` helper functions, FORMAT_LABELS / formatTeamTotal / isStablefordFormat / rankTeams / holesCompleteForTeam / getScoringBasis / computeRoundResult / HoleInfo / FormatConfig imports — all subsumed by the shared module.

### Visual / behavior trade-offs accepted (confessed)

1. **Per-team `thru N` removed from the leaderboard.** Previously each team card on `/leaderboard` showed `thru N` in its right column; now there's a single round-level `thru N` (max across teams) in the header status tag. Visual consistency gain across both routes; slight per-team progress information loss. Per-team progress is still discoverable by expanding a team — its `PlayerHoleGrid` shows exactly which holes have scores.
2. **Leaderboard date format changed.** Was `prettyDate("May 17, 2026")` centered with a "Today's Round" caption above. Now `formatHeaderDate("Sunday · May 17")` left-aligned (shared header convention). Year dropped — fine since the leaderboard always shows today. The "Today's Round" caption only appears in the empty states (no_round / no_format), which still need the date display to feel grounded.
3. **Empty states stay on `/leaderboard` only.** Per spec — the shared component assumes a real round exists. The `EmptyHeader` and `EmptyBody` components are leaderboard-local and not exported.
4. **No new tests.** The extraction is a pure refactor — data shape unchanged, rendering unchanged, behavior unchanged. The underlying helpers (`rankTeams`, `formatTeamTotal`, `holesCompleteForTeam`, `PlayerHoleGrid`) are already covered by their existing test files. The shared loader is effectively the previous summary-page useEffect body lifted out verbatim; the previous tests still cover the data-derivation logic. Adding a component test for `<RoundResultsView/>` would duplicate coverage that already exists at the helper level.

### Verification

- `tsc --noEmit` clean.
- **251/251 unit tests pass** across 25 files.
- Browser preview on iPhone SE (375 × 812):
  - **/leaderboard** loads today's round 95. Navy state strip reads `"Semiahmoo · Round complete"`. `<RoundResultsView/>` renders inline: Team 1 card visible with rank 1 gold badge. Clicking the team chevron flips `aria-expanded` to `true` and reveals 2 player rows ("Expand Thomas Y" + "Expand Don D"). Clicking a player chevron reveals `PlayerHoleGrid` with 2 grid sections (60 cells total). Individual Rankings section renders below with both players ranked.
  - **/round/90/summary** loads round 90 (Best Ball, complete, 5 teams). `"← Back"` link visible at top above the meta header. 5 teams render in correct rank order (Team 1 → 5 → 2 → 4 → 3). 1st-place card: header bg `rgb(250,248,240)` (cream `#faf8f0`); rank badge `rgb(212,160,23)` (gold `#d4a017`). Individual Rankings section renders with 10 rows below the team cards.
  - **/round/95/summary** loads single-team round; renders 1 team card + 2 players in Individual Rankings.
  - Zero console errors on either route.
- `preview_screenshot` skipped (consistent 30s browser-side timeout in this Windows preview environment); structural verification via accessibility-tree snapshot + `getComputedStyle` covers all visual requirements.

### ROADMAP updates

- C5 row gets an "**Update 2026-05-17 PM4**" annotation describing the extraction + leaderboard wiring.
- New `May 17 (PM4)` session log entry appended above the `May 17 (PM3)` entry.
- Top-of-file last-updated banner refreshed.

---

## Earlier today — 2026-05-17 PM3 (Individual Rankings restoration)

### Individual Rankings section restored on /round/[id]/summary

**Change in `src/app/round/[id]/summary/page.tsx`** — `PlayerRow` type gains a new `netTotal: number` field (absolute net stroke total for best-N via `engine.perPlayer.netTotal`; equals `netValue` / points sum for Stableford). The in-team-expanded player row still displays `netValue` (signed delta or pts) so the colored performance indicator is preserved — `netTotal` is solely for the new cross-team ranking section.

**New `IndividualRankings` component:** flattens every player across every team (filtered `holesPlayed > 0`), runs decorate-sort-undecorate + skip-tie rank assignment inlined (same pattern as `rankTeams` in `src/lib/leaderboard/rank.ts`, not extracted to a shared helper since the data shape differs — player rows vs team rows — and there are no other callers yet to justify a generic `rankBy`). Sort direction: best-N ascending (lowest net wins), Stableford descending (highest points wins). Rendered as a single white card directly below the last team card, inside the same `bgWarm` body container.

**Row layout:**
- Rank number left-aligned in a fixed 28px column; 1st place in gold `#d4a017` (matches team rank badge color), others in `C.textSecondary` `#6b6b6b`.
- Player name (700 weight) + team name (muted 11px) stacked.
- Best-N: `Gross [N]` + `Net [N]` side-by-side on the right with small uppercase labels — mirrors the in-team-expanded layout but shows absolute totals (since "lowest net wins" is the only cross-team signal).
- Stableford: `[N] pts` in blue (`C.accentBlue`) on the right.
- Subtitle under the section header: "Sorted by net score · lowest wins" or "Sorted by total points · highest wins" depending on format.

**Behavior:**
- Read-only — no expand, no tap actions.
- Players with `holesPlayed === 0` are excluded (unplayed rows would rank above played rows under ascending sort).
- Tie handling: tied entries share a rank, the next rank is skipped (1, 2, 2, 4) — same convention as `rankTeams`.
- Uses already-loaded data — zero new Supabase queries.

**Why inline the rank logic instead of extracting a shared helper:**
Spec offered either option. Considered extracting a generic `rankByTotal<T>(items, totalFn, ascending)` helper that both `rankTeams` and this section could share, but:
1. Refactoring `rankTeams` to use it would touch a tested file purely for de-duplication — anti-drift per CLAUDE.md ("Don't refactor unrelated code, even in files being touched").
2. Adding a generic helper without converting `rankTeams` leaves the same pattern in two places anyway.
3. Player ranking and team ranking have slightly different sort-direction semantics (player uses `netTotal`, team uses `total`) — the wrapping for a generic call would be similar in size to inlining.

Trade-off accepted: ~15 lines of inlined pattern over a marginal extraction. Revisit when a third use case appears.

**Confessed scope deviations:**
- Section uses absolute net stroke total for best-N ranking, not the net-vs-par-of-played delta used inside the team-expanded row. Absolute net is the canonical "who shot the best score" interpretation and matches the previous summary's `gross_total`-based sort. For incomplete rounds where players have different `holesPlayed` counts, the absolute-net comparison favors lower-hole-played players (fewer strokes accrued), but this is also true of the original implementation and is arguably more honest than ranking by delta.
- The previous summary's table-based markup is gone — replaced with a card layout that matches the rest of the rebuilt summary's visual language (rounded white card on warm background, border, divider lines between rows).

**Verification:**
- `tsc --noEmit` clean.
- **251/251 unit tests pass** across 25 files. No new tests added — the section is a pure render over already-tested `PlayerRow` data + an inlined sort/rank pattern matching `rankTeams`'s tested semantics.
- Browser preview on iPhone SE (375 × 812):
  - **Round 90 (Best Ball, 5 teams, 10 players):** all 10 players listed, sorted ascending by net: Wayne H 67, Don D 71, Kevin I 72, Ward C 74, Wayne V 74, Thomas Y 76, Dan G 76, Dan S 77, Greg W 82, Bob B 88. Tie-skip ranks verified: Ward C / Wayne V both rank 4 → next is rank 6; Thomas Y / Dan G both rank 6 → next is rank 8. 1st-place rank "1" computed-style `rgb(212,160,23)` = gold `#d4a017`; rank "2" computed-style `rgb(107,107,107)` = `#6b6b6b` secondary text. Section card sits below the last team card via document flow (no positioning hacks).
  - **Round 95 (Best Ball, 1 team, 2 players):** 2 players listed (Thomas Y 70, Don D 79), ranked 1–2.
  - Zero console errors.
- Stableford branch (descending sort + "N pts" display) not exercised live in this session — no Stableford round in the database to test against. The branch is a thin variant: same flatten + filter + sort pattern with `ascending` flipped and a different display block. Engine's per-player Stableford points roll-up is already covered by the 25-test `engine-stableford.test.ts` suite, and the formatting matches `formatTeamTotal`'s Stableford convention (which has its own 5-test suite). Confident in code-review of the branch.

**ROADMAP updated:**
- C5 row gets a "**Update 2026-05-17 PM3**" annotation describing the restoration.
- New `May 17 (PM3)` session log entry appended above the `May 17 (PM2)` PR 3 entry.
- Top-of-file last-updated banner refreshed.

---

## Earlier today — 2026-05-17 PM2 (Phase C PR 3)

### Phase C PR 3 shipped — C4 + C5 + C6

**Full rewrite of `src/app/round/[id]/summary/page.tsx`.** Replaces the previous raw-absolute-scores layout (Team header banner + bare numeric totals + Individual Rankings table) with an all-teams ranked, two-level drill-down that mirrors the leaderboard conventions PR 2 established.

**Header:**
- Date in `"Weekday · Month Day"` form (e.g. "Sunday · May 17"), built via two `toLocaleDateString` calls and joined with a middle dot.
- Read-only `FormatChip` (no `onChange` prop → component's internal `editable = typeof onChange === "function"` resolves to false; chip renders without the "Change" affordance). Lock icon shows when `format_locked_at != null`.
- Course name "Semiahmoo Golf & Country Club" (hardcoded — single-course app).
- Status tag on right: green-on-mint "Final" (`#15803d` on `#dcfce7`) when `is_complete`; secondary-text "In progress · thru N" when live, where N = `Math.max(...teams.map(t => t.thru))` using the PR 2 `holesCompleteForTeam` helper.

**Team cards (ranked via shared `rankTeams` from `src/lib/leaderboard/rank.ts`):**
- Rank badge: gold `#d4a017` for rank 1, navy `#042C53` for others (spec color — slightly darker than the leaderboard's `#0c3057`, deliberate per spec).
- Team name + dot-separated roster (same format as leaderboard).
- Big total on right via `formatTeamTotal(team.total, format)`. Color rules: best-N → green/red/black for under/over/even; Stableford → blue. `team.total = rawTeamScore - teamParAtScored`, which collapses to absolute Stableford points by the C3 convention (`teamParAtScored == 0` for non-best-N).
- Small "F9 [val] · B9 [val]" leg row below the roster. Leg totals computed inline by walking `engine.perHole`, filtering to holes 1–9 / 10–18, summing `teamScore` and (for best-N only) `par × contributingPlayerIds.length`. Returns `null` when no in-range hole has a team score → renders "—". Same leg semantics as A1.6's pill row.
- 1st-place card: header section gets `#faf8f0` (cream) background tint for emphasis. Spec mentioned `var(--color-background-secondary)`, which does not exist in globals.css; closest analog is `--cream` = `#faf8f0`, used inline since the page is otherwise pure inline-styles.
- Chevron-down on the right toggles team expand. Aria-label flips Expand ↔ Collapse + aria-expanded for screen readers.

**Player rows (inside expanded team):**
- Player name on left.
- Right side: Gross [N] + Net [delta or pts] side-by-side, each with a tiny uppercase label above ("GROSS" / "NET") and the value at 16px / weight 700. When `holesPlayed === 0` both render as `—`.
- Net colored by performance via shared `scoreColor` rule (green/red/black for best-N delta vs par-of-played; blue for Stableford pts).
- For Stableford: player Net = sum of `result.perHole[i].result.perPlayer.find(p => p.playerId == X).points` across all 18 holes. The engine's `result.perPlayer` field currently only carries stroke totals (gross/net), so points are rolled up inline — documented as a deliberate non-engine-change.
- Chevron-down on the right toggles player expand. When expanded: `<PlayerHoleGrid scores={...18} par={...18} showRunningTotal={false} />` — `currentHoleIndex` omitted entirely so no current-hole highlight on summary view (A1.7's component supports this directly).

**Multi-expand at both levels:** two independent `Set<number>` state objects (`expandedTeams` keyed by `team_number`, `expandedPlayers` keyed by `round_player.id`). Verified live: Team 1 + Team 5 simultaneously expanded, Ward C + Wayne H simultaneously expanded inside Team 1.

**Stableford handling:** `rankTeams` already flips sort direction for Stableford formats per its existing contract (descending — highest wins). `formatTeamTotal` already prints "${N} pts" for Stableford with Unicode minus for negative GOBS Stableford totals. Player Net display branches on `isStablefordFormat(format)` to swap delta formatting for `"${N} pts"`.

**Data plumbing:** single Supabase load chain — `rounds` (1 row), `round_players` (filtered `team_number > 0`, embedded `players(...)` join, embedded `tees(...)` no longer needed since the redesigned card doesn't show per-player tee color), `scores` (`.in("round_player_id", rpIds)`), and one `holes` query per unique tee. Then `computeRoundResult` per team to drive both team totals and player perHole points. Loading state shown until everything resolves; cleanup-on-unmount guard via `cancelled` flag.

**Confessed scope deviations:**
- The old summary's bottom "Individual Rankings" cross-team table is gone. Per-player gross/net is now exposed inside each team's expanded panel, which the spec explicitly opted into. Surface-level loss; better drill-down model.
- Spec's `var(--color-background-secondary)` token doesn't exist in this codebase — substituted `#faf8f0` (matches `--cream` in globals.css). Flagged in case the spec intent was a token that should be added globally.
- The previous summary had a Gross / Net view toggle (segmented control). Removed — the new design shows both per-player gross and per-player net side-by-side in the expanded row, and the team total is always the format-aware "net delta" (or Stableford pts) per leaderboard PR 2 convention. No remaining need for a top-level toggle.
- The previous summary's "Back to Home" link styling moved from centered above the heading to a small inline link in the header.

**Out of scope per spec (confessed):** live scorecard, leaderboard, season page — all untouched. A1.7's `PlayerHoleGrid` component consumed verbatim — no changes to the component itself.

**Tests:** no new tests in this session. The new page is a thin consumer of three already-tested helpers:
- `rankTeams` — 13 tests in `tests/lib/leaderboard/rank.test.ts` (covering ascending/descending, ties, skip semantics, immutability)
- `formatTeamTotal` — 5 tests in `tests/lib/format/copy.test.ts`
- `PlayerHoleGrid` — 11 tests in `tests/components/PlayerHoleGrid.test.tsx` (A1.7)
The summary page itself has no extracted pure helpers worth testing in isolation (legTotal closure could be lifted, but it's a 12-line walk over `perHole` — same shape as A1.6's `getTeamNetDeltaForHoles` which is similarly inlined).

**Verification:**
- `tsc --noEmit` clean.
- **251/251 unit tests pass** across 25 files.
- Browser preview at iPhone SE (375 × 812):
  - Round 90 (Best Ball, complete, 5 teams). All 5 teams render in correct rank order (Team 1 / Team 5 / Team 2 ↔ Team 4 tied at rank 3 / Team 3 at rank 5 — tie-skip semantics confirmed). F9/B9/total math is internally consistent on all 5 teams (e.g. Team 1: −8 / −1 / −9; Team 5: −3 / −4 / −7; Team 2: −2 / E / −2). 1st place header bg `rgb(250,248,240)` (`#faf8f0`); 1st place rank badge `rgb(212,160,23)` (`#d4a017` gold); non-1st rank badge `rgb(4,44,83)` (`#042C53` navy); 1st place total color `rgb(21,128,61)` (under-par green `#15803d`); total text reads `"−9"` with Unicode minus. Status tag reads "FINAL".
  - Round 95 (Best Ball, complete, 1 team). Renders single Team 1 card with rank 1, gold badge, F9 −5 · B9 +1, total −4.
  - Team expand verified: clicking Team 1 chevron flips aria-expanded to "true", reveals 2 player rows ("Expand Ward C" + "Expand Wayne H").
  - Player expand verified: clicking Ward C reveals PlayerHoleGrid with 60 cells (2× 10-col × 3-row grids), correct hole numbers + par values + scores; no "Total N" line at the bottom (regex `/Total\s+\d/` returns false).
  - Multi-expand at both levels verified.
  - Zero console errors.
- `preview_screenshot` tool timed out at 30s twice — same browser-side flakiness as A1.6/A1.7 sessions. Accessibility-tree snapshot + computed-style queries via `preview_eval` cover all visual requirements.

**ROADMAP updated:**
- C4 / C5 / C6 → ✅ with 2026-05-17 PM2 date stamps and per-item notes.
- PR 3 banner line above the table marked shipped.
- Phase C exit-criteria line marked met.
- Top-of-file last-updated banner refreshed.
- New `May 17 (PM2)` session log entry appended above the `May 17 (PM)` A1.7 entry.

---

## Earlier today — 2026-05-17 PM (A1.7)

### A1.7 shipped

**New reusable component — `src/components/scorecard/PlayerHoleGrid.tsx`** (extracted so C PR3 can drop it into the post-round drill-in summary unchanged):

- Props: `scores: (number|null)[]` (18 entries), `par: number[]` (18 entries), `currentHoleIndex?: number` (0–17, omit to disable highlight — C PR3 will), `showRunningTotal?: boolean` (defaults true — C PR3 will pass false to hide the bottom Total line).
- Two stacked 10-column grids (F9 holes 1–9 + F9 subtotal cell; B9 holes 10–18 + B9 subtotal cell) separated by a thin `#e2e8f0` divider.
- Each grid is 3 rows: hole-number header, par, gross score.
- Current hole gets `#dbeafe` background on header + score cells only (par row never highlighted).
- Unplayed holes render `—` in `#94a3b8`.
- Birdies (`score < par[i]`) render in `#3B6D11`.
- Bottom-right "Total N" line (or `—` if no holes played), hidden when `showRunningTotal={false}`.

**Scorecard wiring — `src/app/round/[id]/scorecard/page.tsx`:**

- New state `expandedPlayers: Set<number>` + `toggleExpandedPlayer(rpId)` helper. Multi-expand: tapping a row never collapses any other row.
- Each player row is now a `React.Fragment` with the existing card div + a conditional expanded panel below.
- Tap targets that toggle expand: (1) the left flex:1 section (name + meta info), (2) a new chevron-down `<button>` on the right after the +/− pair, with `aria-label="Expand hole-by-hole"` / `"Collapse hole-by-hole"` and `aria-expanded` for screen readers.
- Both expand triggers use `e.stopPropagation()` so they don't bubble to the card body, which still fires `toggleOverride` for best-N ball-counting tie-break. +/− buttons remain inside their existing `onClick={e => e.stopPropagation()}` wrapper — unchanged.
- Card border-radius flips to `16px 16px 0 0` when expanded so the panel attaches seamlessly.

**Confessed deviation from spec:** the name-span used to be the trigger for the Remove Player modal (`setRemovePlayerModal`). Per spec, "tapping player name" must now expand, so the old `onClick` is gone. To preserve the Remove flow (still needed — players occasionally get added to the wrong team), the Remove trigger moved into the expand panel as a small underlined `Remove from team` link at the bottom-right. Worth a heads-up to Dad in case he had memorized the name-tap shortcut. The flow itself (DangerModal → removePlayer) is unchanged.

**Tests — 11 new in `tests/components/PlayerHoleGrid.test.tsx`** using `react-dom/server`'s `renderToString` (non-DOM, no jsdom — STATUS.md flagged jsdom tests as flaky on master, so non-DOM is the safer source of truth). Coverage: unplayed em-dash count (21 cells: 18 score + F9 sub + B9 sub + Total = 21), played numerals render, birdie color presence when applicable, birdie color absence when no hole beats par, current-hole highlight count (exactly 2 cells: header + score), highlight omission when `currentHoleIndex` is undefined, Total line presence + sum, Total line hidden when `showRunningTotal={false}`, F9 / B9 labels render, F9 / B9 par subtotals computed correctly, subtotal reflects played-hole sum (not par-padded).

**Verification:** `tsc --noEmit` clean. **251/251 unit tests pass** across 25 files (240 prior + 11 new). Browser preview at iPhone SE (375 × 812) on live round 95: chevron renders + toggles expand state, left-section tap expands, multi-expand works (both rows expanded simultaneously), +/− buttons stay independent of expand tap target, clicking dot rail to hole 5 shifts the current-hole highlight to hole 5's column (2 highlighted cells — header + score), birdies render in `rgb(59, 109, 17)` = `#3B6D11`. No console errors. Preview screenshot tool timed out repeatedly (browser-side issue, not the change); structural verification via `preview_eval` against `aria-expanded` + DOM queries covered all spec requirements.

**Out of scope per spec (confessed):** team pill (A1.6 surface), summary page, leaderboard — all untouched. The existing card-body click-to-override flow (best-N ball-counting tie-break) is preserved untouched.

**ROADMAP updated:** A1.7 → ✅, Phase A.1 exit-criteria line reads "fully closed," top-of-file last-updated banner refreshed, new May 17 (PM) session log entry appended above the A1.6 entry.

---

## Earlier today — 2026-05-17 (A1.6, sibling session)

### A1.6 shipped (commit `0639b57`)

Added a 13px cumulative-net row below the existing big delta on the navy team-net pill in `src/app/round/[id]/scorecard/page.tsx`. Format: **"F9 [val] · B9 [val] · Tot [val]"** with middle-dot separators, labels at opacity 0.65, values bold (weight 500) in white. Headline delta untouched per spec.

- **New helper `getTeamNetDeltaForHoles(holeNumbers: number[]): number | null`** walks `buildRoundInput("net").perHole`, filters to the supplied range, and sums `teamScore − (par × contributingPlayerIds.length)` per hole for best-N. Returns `null` when no hole in range has a team score → row renders "—" for that leg. Stableford collapses to absolute points by the C3 convention (`teamParAtScored == 0` for non-best-N), so `formatTeamTotal` renders "X pts" automatically.
- **Constants `F9_HOLES`, `B9_HOLES`, `ALL_HOLES`** hoisted to module scope so they aren't reallocated each render.
- **Tot equals `teamNet − teamPar`** from the headline by design (Nassau payouts settle each leg separately, so showing all three at once is intentional).
- **Out of scope per spec:** player rows, summary page, leaderboard — all untouched.

**Verification:** `tsc --noEmit` clean (no `src/` errors). **240/240 unit tests pass** across 24 files. Browser preview at iPhone SE (375 × 812) on live round 95 (Best Ball, complete) rendered "TEAM NET −5" headline plus "F9 −6 · B9 +1 · Tot −5" row on one line — no wrap, no console errors. Tot matches the headline (−6 + +1 = −5).

**Infra note:** test deps `@testing-library/jest-dom`, `@testing-library/react`, `jsdom` were missing from `node_modules` at session start; `npm install` re-hydrated them. Pre-existing drift, not caused by this change.

ROADMAP updated: A1.6 → ✅, Phase A.1 exit-criteria line updated to reflect A1.6 shipped, May 17 session log entry appended.

---

## Previous session — 2026-05-13 end-of-day summary

Four threads, in the order they shipped:

### 1. Sentry phase 1 (error tracking plumbing)

`@sentry/nextjs` 10.53.1 installed via the wizard. DSN read from `process.env.NEXT_PUBLIC_SENTRY_DSN` in all three configs (`sentry.client.config.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts` — wizard initially hardcoded the literal DSN; corrected). Tracing at sample rate 1; session replay disabled; source-map upload via `SENTRY_AUTH_TOKEN` in Vercel. Verified locally — envelopes POSTed to `ingest.us.sentry.io` with the correct project id; example page + API route deleted after.

Phase 1 plumbing only — no custom instrumentation at install time. Custom emissions came online with Bug 1 / Option 3 (item 4 below), which is the first feature to actually use it. Commits: `47cebc9` (install) + `8042500` (status note).

### 2. Bug 2 dot-rail CSS mitigation

The scorecard's hole-dot navigation rail was suspected of mis-firing `setCurrentHole` when the user scrolled it horizontally (iOS Safari interpreting a touch-and-drag as a tap on whichever dot the touch started). Phase 2 audit confirmed the surface was vulnerable: no `touch-action`, no movement-threshold, 35×35 px dots below WCAG 2.1 AA's 44 px minimum.

Fix (commit `5729e2f`): `touchAction: "pan-x"` on the rail tells Safari the container is horizontally pannable so tap is suppressed on X-movement; `touchAction: "manipulation"` on each dot removes the 300 ms tap delay and double-tap-zoom interpretation; targets bumped 35×35 → 44×44.

**Status: mitigated, not confirmed-fixed.** Live testing has not yet ruled out a residual snap-back from another source. JS movement-threshold guard remains queued as a follow-up if user testing surfaces continued snap-back.

### 3. Bugs 3 + 4 — May 11 duplicate-rounds fix

Investigation (logged in detail in the May 11 fix commit message and ROADMAP session log) walked the chain: round 90 (3 teams, fully scored) and round 91 (2 teams, fully scored, created 31 min later) coexisted for `played_on = '2026-05-11'`. Score-timestamp triangulation invalidated the round-complete-then-stale-tab hypothesis — round 90's `is_complete` didn't flip until ~6:46 PM PT, 8+ hours after round 91 was minted. Revised cause: admin RoundSetup race against initial `loadRoundForDate`, or stale `/round/new` tab.

Three migrations applied to prod via Supabase MCP, in order:
- `005_fix_may11_duplicate_rounds_cleanup.sql` — reparents round 91's `round_players` onto round 90 with team_number shifted by +3 (round 91 T1 → round 90 T4, T2 → T5), then deletes round 91. Idempotent `DO` block raises if post-merge counts don't match expected 10 / 5 / 180 (round_players / teams / scores).
- `006_rounds_played_on_unique.sql` — adds `UNIQUE (played_on)` constraint on `rounds`. Must run after 005 since cleanup removes the only pre-existing duplicate.
- `007_rounds_updated_at.sql` — adds `rounds.updated_at` column + BEFORE UPDATE trigger so future Edit-Teams races leave a write-time signature for debugging.

Code path fix (commit `df0ee7b`): admin `ensureRoundShell` and `/round/new createRound` both use find-or-create with 23505 unique-violation fallback. New `initialLoading` state gates the format strip buttons during the load window. Dropped the stale `is_complete = false` filter from `/round/new`'s existing-round lookup.

### 4. Bug 1 — Option 3 write queue (Phases A through E)

The big one. Closes Bug 1 (scores reverting to par) for every reproducible mechanism: write failures mid-flight, tab eviction during write, offline-on-remount, end-of-round recovery, and multi-session recovery. Five PRs landed back-to-back via rebase-merge; design doc (`docs/option-3-write-queue-design.md`, commit `59ec72c`) captures all 14 locked decisions D1–D14.

| Phase | Commit | What shipped |
| --- | --- | --- |
| **A** | `08ecdce` | `setScore` switched from SELECT-then-INSERT/UPDATE to a single `.upsert(..., { onConflict: "round_player_id,hole_number" })`. One round-trip, idempotent under retry. Phase 2's audit had reported no unique constraint on `(round_player_id, hole_number)`; Phase A implementation surfaced that `scores_round_player_id_hole_number_key` was already in place (predates `supabase/migrations/`, missed because `list_tables` doesn't surface unique constraints). Net schema delta zero — the temporary index I added in error during Phase A was reverted in the same session. |
| **B** | `116801f` | `src/lib/writeQueue/` — durable `WriteQueue` class + `localStorage`-backed storage + backoff helper. Implements D1–D14. Not yet imported by anything; this PR was scaffolding-only with full unit test coverage. |
| **C** | `cc0d773` | Wires the queue into the scorecard. `setScore` now enqueues instead of awaiting. `load()` drains the queue *before* rehydrating from the DB, then overlays any still-pending or in-flight items onto `scoreMap` so the optimistic state survives offline-on-remount. Production `instance.ts` singleton wraps `@sentry/nextjs` as the reporter. |
| **D** | `76e1a8b` | End-Round reconciliation flow. Tap "Finish Round" → DangerModal confirm → spinner ("Finishing up…") → hail-mary `drain({ ignoreBackoff: true })` → 30 s timeout with "Skip and finish" surfacing at 15 s → if items remain, first-attempt dialog (`Retry sync` / `Skip and finish`); if retry fails, second-attempt dialog (`Try Again` / `Copy details` / `Finish anyway`). New `markAsTerminal(ids, reason)` API on the queue. Bug fix in `drainLoop`: track an `attemptedInThisPass` set so hail-mary mode doesn't loop forever on a persistently-failing item. |
| **E** | `668da1e` | Stale-failure prompt on homepage mount. Surfaces if the queue has terminal items from a prior session. Buttons: `Retry`, `View details` (toggles inline round-date), `Forget` (routes through DangerModal → `queue.forget(ids, "user_forget_stale")` with Sentry log per D14). Dismissal (overlay click / Escape) sets `sessionStorage` key `gobs:stale-failure-dismissed` to suppress for the current tab session. Multi-round-grouped clipboard formatter for second-attempt `Copy details`. |

Sentry instrumentation per D14 now live for: terminal failures (with `reason` discriminator — `classified_terminal`, `stuck_too_long`, `end_round_timeout`, `end_round_retry_timeout`, `stale_failure_retry_timeout`), storage evictions, drain crashes, queue-size threshold (≥100), and `user_forget_stale` events. No routine ops logged. Telemetry will tell us whether the queue's failure paths are firing in practice.

---

## Bug status

| Bug | Status |
| --- | --- |
| **Bug 1 — scores reverting to par.** Originally LT2 in the roadmap. | **✅ Resolved.** Option 3 phases A–E. Telemetry will surface any residual occurrences. |
| **Bug 2 — hole snap-back.** | **Mitigated, not confirmed fixed.** CSS fix shipped. JS movement-threshold guard queued if user testing surfaces continued snap-back. |
| **Bug 3 — duplicate `rounds` rows for one `played_on`.** | **✅ Resolved.** May 11 cleanup migration + `UNIQUE (played_on)` constraint. |
| **Bug 4 — admin / `/round/new` race minting duplicates.** | **✅ Resolved.** Find-or-create with 23505 unique-violation fallback in both insert paths. |
| **LT1 — Course Handicap display mismatch on scorecard.** | 📋 still open. Self-healing recompute shipped earlier (`a779ced`). Untouched today. Verification across a full live round still pending. |

---

## Open / unmerged branches — reality check

| Branch | Ahead of master | Status |
| --- | --- | --- |
| `origin/phase-a1-team-pill-segments` | 1 commit (`3afe566`) | A1.6 Step 1 static team-pill mockup. Awaiting visual review; do not merge. Step 2 (engine wiring) starts only after the look is approved. |
| `origin/lt2-repro` | 2 commits | LT2-now-resolved instrumentation branch. Safe to delete whenever Jonathan wants — kept for a day or two as reference per his instruction. |
| `origin/fix/may11-duplicate-rounds` | — | Merged. May still exist as a stale remote ref if the `--delete-branch` cleanup failed during merge; if so, delete with `git push origin --delete fix/may11-duplicate-rounds`. |
| Option 3 phase branches (`option3-phase-a` through `-e`) | — | All rebase-merged and deleted on origin during this session. |

---

## Master branch state

- HEAD commit (pre-STATUS-update): `23d7379` — style(scorecard): clarify hole/par/gross visual hierarchy. The trailing STATUS.md / ROADMAP commit will move HEAD forward by one.
- Status vs production deployment: **in sync** through P3 (`23d7379`) after the push. Each commit auto-deploys to Vercel.
- Schema state: Track A migrations 005 / 006 / 007 applied; Option 3 + PR 3 + PM3 + PM4 + PM5 added no net schema delta. Round 90 holds 10 players across 5 teams (T1–T5) with 180 scores; `rounds.played_on` is UNIQUE; `rounds.updated_at` is auto-maintained.

## Last commits on master

- `23d7379` — style(scorecard): clarify hole/par/gross visual hierarchy (P3, 2026-05-17 PM5)
- `00a54c3` — feat(scorecard): add traditional notation marks to score cells (P2, 2026-05-17 PM5)
- `370c7df` — feat(scorecard): remove redundant Tot from team pill (P1, 2026-05-17 PM5)
- `cce58d9` — refactor(round-results): extract shared RoundResultsView + use on /leaderboard (2026-05-17 PM4)
- `d4cc29a` — feat(summary): restore Individual Rankings cross-team section (2026-05-17 PM3)
- `d322a30` — feat(summary): Phase C PR 3 — ranked all-teams summary with F9/B9 + two-level drill-down (2026-05-17 PM2)
- `34699b2` — feat(scorecard): A1.7 — tap-to-expand hole-by-hole player rows (2026-05-17 PM)
- `0639b57` — feat(scorecard): A1.6 — F9/B9/Tot cumulative net on team pill (2026-05-17)
- `03828ff` — chore: STATUS.md — Option 3 phases A–E + Bug 1 resolution (2026-05-13)
- `668da1e` — feat(homepage): stale-failure prompt (Phase E of Option 3) (2026-05-13)
- `76e1a8b` — feat(scorecard): End-Round reconciliation flow (Phase D of Option 3) (2026-05-13)
- `cc0d773` — feat(scorecard): wire WriteQueue (Phase C of Option 3) (2026-05-13)
- `116801f` — feat(writeQueue): durable retrying write queue (Phase B scaffolding) (2026-05-13)
- `08ecdce` — refactor(scorecard): setScore → single upsert (Phase A of Option 3) (2026-05-13)
- `59ec72c` — docs: Option 3 write-queue design (Step 2 — decisions locked) (2026-05-13)
- `1155214` — chore: STATUS.md — May 11 duplicate-rounds fix + Bug 2 mitigation merged (2026-05-13)
- `df0ee7b` — fix(rounds): prevent duplicate rounds per played_on (May 11 fix) (2026-05-13)
- `ec7a614` — test: scorecard component tests for Bug 1 / Bug 2 repro (2026-05-13)
- `5729e2f` — fix: dot rail touch-action + tap target size for Bug 2 mitigation (2026-05-13)
- `8042500` — chore: STATUS.md — note Sentry phase 1 installation (2026-05-13)
- `47cebc9` — chore: install Sentry error tracking (phase 1 plumbing) (2026-05-13)

## Test surface on master

- vitest: **259/259 pass** across 25 files. Verified fresh at session end (8 new `PlayerHoleGrid` notation-mark tests added in P2).
- `tsc --noEmit` clean.
- Component test infra: `tests/components/fake-supabase.ts` (chainable in-memory client supporting `.upsert`, `.or` no-op, `failWrite` hook, `writeDelayMs`, writes log). Used by `scorecard-bug-repro.test.tsx`, `end-round-flow.test.tsx`, `stale-failure-homepage.test.tsx`, `ReconciliationDialog.test.tsx`, `StaleFailureDialog.test.tsx`, `stuckItemsClipboard.test.ts`.
- Library unit tests: `tests/lib/writeQueue/{backoff,storage,WriteQueue}.test.ts` cover the locked D7 backoff schedule, quota eviction order, `markAsTerminal` / `retryTerminal` / `forget` semantics, hail-mary drain, online / offline / visibility / pageshow triggers, and `in_flight` resurrection on mount.

---

## Next-session priorities

1. **LT1 verification under live-round conditions.** Self-healing recompute is shipped but never confirmed end-to-end. Edit a player's HI mid-round, open the scorecard, check that the row CH, stroke-allocation dots, and engine all read the corrected value.
2. **Option 3 telemetry review.** After a full live round on production, check Sentry for `writeQueue.terminal_failure` events. Each one tells us whether the queue's failure path is firing in practice or whether everything drains via the happy path. Also watch for `user_forget_stale` — every one indicates a user abandoning scoring data.
3. **Bug 2 — confirm fixed or queue follow-up.** After a live round on production, ask whether anyone has experienced snap-back. If yes, the JS movement-threshold guard is the queued follow-up; if no, mark Bug 2 confirmed-fixed.
4. **I13 — admin UI to edit `players.preferred_tee_id`.** Bumped earlier from regular 📋. Roster has two Waynes (`id=45 Hashimoto` and `id=55 Vincent`); only Vincent has `preferred_tee_id` set. Setting Hashimoto's via direct SQL carries real risk of editing the wrong row.
5. **Phase D.1 — Blind Draw.** Phase C is now closed. Per the May 9 reprioritization, Blind Draw is the next active priority ahead of more leaderboard / summary polish. See ROADMAP D.1 (D1.1–D1.6) — needs decision input from Dad on the randomizer trigger UX before code starts.

---

## Active blockers / paused work

- **LT1 (Course Handicap display mismatch):** 📋. Self-healing recompute shipped earlier (`a779ced`). Verification across a full live round still pending. **Next-session priority #1.**
- **TD15 (deactivate-while-rostered) and I13 (admin preferred_tee_id UI)** still in ROADMAP. Neither blocks the next live round; I13 is queued for next-session.

---

*If this file is more than 24 hours stale relative to your session work, flag it in the next session as a problem and reconcile before doing other work.*
