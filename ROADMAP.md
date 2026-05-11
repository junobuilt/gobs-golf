# GOBS Golf — Feature Roadmap

*Last updated: May 10, 2026 — Phase A.1 PR 1 (A1.1–A1.5, TD7/TD10/TD11/TD13) merged to master and verified live; LT2 not reproducible across 3 triage variants 2026-05-10, A1.6/A1.7 unblocked.*

---

## How to use this file

**Statuses**

- ✅ **Shipped** — live and working
- 🔨 **In Progress** — actively being built
- 📋 **Ready to Build** — spec is locked, can start anytime
- ❓ **Blocked** — needs info from Dad or a decision

**Phases are ordered by dependency.** Phase A unblocks Phase B, etc. Items within a phase can usually be built in parallel.

**Active priority order (post-May 9, 2026):** Phase 0.5 → Phase A.1 → Phase D.1 → Phase H.2 → Phase C PR 3 → Phase E onward. Phases are listed below in dependency order, but next-up work follows this priority list. Reset by the May 8 first-live-course test and May 9 admin consultation.

**One source of truth.** The companion document `GOBS_Game_Rules_v1.docx` defines all scoring logic. This roadmap covers what to build; that document covers how scoring works.

---

## Phase 0.5 — Live-Test Critical Fixes

*Surfaced from the May 8 first-live-course test. Both items block real-round use. Ships before any other Phase work.*

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| LT1 | Course Handicap display mismatch on scorecard | 📋 | DB calculates correct CH per tee (verified live: Kevin 12.5 HI → 9 CH white/yellow; Wayne 20.1 → 17). Scorecard displays wrong value (6 and 14 respectively). Stroke-allocation dots use the same wrong number. Likely stale snapshot on `round_players.course_handicap` (captured at round-creation time, before Dad corrected HI values in admin) or wrong tee_id in the join. Must fix end-to-end: row CH display, dots logic, engine calls — all read from the same corrected source. |
| LT2 | Scores reverting to par on hole navigation | 📋 | Reproduced live by two independent testers in same round. Enter score, navigate to a later hole, return — score shows par. Suspect A6 first-tap-lands-on-par regression: hole-component re-mount may treat saved score as null and re-trigger the par-anchor on display. Investigation: hydrate-before-render check on hole nav; git blame May 7 PM A6 change. **2026-05-10 triage:** ran 3 variants on iPhone with Web Inspector (lt2-repro branch, instrumentation live). Variant A (single player, in-app Back), Variant A2 (alternate nav method), and Variant B (3 players, 12 steps including rapid nav stress) all CLEAN — no score reversion, no phantom setScore on nav, cumulative pill correct throughout. Of the 3 candidate mechanisms, score-overwrite and dual-bug-cumulative+persistence are ruled out for these scenarios. Remaining theory: Dad in-the-moment misread during live round, or a condition not yet hit (specific format / team size / network race). Paused pending observation in next live round with instrumentation still deployed. A1.6/A1.7 unblocked — score-entry surface no longer treated as paused. |

**Phase 0.5 exit criteria:** Both bugs unreproducible in a back-to-back live round. CH on the scorecard matches the DB for every player. Scores persist across hole navigation for all players. Vercel preview deployed for Dad to verify on his phone before merging to master.

---

## Phase A — Bug Fixes & Scorecard UI Cleanup

*Low-risk, high-value. Do this first to give the league a better-feeling app while bigger work is being designed.*

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| A1 | Remove duplicate team gross/net at bottom of scorecard | ✅ | Keep only the top scorecard pill. Drop gross from the top pill entirely; show only net. |
| A2 | Score format: big number + small `(+/−N)` | ✅ | Big number = team net score, parenthetical delta to the right |
| A3 | Remove duplicate "Hole 1" indicator | ✅ | Hole label appears once, not twice |
| A4 | Rename "CH" / "HC" / "HCP" → "Strokes" | ✅ | Apply across scorecard, player tab, profile, admin players tab |
| A5 | Show handicap strokes as dots | ✅ | One dot per stroke that player gets on current hole, above +/− buttons. No number, dots only. |
| A6 | Default scorecard value = dash, anchored to par | ✅ | Display starts as `—`. First +/− tap lands on par for the hole; subsequent taps increment/decrement normally. Database stores nothing until tap. |
| A7 | Bug: admin-created scorecards not showing player names | ✅ | Currently in production. Fix in next code push. |
| A8 | Keep gross score on round summary + history detail pages | ✅ | Drop from scorecard pill only; preserve elsewhere for "I'm curious" lookups |
| A9 | Hide BALL / Tied badges + override hint in Stableford-family formats | ✅ | Best-N "BALL 1"/"BALL 2"/"Tied" pills, the tied-for-Ball banner, and the "tap a card to override which balls count" footer only show in best-N formats (2-Ball, 3-Ball; Best Ball is best-1 and gets a single-ball UX in Phase A.1 / A1.4). In Stableford Standard / GOBS Stableford every player's score contributes, so those affordances are misleading and now hidden. (Stableford Modified / GOBS House dropped 2026-05-09; gating logic in code rewires under A1.3.) |

**Phase A exit criteria:** Scorecard reads cleaner, no duplicate displays, "Strokes" terminology consistent everywhere.

---

## Phase A.1 — Pre-Monday Stableford & Format Cleanup

*Targeted at the next round (Monday May 11). Numbering re-aligned 2026-05-10 to match the PR chunk plan that bundled rename + new tables + editable UI together. Ships after Phase 0.5. Two scorecard polish items (A1.6/A1.7) deferred to a follow-up PR — they sit on the live score-entry surface that's paused while LT2 is reproduced.*

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| A1.1 | Rename `stableford_modified` → `gobs_stableford` + new league point tables | ✅ | Engine enum rename, dispatcher branch rename, FORMAT_LABELS / FORMAT_ORDER / DEFAULT_FORMAT_CONFIG, scorecard/summary gates, FormatPicker STABLEFORD_FORMATS, leaderboard rank STABLEFORD_FORMATS. New locked point tables (see Decisions Locked). `getStablefordPoints` confirmed correct (delta ≥ +2 collapses to DB+ bucket — `engine.ts` final return). Migration `003_phase_a1_format_set_rebalance.sql` updates the CHECK constraint and renames any rows (none in prod). |
| A1.2 | Add Best Ball as a new format | ✅ | New enum value `best_ball`. Engine dispatcher → `computeBestNHole` with N=1 via `defaultBestN("best_ball") === 1`. Strict best-1 net per hole regardless of team size. Net-only — net/gross toggle disabled in FormatPicker with caption "Best Ball is always net" and a `useEffect` that force-flips local state to "net" any time `best_ball` is selected (defense against stale gross choice). Best Ball IS a best-N family format → override holes apply normally (not a no-op). `isBestNFormat` in scorecard now includes `best_ball`. New unit tests in `engine-best-ball.test.ts` + new `snapshot-b6` script. |
| A1.3 | Move format picker into admin Round Setup tab + decouple from scorecard unlock | ✅ | The decoupling already held in code: `FormatNotSetBanner` shows on `/thomas-admin` Round Setup tab whenever `roundNeedsFormat(round) === true`, team-build flow does not gate on format, `FormatChip` on `/thomas-admin` handles post-lock edits via the existing `DangerModal` flow inside `FormatPicker.handleSaveClick`. Scorecard page still shows `ScorecardLockNotice` when `roundFormat == null` so the +/− entry surface remains gated (LT2-paused zone — minimal change). State machine: format choice and scorecard unlock now read as decoupled — admins can build teams pre-format; the scorecard view holds the "waiting" notice until format is set. |
| A1.4 | Drop GOBS House | ✅ | Removed `gobs_house` from `Format` enum, `GOBS_HOUSE_POINTS` constant, dispatcher branch, `FORMAT_ORDER`, `FORMAT_LABELS`, `DEFAULT_FORMAT_CONFIG`, FormatPicker `STABLEFORD_FORMATS`, leaderboard rank `STABLEFORD_FORMATS`, summary Stableford gate, all tests (engine-stableford, engine-overrides, rank, helpers, copy), and snapshots b4 Part 4 + b5 Part 3. Migration drops it from the CHECK constraint. Pre-migration check confirmed zero `gobs_house` rounds in production (2026-05-10). |
| A1.5 | Editable point-values UI for GOBS Stableford | ✅ | New section in `FormatPicker.tsx` that renders only when `selectedFormat === "gobs_stableford"`. Six rows — Albatross / Eagle / Birdie / Par / Bogey / Double Bogey or worse — each with a numeric input prefixed by the GOBS default. Values clamped to [−10, +10] to prevent typo blow-ups. "Reset to defaults" link below the rows. Stableford Standard section does NOT render — Standard's table is locked at the constant. Saved values land in `format_config.point_values`, which the engine already reads via `mergePointTable(GOBS_STABLEFORD_POINTS, …)`. Mid-round edits route through the existing FormatPicker DangerModal (already wired for any `format_config` change post-lock). Resolves TD7. |
| A1.6 | F9 / B9 / Total on scorecard team-net pill | 📋 | Three cumulative-net numbers on the big blue team pill (F9, B9, Total). Simple numbers, no per-hole breakdown. Drives Nassau bet payouts for the league. Layout test required at iPhone SE width (375px) — pill currently shows a single delta and the three-number layout will be tight. Deferred to follow-up PR; touches live score-entry surface that's paused for LT2 repro. Unblocked 2026-05-10 — LT2 triage clean across 3 variants; score-entry surface no longer paused. |
| A1.7 | Tap player row → expand hole-by-hole on scorecard | 📋 | On the scorecard, tap player row to reveal that player's gross scores per hole, plus F9 row + B9 row with F9/B9 totals. Same data shape as Phase C drill-in (C4/C5/C6); helper code can be shared. Distinct surface from C4/C5/C6 though — this is the live scorecard, those are the post-round/leaderboard summary. Deferred with A1.6. Unblocked 2026-05-10 — LT2 triage clean across 3 variants; score-entry surface no longer paused. |

