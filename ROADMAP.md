# GOBS Golf — Feature Roadmap

*Last updated: May 5, 2026 — major revision after feedback consolidation and flow design*

---

## How to use this file

**Statuses**

- ✅ **Shipped** — live and working
- 🔨 **In Progress** — actively being built
- 📋 **Ready to Build** — spec is locked, can start anytime
- ❓ **Blocked** — needs info from Dad or a decision

**Phases are ordered by dependency.** Phase A unblocks Phase B, etc. Items within a phase can usually be built in parallel.

**One source of truth.** The companion document `GOBS_Game_Rules_v1.docx` defines all scoring logic. This roadmap covers what to build; that document covers how scoring works.

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
| A6 | Default scorecard value = dash, anchored to par | ✅ | Display starts as `—`. First +/− tap moves to par+1 or par−1. Database stores nothing until tap. |
| A7 | Bug: admin-created scorecards not showing player names | ✅ | Currently in production. Fix in next code push. |
| A8 | Keep gross score on round summary + history detail pages | ✅ | Drop from scorecard pill only; preserve elsewhere for "I'm curious" lookups |

**Phase A exit criteria:** Scorecard reads cleaner, no duplicate displays, "Strokes" terminology consistent everywhere.

---

## Phase B — Game Format Engine

*The foundation. Phase C (Leaderboard), D (Blind Draw), and F (History) all depend on this.*

> **Engine status:** Math layer complete — all 5 formats (2-Ball, 3-Ball, Stableford Standard/Modified, GOBS House), 73 unit tests, 4 snapshot scripts. Database foundation shipped (B4.1–B4.4 ✅) and per-hole override engine logic shipped (logged in session log). Remaining Phase B work is UI/UX integration: B.1 format gate (banner, picker, locks) and B.3 override UI (multi-select, net/gross toggle, banner).

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

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| B2.1 | 2-Ball | ✅ | Existing logic. Best 2 net per hole. |
| B2.2 | 3-Ball | ✅ | Best 3 net per hole. 4-player teams drop worst; 3-player teams all count. |
| B2.3 | Stableford Standard | ✅ | Net-based: DB+/Bogey/Par/Birdie/Eagle/Albatross = 0/1/2/3/4/5. Team total = sum across all members. |
| B2.4 | Stableford Modified | ✅ | Same as Standard but admin can edit point values. Saved per-round (snapshot). |
| B2.5 | GOBS House | ✅ | Standard + −1 deduction for net double bogey or worse. |

### B.3 — Per-hole overrides

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| B3.1 | "All scores count" hole multi-select | 📋 | Admin flags specific holes (1–18). On those holes, every team member's score contributes regardless of format. |
| B3.2 | Net vs gross toggle | 📋 | Per-format setting. Net is default. |
| B3.3 | Override visibility on scorecard | 📋 | Small banner appears on flagged holes: "Hole 9: all scores count" |

### B.4 — Database changes

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| B4.1 | Add `format` column to rounds table | ✅ | Enum: `2_ball`, `3_ball`, `stableford_standard`, `stableford_modified`, `gobs_house` |
| B4.2 | Add `format_config` JSON column | ✅ | Stores point values, override holes, net/gross |
| B4.3 | Add `format_locked_at` timestamp | ✅ | Records when first score was entered |
| B4.4 | Backfill existing rounds as `2_ball` | ✅ | One-time migration. Database is being cleared anyway, so trivial. |
| B4.5 | Update scoring engine to switch on format | ✅ | Single function takes (format, scores, handicaps, overrides) → team score. Each format is its own pure function. |

**Phase B exit criteria:** Admin can pick any of 5 formats, scorecards behave correctly for each, scores calculate correctly, format is locked once scoring starts.

---

## Phase C — Leaderboard Rework