**Phase A.1 exit criteria:** GOBS Stableford selectable with editable per-round point values. Stableford Standard scoring correctly under new locked table. Best Ball selectable, net-locked. Format pickable from Round Setup tab (already). GOBS House fully removed from codebase, enum, UI, tests, and snapshots. All snapshots clean; `tsc --noEmit` clean. A1.6 / A1.7 deferred to a later PR. ✅ for everything except A1.6 / A1.7.

---

## Phase B — Game Format Engine

*The foundation. Phase C (Leaderboard), D (Blind Draw), and F (History) all depend on this.*

> **Phase B is fully shipped.** Math layer (5 formats — 2-Ball, 3-Ball, Best Ball, Stableford Standard, GOBS Stableford — plus override engine, 164 unit tests, 5 snapshots), database foundation (B4.1–B4.5 ✅), format gate (B1.1–B1.6 ✅), and override / scoring-basis admin UI (B3.1–B3.3 ✅). Phase C status tracked in its own section below.

### B.1 — Format gate & state machine

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| B1.1 | Round state machine | ✅ | States: No Round → Setup → Teams Built → **Format Chosen** → Scorecards Unlocked → Scoring → Complete |
| B1.2 | "Format not set" home banner (admin view) | ✅ | Yellow banner when round needs format. "Choose Format" CTA opens picker. |
| B1.3 | Scorecards locked until format chosen | ✅ | Players can build teams pre-format, but scorecard +/− buttons disabled until format locks. Polite "Waiting for admin to pick today's format" banner. |
| B1.4 | Format picker UI | ✅ | Bottom sheet on mobile, modal on desktop. Five format choices. |
| B1.5 | No defaults, no persistence | ✅ | Every round starts blank. Forces fresh choice. |
| B1.6 | Format locks at first score | ✅ | Once any team enters a hole-1 score, format is read-only. Editing requires dangerous-action modal that warns about score recalculation. |

### B.2 — The five formats

*Format set rebalanced 2026-05-09 + 2026-05-10. GOBS House dropped (A1.4); `stableford_modified` renamed to `gobs_stableford` and now defaults to the locked league table (A1.1). Best Ball added (A1.2).*

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| B2.1 | 2-Ball | ✅ | Existing logic. Best 2 net per hole. |
| B2.2 | 3-Ball | ✅ | Best 3 net per hole. 4-player teams drop worst; 3-player teams all count. |
| B2.3 | Stableford Standard | ✅ | Net-based locked table (2026-05-10): Bogey 1, Par 2, Birdie 3, Eagle 5, Albatross 8, Double Bogey or worse 0. Table NOT editable per round — values are constants in `engine.ts`. Team total = sum across all members. |
| B2.4 | GOBS Stableford | ✅ | New format (Phase A.1 / A1.1, renamed from `stableford_modified`). League-specific default table (2026-05-10): Albatross +8, Eagle +5, Birdie +3, Par +2, Bogey 0, Double Bogey or worse −1. Net-based, sum across all members. Negative team totals possible. Point values are **editable per round** via the FormatPicker UI (A1.5) — overrides land in `format_config.point_values` and the engine merges them via `mergePointTable(GOBS_STABLEFORD_POINTS, …)`. |
| B2.5 | Best Ball | ✅ | New format (Phase A.1 / A1.2). Strict best-1 net per hole regardless of team size (2/3/4 players). Net only — net/gross toggle disabled in picker with caption "Best Ball is always net." Best-N family format → override holes apply normally (override = all scores count on that hole). |

### B.3 — Per-hole overrides

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| B3.1 | "All scores count" hole multi-select | ✅ | 18-button grid (6×3) inside the FormatPicker, plus "9 & 18" preset and "Clear all" utility. Stored at `format_config.override_holes`. Engine applies overrides to 2-Ball, 3-Ball, and Best Ball (all best-N family). Stableford Standard / GOBS Stableford are documented no-ops (every player already contributes). Picker section renders muted with an inline "(no effect on Stableford formats)" caption when a Stableford format is selected. |
| B3.2 | Net vs gross toggle | ✅ | Segmented control inside FormatPicker, stored at `format_config.scoring_basis` ("net" \| "gross"). Default "net" via `getScoringBasis()` helper for backward compat with pre-B3.2 rounds. Engine integration uses the zero-handicap trick at the call sites (scorecard + summary): when scoring_basis is "gross", every `courseHandicap` is passed as 0 so the engine's net pathway returns gross-equivalent values uniformly across all formats — Stableford included, since it has no internal `basis` branch. |
| B3.3 | Override visibility on scorecard | ✅ | Soft yellow banner ("All scores count on this hole") rendered between the "Hole N / PAR / YDS" header and the team net pill when the active hole is in `format_config.override_holes`. Visible to all users. Banner is gated on best-N formats since override_holes is an engine no-op for Stableford. |

### B.4 — Database changes

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| B4.1 | Add `format` column to rounds table | ✅ | Enum after 2026-05-10 rebalance: `2_ball`, `3_ball`, `best_ball`, `stableford_standard`, `gobs_stableford`. Original enum (B-phase ship): `2_ball`, `3_ball`, `stableford_standard`, `stableford_modified`, `gobs_house`. Migration `003_phase_a1_format_set_rebalance.sql` handles the swap (drop `gobs_house`, rename `stableford_modified` → `gobs_stableford`, add `best_ball`). |
| B4.2 | Add `format_config` JSON column | ✅ | Stores point values, override holes, net/gross |
| B4.3 | Add `format_locked_at` timestamp | ✅ | Records when first score was entered |
| B4.4 | Backfill existing rounds as `2_ball` | ✅ | One-time migration. Database is being cleared anyway, so trivial. |
| B4.5 | Update scoring engine to switch on format | ✅ | Single function takes (format, scores, handicaps, overrides) → team score. Each format is its own pure function. |

**Phase B exit criteria:** Admin can pick any of the 5 formats (2-Ball, 3-Ball, Best Ball, Stableford Standard, GOBS Stableford), scorecards behave correctly for each, scores calculate correctly, format is locked once scoring starts. Format set rebalanced 2026-05-09 — see Phase A.1.

---

## Phase C — Leaderboard Rework

*Depends on Phase B for format-aware display.*

> PR 1 (C3) ✅ shipped. PR 2 (C1+C2) ✅ shipped. PR 3 (C4+C5+C6) 📋 ready to build — drill-in summary with F9/B9/Total.

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| C1 | Team-only display during live rounds | ✅ | Existing season-individual leaderboard relocated to `/season` (verbatim, no refactor). New `/leaderboard` is a team-focused live view with four states (no round today / no format yet / live mid-round / completed). Empty state includes a small "View season stats →" link to `/season`. Bottom nav unchanged — still points to `/leaderboard`, now the team view. |
| C2 | Row format: team name + cumulative score + "thru N" | ✅ | Per-row: rank badge (gold for 1st, navy otherwise) → team name + dot-separated roster → score block (24px, color-coded: green under par / red over par / black even / blue Stableford points) → "thru N" (live) or "Final" (complete). Format-aware ranking via pure helper `src/lib/leaderboard/rank.ts` — ascending for best-N, descending for Stableford-family, ties share rank with the next position skipped. "thru N" = count of holes where every required team player has entered a score. Whole row taps through to `/round/[id]/summary` (PR 3 will rebuild that drill-in). |
| C3 | Format-aware score display | ✅ | Format-aware team total display via `formatTeamTotal` helper in `src/lib/format/copy.ts`. Best-N: stroke delta `+N` / `−N` / `E`. Stableford-family: `${total} pts` with Unicode minus on negative totals (originally GOBS House; post-2026-05-09 rebalance, GOBS Stableford carries the negative-going values via Phase A.1 / A1.2). Helper logic continues to handle Stableford-family negatives uniformly after format-set rebalance. Applied at scorecard team pill and round summary (Stableford branch only — best-N summary preserves existing absolute-total display; PR 3 will conform summary to delta convention). |
| C4 | Tap row → round summary view | 📋 | Read-only, anyone can view. Mirrors the round summary page. |
| C5 | Per-player dropdown in summary | 📋 | Click to expand individual hole-by-hole scores |
| C6 | Front 9 / Back 9 / Total 18 breakdown | 📋 | Standard golf split visible in summary |