*Depends on Phase B for format-aware display.*

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| C1 | Team-only display during live rounds | 📋 | Remove individual leaderboard during play. Team is the unit. |
| C2 | Row format: team name + cumulative score + "thru N" | 📋 | E.g., "Team 2 — Bill T, Bob B, Chuck B, Don D · −2 thru 7" |
| C3 | Format-aware score display | 📋 | Stroke formats: `+2`/`−9`. Stableford: points. |
| C4 | Tap row → round summary view | 📋 | Read-only, anyone can view. Mirrors the round summary page. |
| C5 | Per-player dropdown in summary | 📋 | Click to expand individual hole-by-hole scores |
| C6 | Front 9 / Back 9 / Total 18 breakdown | 📋 | Standard golf split visible in summary |

**Phase C exit criteria:** Players check leaderboard mid-round, see clean team rankings, can drill into any team's detail without editing.

---

## Phase D — Blind Draw & Rainout

*Depends on Phase B. Touches scoring engine.*

### D.1 — Blind draw

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| D1.1 | Short-team designator at round setup | 📋 | "Blind Draw — applies to [holes]" badge on team card |
| D1.2 | Mid-round dropout flow | 📋 | Admin marks player as "left at hole N." Their team plays remaining holes short. |
| D1.3 | Round-start short team flow | 📋 | Team built with fewer than full roster. Blind draw applies to all 18 holes. |
| D1.4 | Pending state on live leaderboard | 📋 | Short team visible with "Pending blind draw — score reveals at round end" label. No score until resolved. |
| D1.5 | Randomizer engine | 📋 | At round-end, randomly select a player from any other team. Copy their actual scores onto short team's missing slot for affected holes. |
| D1.6 | Multiple short teams | 📋 | Each gets independent draw. Logged note in case it becomes a problem (e.g., short team draws from another short team). |

### D.2 — Rainout

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| D2.1 | 9-hole official threshold | 📋 | Round becomes "official" when any team completes 9 holes |
| D2.2 | Sub-9 partial round handling | 📋 | Save with `partial: true` flag. Don't roll up to season stats. Decision on display/discard parked. |

**Phase D exit criteria:** Short teams handled gracefully on both ends, randomizer works, partial rounds preserved without polluting stats.

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
| H2 | Database backup strategy | 📋 | Daily Supabase backups. Manual export option for end-of-season snapshot. **Treated as launch-blocker for full production use.** |
| H3 | Season open/close flow | 📋 | Admin manually closes season in Settings. Reminder banner appears as season-end approaches (Sept/Oct). Closes the BFB fund for donation. |
| H4 | Partial round long-term decision | ❓ | Blocked on Dad's input. Display in separate section? Discard? Convert to practice? |
| H5 | Data import for 4 weeks of historical rounds | 📋 | Once Dad fills in the spreadsheet, import script reads it and writes to Supabase. One-time job. |

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
| TD7 | Stableford Modified point values edit UI | 📋 | Medium | Engine reads `format_config.point_values` (B2.4 ✅), but no admin surface exists to set them per round. Currently defaults to Stableford Standard values. Likely a small dedicated ticket — bottom sheet/modal post-pick, similar pattern to FormatPicker. |
| TD8 | Banner button clipping on narrow phones (<414px) | 📋 | Medium | The "Choose Format" CTA inside `FormatNotSetBanner` is clipped at 375px (iPhone SE) and similar small-phone widths. Surfaced during B1.5 screenshot capture. League demographic includes older players on smaller/older phones, and the banner is the admin's primary entry point. Likely fix: stack banner contents vertically below ~414px, or shrink CTA padding. Visual-only change, no logic. |
| TD9 | Player-visible format display on scorecard | 📋 | Low-Medium | B1.6 added `FormatChip` to admin RoundSetup only. Players entering scores have no on-screen indication of the active format. Players generally know the format from pre-round announcement, but it's discoverable nowhere in the app for late arrivals or anyone double-checking. Likely fix: render a read-only `FormatChip` in the scorecard header. Visual-only, no logic change. Hold for B1.6 user feedback before building. |
| TD10 | Remove stale "2-ball" toggle in admin > Settings | 📋 | Low-Medium | Pre-Phase B legacy from v1 app. Now superseded by per-round format picker (B1.4). Toggle is no-op or worse — confusing surface that implies league-level format setting when format is per-round. Cosmetic + confusing, not data-breaking. Likely fix: delete the toggle, audit Settings tab for any other v1 leftovers in the same pass. |