**Phase C exit criteria:** Players check leaderboard mid-round, see clean team rankings, can drill into any team's detail without editing.

> **Phase C follow-up (resolved 2026-05-08):** the scorecard-pill (delta) vs round-summary (raw absolute) stroke convention split has a chosen direction. Resolved by PR 2 leaderboard convention (delta everywhere). Round summary will conform when PR 3 ships its drill-in rebuild.

---

## Phase D — Blind Draw

*Depends on Phase B. Touches scoring engine. Reprioritized ahead of Phase C PR 3 on 2026-05-09 — Dad: blind draw applies roughly every other round due to typical odd-player counts, needs real-round testing before more leaderboard polish.*

### D.1 — Blind draw

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| D1.1 | Short-team designator at round setup | 📋 | "Blind Draw — applies to [holes]" badge on team card |
| D1.2 | Mid-round dropout flow | 📋 | Admin marks player as "left at hole N." Their team plays remaining holes short. |
| D1.3 | Round-start short team flow | 📋 | Team built with fewer than full roster. Blind draw applies to all 18 holes. |
| D1.4 | Pending state on live leaderboard | 📋 | Short team visible with "Pending blind draw — score reveals at round end" label. No score until resolved. |
| D1.5 | Randomizer engine | 📋 | At round-end, randomly select a player from any other team. Copy their actual scores onto short team's missing slot for affected holes. |
| D1.6 | Multiple short teams | 📋 | Each gets independent draw. Logged note in case it becomes a problem (e.g., short team draws from another short team). |

**Phase D exit criteria:** Short teams handled gracefully on both ends, randomizer works.