---

## Phase I — Post-Launch / Nice-to-Haves

---

*Parking lot. None of these block launch. Revisit after a few months of real-world use.*

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| I1 | Player profile — round history accordion | 📋 | Collapsed by default. Tap to expand. Replaces auto-displayed history. |
| I2 | Player profile — Played With accordion | 📋 | Same pattern. Reuses Egocentric component from Phase E. |
| I3 | Player profile — season stats summary | 📋 | Rounds played, avg gross, avg net, best/worst, scoring trend |
| I4 | Player profile — performance chart | 💡 | Line chart of scores over time |
| I5 | Player profile — winnings/losses | 💡 | Deferred. Don't want it competitive. May add later if Dad asks. |
| I6 | Team recommendation engine | 💡 | Suggest balanced teams based on handicap spread + played-with history. **This is where pair-balance math lives, not in played-with view.** |
| I7 | Custom domain | 💡 | gobsgolf.com or similar |
| I8 | PWA install polish | 💡 | "Add to home screen" prompts |
| I9 | SWAT format | ❓ | Blocked. Need rules from Dad. |
| I10 | Combo tees | ❓ | Blocked. Need rules from Dad. |
| I11 | Generate Supabase TypeScript types | 💡 | Run `supabase gen types` CLI so query responses get column-shape type checking. Currently uses `any`, meaning tsc cannot catch column typos. Tooling-only change, no functional impact. Worth doing once schema stabilizes. |

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
| Q8 | Partial round (under 9 holes) — discard or save separately? | H4 | Rules doc Section 7 |
| Q9 | Handicap data for 4 missing players (DeWaal S, Gary T, Gerry H, Norm C) | Phase A onwards | Players Reference sheet |
| Q10 | What does SWAT stand for? Rules? | I9 | Rules doc Section 10 |
| Q11 | What is a SWAT Scramble? | I9 | Rules doc Section 10 |
| Q12 | How do combo tees work? | I10 | Original feedback |

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

- **Format gate:** Admin must pick fresh every round. No defaults, no persistence between rounds. Forced choice prevents wrong-format scoring.
- **Format authority:** Admin only. Players cannot pick or change.
- **Scorecard pre-format:** Locked until format chosen. Display "Waiting for format" message.
- **Stat display drop:** Gross removed from scorecard top pill. Kept everywhere else.
- **Strokes terminology:** Replaces all "CH" / "HC" / "HCP" labels app-wide.
- **Strokes display:** Dots, no number, above +/− buttons.
- **Default scorecard value:** Dash with par-anchored +/−. Database null until first tap.
- **Blind draw timing:** Resolves after round finalized, not at start.
- **Blind draw eligibility:** Random pick from any other team's player.
- **Blind draw drawn-player effect:** Original team unaffected; scores copied to short team only.
- **9-hole minimum:** Round official at 9. Sub-9 saved as partial.
- **One format per day, league-wide:** Different foursomes don't play different formats simultaneously.
- **Money allocation:** $1 HiO + $2 BFB + $7 team pot (default $10 buy-in).
- **BFB:** Blaine Food Bank, donated yearly at season end.
- **History/Betting tab split:** Two tabs. History = game performance. Betting = financial.
- **Played-with primary view:** Egocentric (one player at a time) on mobile + desktop. Improved grid as desktop secondary.
- **Pair-level handicap balance:** Not a thing. Balance is team-level. Belongs in team recommendation engine (I6), not played-with.
- **Player money on profile:** Deferred. Don't want it competitive.
- **Admin button on homepage:** Hide for launch. URL `/admin` still works.

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

---

*This roadmap is the canonical "what to build" document. Companion file `GOBS_Game_Rules_v1.docx` is the canonical "how scoring works" document. When in doubt about scope, check this file. When in doubt about scoring logic, check that one.*