(Phase D.2 / Rainout deleted 2026-05-09 — league rule: if play stops, no payouts, round doesn't count. No app-side partial-round handling needed. See Decisions Locked.)

---

## Phase E — Played-With Redesign

*Independent of B/C/D. Can run in parallel.*

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| E1 | Egocentric view (mobile + desktop primary) | 📋 | Pick a player, see four buckets: 6+ rounds (bars), 3–5 rounds (tags), 1–2 rounds (tags), Never played (red tags) |
| E2 | Improved sortable grid (desktop secondary) | 📋 | Linked from egocentric view as "Show full grid." 50×50 with color intensity, sort options (alphabetical, handicap, total rounds), gaps visually distinct |
| E3 | Tap any player/cell → detail | 📋 | Shows exact count and last round together |
| E4 | Last-played-together computed field | 📋 | New lookup against existing scores tables |
| E5 | Season scope filter | 📋 | All-time vs. this-season toggle. Affects query. |

**Phase E exit criteria:** Admin can answer "who has Bill played with?" in two taps on mobile, and "show me league-wide patterns" on desktop.

---

## Phase F — History & Betting Tab Split

*Mostly independent. Format-aware display in Phase B helps but isn't strictly required.*

### F.1 — History tab

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| F1.1 | Round summary line | 📋 | Date, format used, # teams, players per team, total players, winning team |
| F1.2 | Expanded view: full team breakdowns | 📋 | All teams, players, final scores, glanceable without click |
| F1.3 | Click round → full scorecards page | 📋 | Drill into past round, see every team's hole-by-hole, read-only |
| F1.4 | Click player row in scorecard → individual round detail | 📋 | Hole-by-hole for that player on that day |
| F1.5 | Date navigation | 📋 | Vertical list gets long across seasons. Need a date picker, season filter, or grouped-by-month view. |

### F.2 — Betting tab

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| F2.1 | Per-player season summary view | 📋 | Each row: player name, rounds played, cumulative won/lost, average per round |
| F2.2 | Click player → full per-round history | 📋 | Win/loss for each round they played that season |
| F2.3 | Persistent season totals header strip | 📋 | Total buy-in, HiO Fund balance, BFB Fund balance (donated YTD), total paid out |
| F2.4 | Per-round money breakdown | 📋 | Buy-in × players, HiO contribution, BFB contribution, pot, payouts |
| F2.5 | Buy-in snapshot per round | 📋 | Default $10, but stored on round (not global setting) so historical rounds preserve their amount even if defaults change later |
| F2.6 | Manual edits with dangerous-action modal | 📋 | Admin-only. Money disputes need fast resolution path. |
| F2.7 | Admin-only access | 📋 | Players don't see betting tab. Don't want it getting competitive. |
| F2.8 | BFB Fund visibility on home page | 📋 | Surface running BFB total on the home page so league sees the charity element. Annual donation drive is in July. Possible future addition: drive-specific tracking, contribution nudges. Added 2026-05-09. |

**Phase F exit criteria:** Dad can answer "how much has Bill won this season?" and "what's the BFB fund at?" without opening a spreadsheet.

---

## Phase G — Money / Payout Engine

*❓ Blocked on Dad's answers. Scaffold the data model and UI now; fill in the math when his answers come back.*

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| G1 | Buy-in records per round per player | 📋 | Default $10 each, configurable per round, mark "didn't buy in" for guests/late arrivals |
| G2 | Payout records per round | ❓ | Need: who wins, how much, how the pot splits |
| G3 | Fund balance computed views | 📋 | Running totals: HiO fund, BFB fund. Computed from contributions − payouts. |
| G4 | HiO Fund payout flow | 📋 | Manual button: "Pay out HiO Fund" creates payout record, resets fund. Logged for whenever a hole-in-one happens. |
| G5 | BFB Fund yearly donation flow | 📋 | At end of season, admin records donation. Resets fund. |
| G6 | Auto-calculate winnings from scores | ❓ | The end goal — scores in, money out. Blocked on team pot rules. |

**Phase G exit criteria:** Dad never has to manually calculate winnings. Money math is automatic and accurate to the dollar for end-of-season BFB donation.

---

## Phase H — Pre-Launch Hardening

*Stuff that's easy to forget but matters before going live full-time.*

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| H1 | Hide admin button from homepage | 📋 | URL `/admin` still accessible to those who know it. Cleaner UX, prevents players from poking admin buttons. |
| H2 | Database backup strategy | 📋 | Daily Supabase backups. Manual export option for end-of-season snapshot. **Treated as blocker for historical data import and full production use.** Severity bumped 2026-05-09 — Dad asked May 9 if he could enter all 2026 historical rounds; answer is no until backup + partial-reset workflow is in place. Should ship after Phase A.1 / Phase D.1, before Phase E. |
| H3 | Season open/close flow | 📋 | Admin manually closes season in Settings. Reminder banner appears as season-end approaches (Sept/Oct). Closes the BFB fund for donation. |
| H5 | Data import for 4 weeks of historical rounds | 📋 | Once Dad fills in the spreadsheet, import script reads it and writes to Supabase. One-time job. Gated on H2 partial-reset workflow. |
| H6 | QR code for current URL | 📋 | One-time deliverable. Regenerate when custom domain ships. Added 2026-05-09. |
| H7 | "Add to Home Screen" instructions doc | 📋 | Short numbered guide (iOS Safari Share → Add to Home Screen, Android Chrome equivalent). For Dad to forward to league. Doc deliverable, not code. Added 2026-05-09. |
| H8 | One-shot DB export for Dad's manual verification | 📋 | Export per-player handicap config, per-tee data, hole yardages as screenshots/CSV. Dad will manually verify end-to-end. Added 2026-05-09. |

(H4 — Partial round long-term decision — deleted 2026-05-09. Rainout-cancellation rule moots the decision. See Decisions Locked.)

**Phase H exit criteria:** Dad can switch to the app exclusively without fear of data loss. League can play indefinitely without intervention.

---

## Tech Debt & Follow-Ups

*Surfaced from session work but not tracked in the phase tables. Not phase-blocking.*

| # | Item | Status | Severity | Notes |
| --- | --- | --- | --- | --- |
| TD1 | A4-extended: leftover CH/HC/HCP labels | 📋 | Low | Strokes terminology not yet applied on leaderboard, round/new, summary pages, and admin RoundSetup tab. Phase A only covered scorecard, player tab, profile, admin players tab. |
| TD2 | Supabase array-vs-object pattern audit | 📋 | Medium | Same issue that broke A7 (admin scorecards not showing player names) likely affects History.tsx, scorecard/page.tsx, summary/page.tsx. Audit + fix all instances in one pass. |
| TD3 | RoundSetup useEffect dep on `allPlayers` | 📋 | Low | Parent re-creating the array re-runs `loadRoundForDate` unnecessarily. Minor perf, no correctness issue. |
| TD4 | `goToTeams` non-transactional delete-insert | 📋 | **High** | `round_players` does delete-then-insert without a transaction. Failed insert mid-flow loses all team assignments. Real data-loss risk — should be promoted to next sprint. |
| TD6 | Hardcoded `format: "2_ball"` in scorecard / summary engine calls | ✅ (resolved 2026-05-07) | Medium | `src/app/round/[id]/scorecard/page.tsx` (lines ~227, 287) and `src/app/round/[id]/summary/page.tsx` (lines ~144, 150) pass `format: "2_ball"` and a synthetic `formatConfig` to the scoring engine. Should read from `rounds.format` / `rounds.format_config`. Currently masked because the only shipped format is 2-Ball-equivalent at the engine level; will visibly diverge once admins start picking other formats. |
| TD7 | Editable point values UI for GOBS Stableford | ✅ (2026-05-10) | — | Originally scoped against Stableford Modified; recast 2026-05-10 when Modified was renamed to `gobs_stableford` (A1.1). Shipped under Phase A.1 / A1.5 — six editable rows in FormatPicker (Albatross / Eagle / Birdie / Par / Bogey / Double Bogey or worse), clamp [−10, +10], "Reset to defaults" link, persists to `format_config.point_values`, mid-round edits warn via the existing DangerModal flow. |
| TD8 | Banner button clipping on narrow phones (<414px) | 📋 | Medium | The "Choose Format" CTA inside `FormatNotSetBanner` is clipped at 375px (iPhone SE) and similar small-phone widths. Surfaced during B1.5 screenshot capture. League demographic includes older players on smaller/older phones, and the banner is the admin's primary entry point. Likely fix: stack banner contents vertically below ~414px, or shrink CTA padding. Visual-only change, no logic. |
| TD9 | Player-visible format display on scorecard | ✅ (resolved 2026-05-07) | Low-Medium | Read-only `FormatChip` rendered in the scorecard header (above "Hole N" / par-yardage caption) once a format is locked. Visible to all users, not admin-only. No `onChange` prop, so the chip is non-interactive on the player surface — admins still change format from the chip on `/thomas-admin`. |
| TD10 | Remove stale "2-ball" toggle in admin > Settings | ✅ (2026-05-10) | Low-Medium | Toggle + Scoring Card removed from `Settings.tsx`. `two_ball_scoring` removed from `ToggleKey` and from the seed defaults in `thomas-admin/page.tsx` (existing rows in `league_settings` are left untouched — UI just stops surfacing the key). No other v1 leftovers spotted in the Settings tab — "Coming Soon" placeholders for handicap rules / season range / payout structure remain as roadmap stubs. |
| TD11 | Snapshot scripts need format filter guard in live-data regression loop | ✅ (2026-05-10) | Medium | Added `if (round.format && round.format !== "2_ball") continue;` to the Part 1 loop in `snapshot-b2`, `snapshot-b3`, `snapshot-b4`, `snapshot-b5` and the new `snapshot-b6`. Synthetic Part 2/3/… cases unchanged. Any future non-2-Ball production round now skips the legacy 2-Ball comparator instead of producing false-positive mismatches. |
| TD12 | FormatPicker now requires explicit Save even for fresh rounds | 📋 | Low | Pre-B3.x flow was one-tap-and-save: admin tapped a format and the picker closed, committing immediately. Post-B3.x flow is two-step: admin taps a format → basis + override-holes sections render → admin taps Save. Justified by the new rules sections needing a confirmation step, but it's measurable friction for the common "just pick 2-Ball, defaults are fine" path. Watch for admin pushback in real-world use. Likely fix if it bothers users: add a "Quick Save" / "Save with defaults" affordance for fresh rounds (no `format_locked_at`, no existing config) so a single tap commits format + default config; the rules sections still appear for anyone who wants them. Don't pre-build — wait for actual feedback. |
| TD13 | `show_leaderboard` admin toggle now gates the wrong route | ✅ (2026-05-10) | Low | Settings UI label / description updated: "Show Season Stats" / "Visible on the season stats page (/season). Live leaderboard always visible." Underlying DB key left as `show_leaderboard` (per-user instruction to avoid the rename migration — flagged as a future cleanup if the column name ever becomes confusing). Gate still applies to `/season` only; `/leaderboard` was already publicly accessible. |
| TD14 | gitignore + tidy `.claude/settings.local.json` | 📋 | Low | File is currently tracked in git, but per Claude Code convention it should be a per-machine local override. Some entries also embed ad-hoc `curl` commands carrying the Supabase anon JWT — anon keys are public by design (they ship in `NEXT_PUBLIC_SUPABASE_ANON_KEY`), so this is repo hygiene, not a credentials leak. Fix when tackled: add to `.gitignore`, `git rm --cached`, and scrub the curl entries down to permission-pattern names if anyone still wants the precedents. |

---

## Phase I — Post-Launch / Nice-to-Haves

---

*Parking lot. None of these block launch. Revisit after a few months of real-world use.*

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| I1 | Player profile — round history accordion | ✅ (2026-05-10) | Collapsed by default. Tap to expand. Replaces auto-displayed history. Title shows rounds-played count when collapsed. |
| I2 | Player profile — Played With accordion | 📋 | Same pattern. Reuses Egocentric component from Phase E. |
| I3 | Player profile — season stats summary | ✅ (2026-05-10) | Rounds played, avg gross, avg net, best/worst, last-5 vs all-time comparison with trend label, inline SVG sparkline of all rounds, recent-5 scores list. |
| I4 | Player profile — performance chart | 💡 | Line chart of scores over time |
| I5 | Player profile — winnings/losses | 💡 | Deferred. Don't want it competitive. May add later if Dad asks. |
| I6 | Team recommendation engine | 💡 | Suggest balanced teams based on handicap spread + played-with history. **This is where pair-balance math lives, not in played-with view.** |
| I7 | Custom domain | 💡 | gobsgolf.com or similar |
| I8 | PWA install polish | 💡 | "Add to home screen" prompts |
| I9 | SWAT format | ❓ | Blocked. Need rules from Dad. |
| I10 | Combo tees | ❓ | Blocked. Need rules from Dad. |
| I11 | Generate Supabase TypeScript types | 💡 | Run `supabase gen types` CLI so query responses get column-shape type checking. Currently uses `any`, meaning tsc cannot catch column typos. Tooling-only change, no functional impact. Worth doing once schema stabilizes. |
| I12 | Players list — row-level accordion | 📋 | Tap row in `/players` to expand inline panel showing rounds, avg score, best, last round, and link to full profile. Stats lazy-loaded per player; uses complete rounds only. Distinct from I1-I3, which add accordions inside the profile page itself. Data layer (`fetchPlayerStats`) accepts an optional date-range filter so a season scope can be added later without rework. |

---

## Open Questions for Dad

*All collected in one place. As Dad reviews the rules document, his answers unblock items here.*

| # | Question | Blocks | Source |
| --- | --- | --- | --- |
| Q1 | "Use handicaps for first 8 holes" — what does this mean exactly? | Affects every round's net calc | Rules doc Section 2 |
| Q2 | Who wins the team pot? 1st place only or top 2? | G2, G6 | Rules doc Section 8 |
| Q3 | Gross or net for team pot winner? | G2, G6 | Rules doc Section 8 |
| Q4 | How does winning team split the pot? | G2 | Rules doc Section 8 |
| Q5 | Does the pot carry over on ties? | G2 | Rules doc Section 8 |
| Q6 | What happens to buy-in if player leaves mid-round? | G1 | Rules doc Section 8 |
| Q7 | Do guests buy in same as members? | G1 | Rules doc Section 8 |
| Q9 | Handicap data for 4 missing players (DeWaal S, Gary T, Gerry H, Norm C) | Phase A onwards | Players Reference sheet |
| Q10 | What does SWAT stand for? Rules? | I9 | Rules doc Section 10 |
| Q11 | What is a SWAT Scramble? | I9 | Rules doc Section 10 |
| Q12 | How do combo tees work? | I10 | Original feedback |

*(Q8 deleted 2026-05-09 — rainout cancellation rule moots partial-round handling. See Decisions Locked.)*

---

## Open Design / Technical Decisions

*Things we've parked but not lost.*

| # | Decision | Status |
| --- | --- | --- |
| D1 | Admin access protection — URL-only vs. real login | URL-only for now. PIN gate logged for future. |
| D2 | Default-to-par scorecard alternative | Logged. May revisit if dash interaction confuses players. |
| D3 | Pre-format-lock scoring (Option B) | Rejected. Logged in case Option A creates friction. |
| D4 | Multiple short teams in one round | Independent draws. Watch for edge cases. |
| D5 | Compare-two-players feature | Not in current scope. Logged. |
| D6 | Played-with season scope toggle | In Phase E. Default to "this season." |

---

## Decisions Locked

*Everything below is settled. Don't relitigate without explicit conversation.*

### Terminology

*Locked 2026-05-08, ahead of first live golf-course test. Supersedes the prior "Strokes terminology replaces CH/HC/HCP" decision from Phase A — that rename was a half-step; the bare "Strokes" label was ambiguous (it was being used for course_handicap on the scorecard but for handicap_index in the admin Players tab). Two distinct quantities, one label. Now disambiguated.*

- **Handicap Index (HI):** Player's portable rating, stored in the `handicap_index` column on `players`. Same value across all tees. WHS calculation; player attribute not round attribute.
- **Course Handicap (CH):** Slope-adjusted strokes received on a specific tee, stored in the `course_handicap` column of `round_players`. Round attribute, computed via `computeCourseHandicap` from the player's `handicap_index` plus the round's selected tee slope/rating/par. Recomputed on scorecard load (LT1 fix, 2026-05-09) so admin edits to HI flow through to the displayed CH without manual intervention; downstream consumers (summary, leaderboard, season) read the value the scorecard wrote back. (The earlier May 8 entry referenced a `player_course_handicaps` table — that table does not exist; `round_players.course_handicap` is the actual storage.)
- **Display rule:** UI never uses bare "Strokes" or "Handicap" alone. Always qualified as "Handicap Index" (or short "HI" where space is tight) or "Course Handicap" (or short "CH"). Database column names (`handicap_index`, `course_handicap`) are already correct and stay as-is.

### Other locked decisions

- **Format gate:** Admin must pick fresh every round. No defaults, no persistence between rounds. Forced choice prevents wrong-format scoring.
- **Format authority:** Admin only. Players cannot pick or change.
- **Scorecard pre-format:** Locked until format chosen. Display "Waiting for format" message.
- **Stat display drop:** Gross removed from scorecard top pill. Kept everywhere else.
- **Stroke-allocation dots:** On the per-hole entry surface, handicap strokes received on the current hole are shown as small navy dots above the +/− buttons. No numeric overlay alongside.
- **Default scorecard value:** Dash with par-anchored +/−. Database null until first tap.
- **Blind draw timing:** Resolves after round finalized, not at start.
- **Blind draw eligibility:** Random pick from any other team's player.
- **Blind draw drawn-player effect:** Original team unaffected; scores copied to short team only.
- **Rainout / partial rounds (locked 2026-05-09):** League rule — if play stops, no payouts, round doesn't count. No app-side partial-round handling. Supersedes the prior "9-hole minimum / sub-9 saved as partial" decision.
- **One format per day, league-wide:** Different foursomes don't play different formats simultaneously.
- **Money allocation:** $1 HiO + $2 BFB + $7 team pot (default $10 buy-in).
- **BFB:** Blaine Food Bank, donated yearly at season end.
- **History/Betting tab split:** Two tabs. History = game performance. Betting = financial.
- **Played-with primary view:** Egocentric (one player at a time) on mobile + desktop. Improved grid as desktop secondary.
- **Pair-level handicap balance:** Not a thing. Balance is team-level. Belongs in team recommendation engine (I6), not played-with.
- **Player money on profile:** Deferred. Don't want it competitive.
- **Admin button on homepage:** Hide for launch. URL `/admin` still works.

### Format set (locked 2026-05-10)

Five formats: **2-Ball, 3-Ball, Best Ball, Stableford Standard, GOBS Stableford**. GOBS House dropped from codebase, format enum, UI, tests, snapshots, and roadmap. `stableford_modified` renamed to `gobs_stableford` (same engine machinery, new defaults + UI). Migration `003_phase_a1_format_set_rebalance.sql`.

### Stableford point values (locked 2026-05-10)

Two distinct Stableford formats with separate point tables. *Standard's table is locked at the engine constant and intentionally has no admin UI. GOBS Stableford's defaults are editable per round via FormatPicker (A1.5) — overrides land in `format_config.point_values`.*

**Stableford Standard** (locked, NOT editable):
- Albatross: +8
- Eagle: +5
- Birdie: +3
- Par: +2
- Bogey: +1
- Double Bogey or worse: 0

**GOBS Stableford** (defaults, editable per-round):
- Albatross: +8
- Eagle: +5
- Birdie: +3
- Par: +2
- Bogey: 0
- Double Bogey or worse: −1

Implications: GOBS Stableford can produce negative team totals when many double-bogey-or-worse holes accumulate; leaderboard rank + `formatTeamTotal` handle negative `pts` via Unicode minus. `getStablefordPoints` collapses any net result of +2 or worse to the doubleBogeyOrWorse bucket (engine confirmed via `delta >= 2` final return).

### Best Ball format (locked 2026-05-09, override behavior clarified 2026-05-10)

- **Selection rule:** strict best-1 — exactly one player's score counts per hole, regardless of team size.
- **Scoring basis:** net only. Format's purpose is handicap equalization; gross best ball undermines the equalizer in a mixed-handicap league. Net/gross toggle disabled in the picker for this format and labeled "Best Ball is always net." FormatPicker also force-flips local state back to "net" any time Best Ball is selected so a stale "gross" choice can't slip through.
- **Override-holes:** apply normally. Best Ball is a best-N (N=1) family format, so an override turns the hole into "all scores count" exactly as it does for 2-Ball / 3-Ball.
- **Engine:** `computeBestNHole` with N=1 via `defaultBestN("best_ball") === 1`.

### Format selection entry point (locked 2026-05-09)

Format chosen by admin on the Round Setup tab, before any scorecard is built. The yellow "Waiting for format" banner remains for any team that builds a scorecard pre-format. Earlier flow (format-picker gated behind scorecard creation) deprecated. Implementation in Phase A.1 / A1.5.

### Non-paying player handling (locked 2026-05-09)

Players who opt out of betting are not put on a scorecard. Their team plays as a blind-draw team. No app-side toggle needed for "exclude from betting but keep scoring."

---

## Session Log

*High-level milestones for context.*

| Date | What got done |
| --- | --- |
| Apr 21 | Phase 0 — accounts, tools, deploy infrastructure |
| Apr 21–27 | Schema, seed data, core app with Gemini |
| Apr 27 (eve) | Tee/CH bugs, tap-to-select roster, team scoring, leaderboard, admin toggles, round summary |
| May 1 | Updated rosters, mobile redesign, dangerous-action pattern, played-with v1, history tab v1 |
| May 5 | Major feedback consolidation. Locked decisions on game format engine, blind draw, leaderboard rework, history/betting split, played-with redesign. Rules doc + historical data spreadsheet drafted. Roadmap rebuilt. Fixed A7 home-page team-card names — follow-up: same Supabase array-vs-object pattern likely affects History.tsx, scorecard/page.tsx, summary/page.tsx; needs its own ticket. Fixed navigation trap on empty/abandoned rounds in admin RoundSetup. Follow-up: RoundSetup useEffect dep on `allPlayers` reference re-runs `loadRoundForDate` unnecessarily when parent re-creates the array — minor perf, separate ticket. Follow-up: `goToTeams` does delete-then-insert on `round_players` without a transaction — failed insert loses all team assignments, separate ticket. Shipped Phase A scorecard UI cleanup: A1, A2, A3, A4, A5, A6, A8. Follow-up A4-extended: leftover CH/HC/HCP instances on leaderboard, round/new, summary, and admin RoundSetup tab — separate ticket. A2 revised: top pill now shows only the net delta (e.g., `−3`, `+2`, `E`) at 2rem; absolute net number and parentheses removed. Shipped Phase B1: rounds.format / rounds.format_config / rounds.format_locked_at + CHECK constraint + 2-Ball backfill. SQL committed at supabase/migrations/001_phase_b1_rounds_format_columns.sql. Note: format-picker UI not yet shipped — DEFAULT '2_ball' on the format column keeps the current round-creation insert flow working until the picker UI lands in a later B-phase step. Follow-up logged as I11 (type-safety via `supabase gen types`). Shipped B1.5: Vitest testing infrastructure (vitest.config.ts, tests/ directory, npm test + test:watch scripts). Pure-Node environment, no DOM yet. Setup-verification test passes. B2's scoring engine will populate tests/lib/scoring/. Shipped B2: extracted scoring engine to src/lib/scoring/ (types, handicap, engine + dispatcher, index). 2-Ball implementation only; B3-B5 will fill other format branches via the dispatcher. Rewired scorecard, summary, leaderboard, round/new to call the engine. 25 unit tests passing. Snapshot script tests/snapshots/snapshot-b2.mjs (run via `npm run snapshot:b2`) compared engine vs legacy inline math on all live rounds (36/36 match) before and after rewire. Added tsx as devDep for running TS scripts. Marks B4.5 ✅. Shipped B3: 3-Ball format added to scoring engine via the dispatcher. Renamed compute2BallHole → computeBestNHole; new defaultBestN(format) helper provides format-aware fallback (2 for 2_ball, 3 for 3_ball). 11 new unit tests (9 in engine-3ball.test.ts, 2 in engine-bestn.test.ts); 38 tests total. New snapshot script tests/snapshots/snapshot-b3.mjs (npm run snapshot:b3) does both live-data 2-Ball regression check (36/36 match — confirms the rename + default fallback didn't drift) and synthetic 3-Ball assertions. Marks B2.2 ✅. Shipped B4: Stableford Standard, Stableford Modified, and GOBS House formats added to the engine via three dispatcher branches sharing a single `computeStablefordHole(input, table)` helper. New `getStablefordPoints` net-vs-par-delta lookup (exported), Standard/GOBS House point tables as constants, `mergePointTable` overlays format_config.point_values for Modified. API expansion: added `points: number | null` to PlayerHoleResult so display code reads team and per-player points without re-implementing the lookup. computeRoundResult gates the bestN calc on isBestN; teamParAtScored stays at 0 for points-based formats. 22 new unit tests (engine-stableford.test.ts); 60 tests total. New snapshot script tests/snapshots/snapshot-b4.mjs (npm run snapshot:b4) covers live-data 2-Ball regression + synthetic Standard + Modified (custom point_values) + GOBS House (negative totals). Marks B2.3, B2.4, B2.5 ✅. Engine still throws for unimplemented formats — none remain in Phase B; B5 adds per-hole "all scores count" overrides on top of existing formats. B5 engine: per-hole override logic implemented in scoring engine. UI for admin to set format_config.override_holes ships in B6 (B3.1 multi-select, B3.2 net/gross toggle, B3.3 override banner) — table status for B3.x stays 📋 until then. computeBestNHole now branches on isOverrideHole: override sums all non-null contributors (best-all), wins over manualContributors. computeRoundResult.teamParAtScored scales by actual contributor count so override holes accrue par×N. Stableford / GOBS House are documented no-ops for overrides since they already sum every player. 13 new tests (engine-overrides.test.ts); 73 tests total. New snapshot tests/snapshots/snapshot-b5.mjs (npm run snapshot:b5) does live-data 2-Ball regression + synthetic 2-Ball with overrides on holes 9/18 + GOBS House override no-op verification. |
| May 6 | Shipped B1.2 + B1.3 + B1.4 + B1.5: format gate UI. New `src/components/format/` (FormatPicker, FormatNotSetBanner, ScorecardLockNotice). New `src/lib/format/` (copy.ts with FORMAT_LABELS + DEFAULT_FORMAT_CONFIG, helpers.ts with `roundNeedsFormat` + `defaultConfigFor`). New `src/lib/useIsMobile.ts` lifted from RoundSetup. Migration `supabase/migrations/002_phase_b1_drop_format_default.sql` drops `DEFAULT '2_ball'` and `NOT NULL` on `rounds.format`. Round-creation INSERT paths in `src/app/thomas-admin/tabs/RoundSetup.tsx` (`createRound`) and `src/app/round/new/page.tsx` (`startRound`) now send explicit `format: null, format_config: null`. Banner surfaces on homepage (today's round only) and admin RoundSetup active view. Scorecard renders `<ScorecardLockNotice/>` early when `rounds.format` is null and round is not complete — replaces the entire scorecard chrome (no setup, no +/−). Picker is bottom sheet on mobile (<768px) and centered modal on desktop. Lock copy uses generic "admin" label. Stableford Modified currently uses standard point values; per-round edit UI deferred (logged as TD7). 10 new tests (helpers.test.ts), 120 tests total; all four snapshots still pass. Tech debt added: TD6 (hardcoded `format: "2_ball"` in scorecard/summary engine calls), TD7 (Stableford Modified edit UI). Migration must be applied to Supabase before banner / lock states are reachable in production — gate-state screenshots deferred until apply confirmed. |
| May 7 | **Phase B.1 complete.** Shipped B1.6: format locks at first score, dangerous-action modal for post-lock change, plus TD6 hardcode cleanup. New `FormatChip` component (read-only or editable via `onChange` prop) wired into admin RoundSetup. `FormatPicker` accepts `currentFormat` prop and highlights the existing pick. Score-write path in `scorecard/page.tsx` `setScore` now calls `ensureFormatLocked()` after a successful insert/update; idempotent via local short-circuit (`roundFormatLockedAt` state) plus DB-side `WHERE format_locked_at IS NULL` guard. Helper `isFormatLocked` added to `src/lib/format/helpers.ts`. Scorecard and summary engine calls now read `rounds.format` and `rounds.format_config` dynamically (TD6 ✅ resolved). Editable chip on `/thomas-admin` opens `DangerModal` ("Change format mid-round?" / "Scores will be re-totaled under the new format.") before the picker when locked; opens picker directly when unlocked. `format_locked_at` is **not** changed when admin swaps format — semantically still "first score entered at this timestamp." 2 new helper tests; 122 total. All four snapshots pass. No new migrations required (B4.3 already added the column nullable). |
| May 8 (afternoon) | **Milestone rollup ahead of first live golf-course test.** Phase B fully shipped (B3.1 + B3.2 + B3.3 landed May 7 late). Phase C PR 1 (C3, format-aware team total via `formatTeamTotal` helper) and PR 2 (C1 + C2, live team leaderboard rebuild + `/leaderboard` ↔ `/season` route shuffle) both shipped. Terminology lockdown: new `### Terminology` subsection at the top of Decisions Locked codifies Handicap Index (HI, on `players.handicap_index`) vs Course Handicap (CH, on `round_players.course_handicap` — the May 8 afternoon entry initially named a non-existent `player_course_handicaps` table; corrected 2026-05-09); UI display rule "no bare 'Strokes' or 'Handicap' alone" applied across scorecard, admin Players tab, player profile, and the player-facing players list. Players-list cleanup: per-row "Strokes" labels removed, single right-aligned "Handicap Index" column header added at top of list (matches small-caps muted-gray section header pattern used elsewhere). Tech debt logged this run: TD11 (snapshot scripts need format-filter guard in live-data regression loop), TD12 (FormatPicker now requires explicit Save even for fresh rounds — quick-save affordance deferred), TD13 (`show_leaderboard` admin toggle now gates `/season` rather than the new live `/leaderboard` after the route rename). All TDs sized as Low–Medium, none launch-blocking. **Live golf-course testing started today** — feedback expected to drive the next session's priorities. PR 3 (C4 + C5 + C6, drill-in summary with F9 / B9 / Total) is next up and will incorporate live-test feedback. No code changes in this entry — ROADMAP-only housekeeping pass. |
| May 8 (label clarity) | Pre-live-test label sweep. Database fields stay (`handicap_index` on `players`, `course_handicap` on `round_players` — earlier draft of this entry referenced a non-existent `player_course_handicaps` table; corrected 2026-05-09 alongside the LT1 fix); UI labels disambiguated ahead of first golf-course test. **Scorecard (`src/app/round/[id]/scorecard/page.tsx`):** tee-selection card header `Strokes` → `Course Handicap`; no-HI inline-input placeholder `Enter Strokes index` → `Enter Handicap Index`; per-player row metadata strip `Strokes: N` → `Course Handicap: N · Handicap Index: M.M` (decimal preserved via `.toFixed(1)`; `handicap_index` was already in the scorecard fetch shape so no query change needed). Container has `flexWrap: "wrap"` so the longer label gracefully wraps to a second line on narrow phones. **Admin Players (`src/app/thomas-admin/tabs/Players.tsx`):** new-player form input placeholder `Handicap` → `Handicap Index`; desktop column header `Handicap` → `Handicap Index`; mobile card meta line `Strokes ${HI}` / `No Strokes` → `Handicap Index: ${HI}` / `No Handicap Index`; "No Strokes" amber pill on desktop → `Not on file` (matches existing scorecard tee-selection copy); inline action buttons (mobile + desktop) `Add Strokes` / `Edit Strokes` → `Add HI` / `Edit HI` (compact form for tight 160px desktop action cell and narrow mobile right-column). **Player profile (`src/app/player/[id]/page.tsx`):** per-round meta `Strokes: ${course_handicap}` → `Course Handicap: ${course_handicap}`. Profile header at line 153 already read `Handicap Index` correctly — left alone. **Decisions Locked:** new `### Terminology` subsection at the top of Decisions Locked codifies HI vs CH and the "no bare Strokes/Handicap" display rule. Old "Strokes terminology" Phase A bullet removed (superseded). "Strokes display" bullet renamed to "Stroke-allocation dots" to clarify it's about the per-hole stroke indicator, not the disallowed bare label. **Option C chosen for the scorecard player row:** show both Course Handicap and Handicap Index side-by-side. Reasoning: during early league use the league members are still building intuition about the two quantities, and surfacing both makes the slope adjustment visible per round. May revert to Option A (CH only on scorecard) once the league has settled if the row reads cluttered in real-world use. No math changes, no engine changes, no schema changes. 151/151 tests pass; all four snapshots clean; `tsc --noEmit` clean. |
| May 10 (LT2 triage) | LT2 triage on iPhone with Web Inspector against `lt2-repro` (instrumentation live). Ran 3 variants: Variant A (single player, in-app Back), Variant A2 (alternate nav method), Variant B (3 players, 12 steps including rapid nav stress). **All CLEAN** — no score reversion, no phantom `setScore` on nav, cumulative pill correct throughout. Of the 3 candidate mechanisms going in, score-overwrite and dual-bug-cumulative+persistence are ruled out for these scenarios. **Remaining theory:** Dad in-the-moment misread during the live round, or a condition not yet hit (specific format / team size / network race). LT2 stays 📋 — paused pending observation in next live round with instrumentation still deployed; not blocking other work. **A1.6 / A1.7 unblocked** — score-entry surface no longer treated as paused. Header line updated to reflect new state. ROADMAP-and-STATUS-only commits; no code changes. |
| May 10 (merged) | Phase A.1 PR 1 merged to master and verified live on production. A1.1–A1.5 + TD7/TD10/TD11/TD13 all shipped. A1.6 / A1.7 still deferred pending LT2 fix. |
| May 10 | **Phase A.1 PR 1** on `phase-a1-stableford-best-ball-format-picker`. Five chunks bundled. **A1.4 — Drop GOBS House:** removed enum value, dispatcher branch, `GOBS_HOUSE_POINTS`, FORMAT_LABELS / FORMAT_ORDER / DEFAULT_FORMAT_CONFIG entry, picker `STABLEFORD_FORMATS` member, leaderboard rank `STABLEFORD_FORMATS` member, summary Stableford gate, all unit/snapshot test coverage. Pre-migration check (anon SELECT on `rounds.format`): zero `gobs_house` or `stableford_modified` rows in prod (2 total rounds, both `2_ball`). **A1.1 + A1.5 — Rename + new tables + editable UI:** engine `stableford_modified` → `gobs_stableford` throughout; `STABLEFORD_STANDARD_POINTS` updated to the new locked table (Albatross +8, Eagle +5, Birdie +3, Par +2, Bogey +1, DB+ 0); new `GOBS_STABLEFORD_POINTS` constant (Albatross +8, Eagle +5, Birdie +3, Par +2, Bogey 0, DB+ −1). `getStablefordPoints` verified to collapse any delta ≥ +2 into the DB+ bucket. FormatPicker gains a "Point values (per round)" section that renders only when GOBS Stableford is selected: 6 number inputs (Albatross / Eagle / Birdie / Par / Bogey / DB+ or worse), clamped to [−10, +10], with a "Reset to defaults" link. Editable values persist to `format_config.point_values` and the engine reads them via `mergePointTable(GOBS_STABLEFORD_POINTS, …)`. Mid-round edits still route through the existing FormatPicker DangerModal (already wired for any `format_config` change post-lock). Resolves TD7. **A1.2 — Best Ball:** added enum value `best_ball`, `defaultBestN("best_ball") === 1`, dispatcher routes through `computeBestNHole`, `isBestN` includes `best_ball` for the `teamParAtScored` path (par × 1 × holes). FormatPicker: Net/Gross toggle disabled with "Best Ball is always net" caption + `useEffect` that force-flips local state to "net" so a stale "gross" choice can't slip through commit. Best Ball is a best-N family format → override-holes apply normally (override = sum all non-null contributors). Scorecard `isBestNFormat` updated to include `best_ball`. New unit test file `engine-best-ball.test.ts` (7 tests) + new snapshot script `snapshot:b6` covering single-winner, handicap-flip, tie ordering, override hole, round teamParAtScored, all-null hole. **A1.3 — Format picker placement:** the decoupling already held in code (FormatNotSetBanner on admin RoundSetup, FormatChip on /thomas-admin for post-lock edits, team-build flow not gated on format). State machine semantics codified in ROADMAP A1.3 row: format choice and scorecard unlock are decoupled — scorecard view still shows `ScorecardLockNotice` while `roundFormat == null` (LT2-paused score-entry zone, left intact). **TD13 — leaderboard gate:** Settings UI relabeled from "Show Leaderboard / Visible on the public leaderboard page" to "Show Season Stats / Visible on the season stats page (/season). Live leaderboard always visible." DB key `show_leaderboard` left unchanged (per user instruction to avoid the rename migration). `/leaderboard` already publicly accessible; `/season` gate logic unchanged. **TD10 — stale 2-ball toggle:** removed Toggle + entire "Scoring" Card from `Settings.tsx`, dropped `two_ball_scoring` from `ToggleKey` and from the `defaults` seed in `thomas-admin/page.tsx`. Existing rows in `league_settings` left untouched (UI just stops surfacing the key). **TD11 — snapshot filter guard:** added `if (round.format && round.format !== "2_ball") continue;` to the Part 1 loop in `snapshot-b2`, `snapshot-b3`, `snapshot-b4`, `snapshot-b5`, and the new `snapshot-b6`. **Migration `003_phase_a1_format_set_rebalance.sql`:** drops the old CHECK, renames any `stableford_modified` rows to `gobs_stableford`, re-adds CHECK with new enum (`2_ball`, `3_ball`, `best_ball`, `stableford_standard`, `gobs_stableford`). Includes rollback statement in the file header. **Verification:** `tsc --noEmit` clean. **164/164 unit tests pass.** All 5 snapshots clean (b2/b3/b4/b5/b6). **Out of scope / deferred:** A1.6 (F9/B9/Total pill) and A1.7 (tap player row → expand) — both sit on the live score-entry / hole-navigation surface that's paused while LT2 is reproduced on Dad's iPhone. They go in a follow-up PR once LT2 is fixed. **Branch:** awaiting user review; do not merge until confirmed. |
| May 9 | First live-course feedback session. Phone consultation with Dad covering the May 8 round. **Two critical bugs identified:** scorecard CH displaying wrong values vs DB (Kevin/Wayne examples confirmed live), and scores reverting to par on hole navigation (reproduced by two testers same round). New **Phase 0.5** created for these — investigation + fixes ship before any other phase work, with Vercel preview deployed for Dad to verify on his phone before merging to master. **Format set rebalanced:** Stableford Modified and GOBS House dropped from codebase, format enum, UI, tests, snapshots, and roadmap. **GOBS Stableford** added as a new format with league-specific point table (Albatross/Eagle/Birdie/Par/Bogey/DB+ = +8/+5/+2/0/−1/−2). **Stableford Standard** retains canonical USGA values (Bogey 1, Par 2, Birdie 3, Eagle 4, Albatross 5, DB+ 0); verified against current code as part of A1.1, expected to ship as a no-fix verification. **Best Ball** added as the 5th format, locked to net-only with strict best-1 selection regardless of team size; net/gross toggle disabled in picker; override-holes a documented no-op. **Format picker entry point** moved from scorecard-gated to admin Round Setup tab to match Dad's actual workflow (admin picks format before pairings are drawn). **Blind Draw work (Phase D.1) reprioritized ahead of Phase C PR 3** per Dad's request — blind draw applies roughly every other round due to typical odd-player counts, needs real-round testing. **Phase D.2 (rainout) deleted** — league rule: if play stops, no payouts, round doesn't count, no app-side partial-round handling. **Phase H.4 deleted** (dependent on D.2). **Open Question Q8 deleted** (answered by deletion of D.2). **Phase H.2 (DB backup) elevated:** now also blocks historical data import — Dad wants to enter 2026 historical rounds and needs partial-reset workflow first. New scorecard items in Phase A.1: F9/B9/Total on team-net pill (drives Nassau bet payouts), tap-player-row expand hole-by-hole. New Phase H deliverables: H6 QR code, H7 Add-to-Home-Screen instructions doc, H8 one-shot DB export for Dad's manual verification. **BFB fund visibility on home page** added to Phase F.2 (F2.8). New Decisions Locked: Stableford point values (Standard USGA + GOBS values), Best Ball spec, rainout cancellation, non-paying player handling, format selection entry point, format set (5 formats). TD7 (Stableford Modified edit UI) voided. **Active priority order (post-May 9):** Phase 0.5 → Phase A.1 → Phase D.1 → Phase H.2 → Phase C PR 3 → Phase E onward. Roadmap-only commit; investigation diagnostics for LT1 + LT2 and subsequent fixes follow as separate commits. |
| May 8 | Phase C, PR 2 — C1 + C2: live team leaderboard rebuild. **Route shuffle:** `git mv`'d `src/app/leaderboard/page.tsx` → `src/app/season/page.tsx` verbatim (preserves the existing per-player season stats page exactly as-is, including the `show_leaderboard` admin gate behavior). Bottom nav in `layout.tsx` unchanged — still routes to `/leaderboard`, now the team view. **New page:** `src/app/leaderboard/page.tsx`. Four state branches: (a) `no_round` — no row in `rounds` for today's date; (b) `no_format` — round exists but `format` is null; (c) `live` — round exists with format, `is_complete` false; (d) `complete` — `is_complete` true. States (a) and (b) render the same dashed-border empty card + "View season stats →" link to `/season`; the only differences are the in-page navy state strip's subtitle ("No round today" vs "Round in progress") and whether the format chip appears below the date. **Engine reuse:** scoring-engine `computeRoundResult` called once per team with `getScoringBasis` → `useGross` → zero-handicap trick already established in scorecard/summary. Display value passed to `formatTeamTotal` is `teamScore - teamPar`, which collapses to absolute team points for Stableford (engine returns `teamPar = 0` there). **Color coding:** Stableford-family score → blue (`#2563eb`) regardless of sign; best-N score → green (under par) / red (over par) / black (even). 1st-place rank circle is `#d4a017` gold, others navy. **Pure helpers** in new `src/lib/leaderboard/rank.ts`: `rankTeams<T>(teams, format)` (decorate-sort-undecorate, format-aware direction, stable on ties, "skip" tie-rank semantics) and `holesCompleteForTeam(scoresByPlayer, requiredPlayerIds)` ("thru N" = hole counts only when every required player has a non-null score). Both pure, no DB. **Tests:** 13 new in `tests/lib/leaderboard/rank.test.ts` covering best-N ascending, Stableford descending, two-team tie at 1st (next is rank 3), three-way tie, all-tied, single team, GOBS House negatives, immutability, plus three thru-N edge cases (basic, empty required list, null/undefined treated identically). **Out of scope deliberately:** state-aware GLOBAL app-header subtitle from the mockup; instead, an in-page navy strip on the leaderboard page only. The global header in `layout.tsx` stays "Semiahmoo Golf & Country Club" — a per-page dynamic subtitle would require a layout-level prop drill or context. Easy follow-up if Dad wants. **Drill-in routing:** rows tap through to existing `/round/[id]/summary` page; PR 3 rebuilds that. **Verification:** 151/151 unit tests pass; all four snapshots clean (no engine math touched); `tsc --noEmit` clean. **Tech debt logged:** TD13 — the `show_leaderboard` admin setting now gates the relocated `/season` page rather than the new live `/leaderboard`; label intent no longer matches; resolve during Settings tab polish (alongside TD10). |
| May 7 (night) | Phase C, PR 1 — C3: Format-aware team total display. New `formatTeamTotal(total, format)` helper in `src/lib/format/copy.ts`. Best-N input is interpreted as a stroke delta vs par → `+N` / `−N` / `E`. Stableford-family input is interpreted as absolute team points → `${total} pts`. Both branches use Unicode minus (U+2212) for negatives — matters for GOBS House where `−1` deductions can drop a team's points total below zero. **Sites swapped:** scorecard team net pill (`src/app/round/[id]/scorecard/page.tsx:617`) — passes `teamNet - teamPar`; for Stableford, `teamPar` (= `teamParAtScored`) is 0 by engine contract, so the delta naturally collapses to the absolute points total and the helper's Stableford branch renders correctly. Round summary (`src/app/round/[id]/summary/page.tsx:281`) — gated branch: Stableford-family routes through helper for "X pts"; best-N keeps the existing raw absolute display (e.g. `37` not `+5`) since the summary never used the delta convention pre-PR. **Sites NOT swapped:** `src/app/leaderboard/page.tsx` is the season-level individual leaderboard, no team totals — no swap; live in-round team leaderboard belongs to C1/C2 which are still 📋. Player profile's `scoreLabel` is per-player vs par 72 — explicitly out of scope per user. **Tests:** 5 new in new file `tests/lib/format/copy.test.ts` covering 2_ball positive/negative/zero, stableford_standard positive, gobs_house negative. **138/138 tests pass; all four snapshots clean** (no engine math touched). C1, C2, C4–C6 still 📋. Note: the helper has asymmetric input semantics (delta for best-N, absolute for Stableford); the contract is documented inline at the helper's definition. **Phase C follow-up logged:** scorecard pill (delta) and summary (raw absolute) currently disagree on stroke convention; resolve uniformly to delta during PR 2/3 leaderboard/drill-in work — see Phase C section's follow-up note for the design call. |
| May 7 (late) | **Phase B fully complete.** Shipped B3.1 + B3.2 + B3.3: per-round override holes admin UI + persistent net/gross toggle + on-scorecard override banner. **Type / helpers:** `FormatConfig.scoring_basis?: "net" \| "gross"` added (optional for backward compat). New helpers in `src/lib/format/helpers.ts`: `getScoringBasis(config)` (defaults to "net" for null/undefined/missing-key configs) and `getOverrideHoles(config)` (defensive [] fallback). `DEFAULT_FORMAT_CONFIG` seeds `scoring_basis: "net"` for every format. **FormatPicker rewrite:** two-step flow — pick format → reveal Scoring basis segmented control (Net / Gross) + 6×3 hole grid for override_holes with "9 & 18" preset and "Clear all" utility → Save commits everything in a single update. Stableford / Stableford Modified / GOBS House render the override section at 0.55 opacity with an inline "(no effect on Stableford formats)" caption — admin can still tap, but engine treats override_holes as a no-op there. Save button disabled until something differs from current config. **Mid-round guard (Change 3):** moved out of FormatChip and into FormatPicker's Save click. Single DangerModal ("Change scoring rules mid-round?" / "Scores will be re-totaled under the new rules.") fires when `format_locked_at` is set AND any of (format, scoring_basis, override_holes) differ from saved. FormatChip simplified — taps now open the picker directly; the chip's old format-only DangerModal is gone. `format_locked_at` is **not** modified during a rules edit (semantics preserved). **Engine integration trick:** zero-handicap-on-gross applied at both call sites (`src/app/round/[id]/scorecard/page.tsx` `computeHoleFor` + `buildRoundInput`, and `src/app/round/[id]/summary/page.tsx` `computeRoundResult` calls). When `getScoringBasis(config) === "gross"`, every player's `courseHandicap` is passed as 0; engine net pathway returns gross-equivalent values uniformly. Works for Stableford too (no engine change needed — Stableford has no internal `basis` branch). Note: this means Stableford summary's gross/net view toggle now shows divergent numbers on net-mode rounds (was identical pre-PR — the gross column was effectively dead) — a strict improvement, but a quiet behavior change for any Stableford round already in the DB. **Scorecard override banner (B3.3):** soft yellow banner ("All scores count on this hole") rendered between hole header and team-net pill when current hole is in override_holes. Gated on `isBestNFormat` since the override has no effect in Stableford and showing the banner there would mislead. Visible to all users (no admin gate). **Tests:** 11 new — 9 helper tests in `tests/lib/format/helpers.test.ts` (getScoringBasis, getOverrideHoles, scoring_basis seed in defaults), 2 engine tests in new file `tests/lib/scoring/engine-gross.test.ts` confirming zero-handicap collapses Stableford net to gross and 2-Ball gross == net under the same trick. **133/133 tests pass.** All four snapshots clean — round 47 (which was driving the 8 TD11 false-positives this morning) now produces no mismatches in any of b2/b3/b4/b5, suggesting it was either deleted or converted to 2_ball between sessions. TD11 stays open until the snapshot scripts get the format-filter guard regardless. No new migrations required (`scoring_basis` is optional and read with a "net" fallback). Out of scope / deferred: TD7 Stableford Modified per-round point-value edit UI; the summary page's gross/net view toggle UX in admin-gross-mode rounds (where both columns now show the same number — Phase C concern); cleanup of the legacy `FormatConfig.basis` field which is now a per-call display switch only and could be removed/renamed in a separate refactor. New tech debt logged: **TD12** — the picker's two-step flow adds friction to the previously one-tap fresh-round save path; add a "Quick Save" affordance only if real admin use surfaces the friction. |
| May 7 (PM) | Bundled scorecard polish: A6 behavior tweak, A9 (new), TD9 resolved. **A6** — `scorecard/page.tsx` +/− handlers in the player score row now branch on `current == null`: first tap on either button lands on `par` for the hole; subsequent taps increment/decrement normally. Previous behavior was `par + 1` / `par − 1` on first tap — confusing because the first tap of the round felt like an arbitrary stroke nudge. Tested: hole 2 par 4, fresh round, both buttons → 4. **A9** — added `isBestNFormat = format === "2_ball" \|\| format === "3_ball"` and gated four UI elements: per-player "BALL 1"/"BALL 2" badge, "Tied" badge, the tied-for-Ball banner, and the "tap a card to override which balls count" footer. In Stableford Standard / Modified / GOBS House every player's score contributes, so those affordances were misleading. Card border / "isCounting" highlight intentionally left in place — accurate in either format, just visually loud in Stableford; deferred unless feedback. Override-tap on cards still fires in Stableford but the engine treats `manualContributors` as a no-op for sum-all-players formats, so it's a silent dead click. **TD9** — read-only `FormatChip` rendered above "Hole N" in the scorecard header (centered, 10px below). Visible to all users from the moment a format is set. No `onChange` prop, so the chip is non-interactive on the player surface. `roundId` (string from `useParams`) coerced via `Number(roundId)` to satisfy `FormatChip`'s numeric prop. No scoring math touched; all 122 unit tests pass. Snapshot scripts (b2/b3/b4/b5) report 8 mismatches each — verified pre-existing (same 8 mismatches on a clean HEAD without these changes), all on round 47 played 2026-05-07 in a non-2-Ball format. Logged as TD11: snapshot scripts need a `if (round.format && round.format !== "2_ball") continue;` guard in the Part 1 live-data regression loop so non-2-Ball rounds stop hitting the legacy 2-Ball comparator. |

---

*This roadmap is the canonical "what to build" document. Companion file `GOBS_Game_Rules_v1.docx` is the canonical "how scoring works" document. When in doubt about scope, check this file. When in doubt about scoring logic, check that one.*
