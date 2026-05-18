# GOBS Status

*Auto-maintained by Claude Code at end of each session. For session handoff. Single source of truth for "what's the state right now."*

**Last updated:** 2026-05-18 PM (Phase D.1 hotfix — Submit Final Scores gate)
**Session purpose:** Hotfix shipped over the morning's D.1 ship. The auto-fire trigger raced A6's "first +/− tap commits par": a player tapping `+` on hole 18 wrote par before they could adjust, the completion check passed, the RPC fired, and the round locked. Confirmed live. Replaced with explicit per-team submission — each team taps "Submit Final Scores" when done; the RPC fires only when every team has submitted.

---

## Today's work — 2026-05-18 PM (D.1 hotfix — per-team submit gate)

Three commits replacing the auto-fire trigger with an explicit per-team submission gate.

### What broke and why

Original D.1 (this morning) wired auto-finalize as a `useEffect` over `scores` + `roundPlayers`: when the local completion predicate flipped true, the RPC fired. A6 — the "first +/− tap on a hole commits par to DB" behavior — meant tapping `+` on hole 18 to start working out a bogey wrote par to DB *before* the player could adjust. Local state passed completion check. RPC fired. `rounds.is_complete = true`. Player keeps tapping; trigger rejects the writes with `round_finalized`. Round was effectively locked at par on hole 18 for that player.

Tested in vitest as `setScore → enqueue → effect → drain → RPC`. Looked clean in isolation. Failed live because the dependency between A6's optimistic-write semantics and the auto-fire trigger only surfaces when a real human pauses on the final hole.

### Commit timeline

| Commit | What it does |
| --- | --- |
| `73de23c` | **Scorecard rewrite.** Removed the entire auto-fire path: the `useEffect` watching `scores`/`roundPlayers`, the "Finish Round ✓" button on hole 18, the "End round early" link, the "Finalize this round?" DangerModal, and the full Phase D reconciliation flow (`startEndRoundFlow`, `runHailMaryWithTimeout`, `handleRetrySync`, `handleSkipAndFinalize`, `handleCopyDetails`, `finalizeRound`, `queueItemsForThisRound`, and the rendered `ReconciliationDialog` + `FinishingSpinner`). Added `submittedTeams: number[]` + `allTeamNumbers: number[]` state, sourced from `format_config.submitted_teams` (new optional field on the existing `FormatConfig` JSONB) and a `round_players` `team_number` query at mount. Added `submitTeam(teamNum)` — drains the WriteQueue, re-reads `format_config` (race-safety against another tab submitting in the same window), appends my team, writes back. Added `tryFinalizeIfAllSubmitted()` in a `useEffect` over `submittedTeams`/`allTeamNumbers`/`isRoundComplete` — fires the RPC once every team is in the set. Derived `isLocked = isRoundComplete \|\| myTeamSubmitted` gates +/− and the `PlayerOverflowMenu` (which auto-hides when no action is available). New green "Final scores submitted" caption near the top when my team has submitted; new green "Submit Final Scores" button below the player rows, disabled until `isRoundLocallyComplete()`, opens a DangerModal with title `Submit Team N's final scores?` + body `You won't be able to edit these scores after submitting.` Pre-fire banner reworded to `All other teams have submitted. Tap Submit Final Scores when ready.` and gated on (a) this team is the last not in `submitted_teams` AND (b) `isRoundLocallyComplete()`. Removed `useRouter` (no more router.push from finalize). |
| `485dfa0` | **Test refresh.** Deleted `tests/components/end-round-flow.test.tsx` (7 tests for the removed manual-finalize flow). Added `tests/components/submit-flow.test.tsx` with 6 cases: Submit disabled until every hole scored; Submit appends to `format_config.submitted_teams`; Submit alone does NOT fire RPC; Submit closing the set fires RPC exactly once with the right args; `Final scores submitted` caption + Submit button hidden when my team is already in `submitted_teams`; pre-fire banner appears when my team is the last not-yet-submitted. `FakeSupabase` now logs every `rpc()` call into `rpcCalls: Array<{ name, args }>` so the suite can assert invocation counts. |
| `00375bd → this commit` | **STATUS.md update.** Top section refreshed to describe the hotfix; the morning's D.1 ship moves down one level. |

### Design calls made during the hotfix

1. **Submit button is per-team only — whole-round view (no `?team=N`) has no Submit affordance.** Submit represents a single team's intent. The whole-round view is observer/admin and lacks a meaningful "submit" subject. Pre-fire banner also requires a team filter.

2. **Read-modify-write on `format_config.submitted_teams`, not an atomic RPC.** Spec language ("via standard supabase update") and the in-person league context (sequential submissions in practice) made the simpler path right. If a real race shows up, the fallback is a small `append_submitted_team` RPC; not needed today.

3. **Post-submit dropout is a documented limitation.** Overflow menu auto-hides when `isLocked`. Per spec — "dropout-after-submit is a Jonathan-DB-fix path."

4. **Stale tabs can write scores to a submitted team's players pre-finalize.** The DB trigger only blocks post-finalize writes (when `rounds.is_complete` is true). A submitted-but-pre-finalize team's scores are still mutable from any tab that has them loaded. Acceptable for an in-person league; if it bites, Jonathan can DB-fix.

5. **`Next Hole` no longer becomes `Finish Round` at hole 18.** It just disables. Reduces the visual draw toward "do something to end the round" — the right end-the-round action is the explicit Submit Final Scores button below the player rows.

### Verification

- `tsc --noEmit` clean across both code commits.
- vitest **272/272 across 27 files** (was 273; net -1 from deleting 7 end-round tests + adding 6 submit tests).
- Browser preview on `/round/95/scorecard?team=1` (a finalized round): page renders cleanly with no +/−, no Submit button (round is_complete → no submit affordance), no "Final scores submitted" caption (`myTeamSubmitted` is false because pre-hotfix rounds don't have `submitted_teams`), no JS errors. The new "← Back" / "Next Hole →" navigation row is the only bottom-of-page UI.
- **End-to-end live verification is deferred to Jonathan at ~4am per instruction.** Engine correctness already covered by `snapshot-d1.sql` (10-test fixture, unchanged); the submit gate is covered by the new vitest suite. The classifier blocked DB flips for live UI testing.

### Known follow-ups

- `ROADMAP_EDITS_D1.md` application still pending (was already a separate-trailing-session item from the morning).
- "🎲 rendering / snapshot-d1 / P0001 tests" not touched per spec. All still green.
- Telemetry once a live round goes through: watch for `writeQueue.terminal_failure` with `reason: 'round_finalized'` — should be rare; each one means a stale tab tried to write after auto-fire fired on `all teams submitted`.

---

## Earlier today — 2026-05-18 (Phase D.1 — Blind Draw)

Ten focused commits, each one independently verifiable. The locked spec packaged decisions on auto-fire trigger (client-driven RPC call), toast (minimal inline, no new component), overflow menu shape (consolidate Remove + Mark Left + Undo Left into one ⋯ to avoid mis-tap for the 60–80 demographic), stale-failure copy (specific `round_finalized` classification), and PRNG (setseed + random with pool ordered by `round_players.id ASC`).

### Commit timeline

| Commit | What it does |
| --- | --- |
| `f307057` | **Migration + RPC.** Adds `round_players.dropped_after_hole` (NULL or 1..17 CHECK), `blind_draws` table, `round_player_actions` audit log, `scores_reject_on_complete` BEFORE INSERT/UPDATE trigger (raises P0001 `round_finalized`), and `finalize_round_with_blind_draws(round_id)` RPC. Engine is atomic: locks rounds FOR UPDATE, runs completion check, identifies slots, composes the pool (excludes dropouts + own team + already-drawn), seeds the PRNG once per round, draws in ascending team_number / slot order, writes blind_draws rows, flips is_complete. Returns one of `not_yet` / `already_complete` / `finalized` / `pool_too_small`. Verified by a 10-test SQL fixture inside a rollback transaction (2/2/2/3 split + 1 dropout on team 4 after hole 8 → 4 fills, no collisions, no own-team draws, dropouts excluded, single seed, second call returns `already_complete`, post-finalize score insert rejected with `round_finalized`). Migration file in `supabase/migrations/008_phase_d1_blind_draws.sql`. |
| `2ea7ce3` | **Data layer.** `LoadedRoundResults` extends with `TeamRow.blindDraws: BlindDrawFill[]` (carries the drawn player's name, their own team_number, hole range, and full 18-hole gross-score array) and `PlayerRow.droppedAfterHole: number \| null`. `loadRoundResults` joins `blind_draws` with `players` and reuses `scoresByRpId` for the drawn player's scores. Empty array for any round that wasn't finalized with short teams. |
| `bf80159` | **S1 — per-player ⋯ overflow menu.** New shared `PlayerOverflowMenu` component (`src/components/round/PlayerOverflowMenu.tsx`). Live scorecard player rows: ⋯ next to the chevron; "Remove from team" text link removed (consolidated into the menu); dropped players show muted "(left after hole N)" caption; +/− buttons disable for holes > droppedAfterHole. Admin RoundSetup active view: ⋯ at the end of each player line (no Remove option there). Modal shows the hole picker (1..17) + dynamic consequence text + 1.5s confirm delay (matches DangerModal pattern). Writes flow through the component: `round_players.dropped_after_hole` update + a `round_player_actions` audit row stamped with surface ('admin' \| 'scorecard'). Menu auto-hides when no action is available (round finalized + no removable option), so finalized rounds correctly show no ⋯. |
| `ae9cdb3` | **S3 + S5 — auto-fire + toast.** `useEffect` watches `scores` + `roundPlayers` in the scorecard; when the local completion predicate flips true (every non-dropped player has 18 holes, every dropped player has scores through `dropped_after_hole`), drains the WriteQueue and calls `finalize_round_with_blind_draws`. Branches: `finalized` → toast + flip `is_complete` locally; `already_complete` → sync local state silently; `pool_too_small` → red banner with the spec's escalation copy ("Not enough complete rounds to fill blind draws. Contact Jonathan."); `not_yet` → clear the pending flag so the next state change retries. The existing manual `finalizeRound` (End-Round reconciliation entry point) also delegates to the RPC instead of the pre-D.1 client-side completion check. **Behavior change to flag:** the pre-D.1 finish-round check was lenient (every team needed ≥2 players with 18 holes); the RPC enforces the spec's stricter rule (every non-dropped player needs every required hole). Stragglers must be marked dropped via the ⋯ menu for the round to finalize. |
| `6413180` | **S2 — pre-fire warning banner.** Yellow banner above the hole-scoring UI on the team-filtered scorecard view (`?team=N`). Shown when every team other than this one has all required holes scored + at least one player on this team has a score for hole 17 or 18 + round not yet complete. Not dismissible; disappears the moment the round finalizes or another team becomes incomplete. New `refreshOtherTeamsState()` runs on mount + after every score write + after dropout edits. Whole-round view opts out (no "other team" to wait on). |
| `3cad777` | **S6 — RoundResultsView fill rendering + read-only scorecard.** Three new surfaces on `/leaderboard` and `/round/[id]/summary`: (1) pill row under each team's roster listing every fill ("🎲 Blind draw: Bill (all 18 holes)" / "(holes 9–18)"; stacks per fill); (2) expanded team card pairs dropout fills with their dropped player by `dropped_after_hole + 1 = hole_range_start` → paired players get "left after hole N" + an expanded merged 18-hole grid + caption "🎲 Holes N+1–18: blind draw from [Name] (Team M)"; (3) round-start fills render as synthetic pseudo-player rows with their own expand state. Read-only scorecard (post-finalize): +/− removed from every player row; the big-number per-hole display shows the drawn player's score with a "🎲 (blind draw)" caption when the hole falls in a paired fill's range; expanded `PlayerHoleGrid` shows merged scores. New `refreshBlindDrawFills()` runs on mount + after auto-fire so fills appear without a page reload. |
| `0cc1592` | **S7 — Individual Rankings exclusion.** The Individual Rankings section in `RoundResultsView` now filters dropouts (`droppedAfterHole != null`). Blind-draw fills were already excluded automatically (no `round_players` row for the fill). Drawn players still appear exactly once on their own team with their own scores. 🎲 emoji never appears in this section. |
| `2779241` | **WriteQueue P0001 classification + UI copy.** When the trigger rejects a write because the round was already finalized, the WriteQueue now stamps the item with `terminal_reason: 'round_finalized'` and `StaleFailureDialog` swaps in specific copy ("Round was finalized — N scores can no longer be edited" + "These edits were attempted after the round closed. Tap Forget to clear them, or contact Jonathan if a real correction is needed."). New `TerminalReason` union in types.ts; `getTerminalReason()` helper in `instance.ts` pattern-matches the error; `WriteResult` carries an optional `terminalReason` field; `WriteQueue` stores it onto `QueueItem.terminal_reason` and includes it in the Sentry breadcrumb. Test scaffolding: `FakeSupabase` now stubs `supabase.rpc()` with a default `'finalized'` response so existing end-round-flow tests keep passing through the new path. |
| `50842db` | **snapshot-d1.sql + unit tests.** Three artifacts: (1) `tests/snapshots/snapshot-d1.sql` — 10 assertions inside a single `DO` block, wrapped in a `ROLLBACK_OK` sentinel exception so the fixture leaves no production data; (2) `tests/lib/round/blindDrawPairing.test.ts` — 8 cases for `pairBlindDraws` + `rangeCopy` (round-start only, dropout pairing, unmatched dropped player, mixed, multiple at same hole, no false pairing). Extracted the pure helper into `src/lib/round/blindDrawPairing.ts` so it's directly testable; `RoundResultsView` imports from there. (3) `tests/lib/writeQueue/getTerminalReason.test.ts` — 5 cases for the P0001 classifier with `@/lib/supabase` mocked to avoid env-var crashes at import. |

### Architectural decisions worth flagging for future-you

1. **No API layer means the "single-fire guard" lives at the DB.** Score writes go directly from client to Supabase (no API route). The spec language "subsequent writes rejected at the API layer" got translated to a `BEFORE INSERT/UPDATE` trigger on `scores` that joins to `rounds.is_complete`. Stronger than an API guard — works regardless of which tab/client wrote. The WriteQueue's existing `classifySupabaseError` already maps the resulting `P0001` to terminal classification cleanly.

2. **Atomic finalize transaction via Postgres RPC.** Client-side Supabase calls can't span a transaction over multiple writes. The RPC locks the rounds row `FOR UPDATE` so two tabs racing the final score can't both fire; the loser gets `already_complete` and silently no-ops.

3. **Client-driven RPC call, not a DB trigger on `scores`.** Considered an `AFTER INSERT` trigger that would auto-call `finalize_round_with_blind_draws` server-side. Rejected because the post-fire toast (S5) needs a clear signal back to the user who entered the last score, and round-tripping a `SELECT is_complete` after every write is uglier than letting the client own the call and branch on the return string.

4. **PRNG reproducibility.** `setseed(seed_bigint::float / 9223372036854775807)` + `random()` inside the function. Pool ordered by `round_players.id ASC` before every draw. Same seed + same pool composition = identical draw sequence. The seed is stamped on every `blind_draws` row written by that call for audit.

5. **The ⋯ consolidation is a UX safety call.** Spec originally separated Mark Left and Remove. Q3 of the design handoff (this session) consolidated them into one menu after considering the demographic (60–80yo users) and the mis-tap risk of two adjacent destructive icons.

6. **`pool_too_small` is near-impossible but handled defensively.** Pre-check at the top of the RPC computes `pool_size < total_slots`; if so, returns the string without writing anything. Mid-loop subpool-empty case wraps in `RAISE EXCEPTION` so partial writes roll back. Client shows the red banner; round stays live for admin to escalate.

### Verification

- `tsc --noEmit` clean across all 10 commits.
- **vitest: 273/273 pass** (251 prior + 8 new pairing + 5 new terminal-reason + 9 net via earlier scorecard test updates). 27 test files.
- `snapshot-d1.sql` executed in the live database via the Supabase SQL editor path — 10 assertions all pass, `ROLLBACK_OK` sentinel reached, no test pollution remains (verified with a follow-up `SELECT COUNT(*)` on the four mutation surfaces — all zero).
- Browser preview verifications: leaderboard renders today's no-fill round correctly; read-only scorecard on a finalized round correctly hides +/− buttons (snapshot captured both states).
- **End-to-end flow with actual fills not yet exercised on a live round.** Today's round 95 has no short teams; rounds 92/93 are pre-tee-setup; the auto-mode classifier (correctly) blocked me from flipping `rounds.is_complete` on a production row for verification. The full UI path through ⋯ → mark dropout → enter final score → auto-fire toast → finalized view will get its first live exercise on the next round-day. Engine correctness is independently verified by the 10-test SQL fixture; component logic is independently verified by tsc + the 273-test vitest suite.

### Known follow-ups (not blockers)

- **`ROADMAP_EDITS_D1.md` not applied.** The original handoff included a `ROADMAP_EDITS_D1.md` file with table replacements + Decisions Locked subsection + Session Log entry + header date update + Q3 menu-consolidation refinement. Per the user's instruction, this is a separate trailing session. The file was not present in `~/Downloads/` during this session; the user will apply the edits separately with the full content.
- **CLAUDE.md schema doc is partially stale.** `round_players.course_handicap` is `integer` (not `numeric`); `tee_order_priority`, `payout_amount`, `buy_in_amount` columns aren't documented there. The spec called this out; live DB was used as the source of truth for this session. Worth a TD entry on the next consolidation pass.
- **Pre-fire banner refresh cadence.** `refreshOtherTeamsState` runs on mount + on every score write. If User A is on Team 1 finishing up and Team 2's final score lands on User B's phone, User A's banner won't update until User A enters their next score. Acceptable trade-off — the league is at the course together and the auto-fire RPC will fire correctly regardless. Realtime sync is queued under the Option 3 design doc's "Phase F (deferred)" notes if cross-device live sync ever becomes a real workflow need.

### ROADMAP updates

- D.1 work is shipped; ROADMAP table replacement still pending (see `ROADMAP_EDITS_D1.md` follow-up above). Header date line will move to 2026-05-18 once that session runs.

---

## Earlier — 2026-05-17 PM5 (Phase A.1 polish)

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

- HEAD commit (pre-STATUS-update): `485dfa0` — test(d1): submit-flow test suite + drop obsolete end-round-flow tests. The trailing STATUS.md commit will move HEAD forward by one.
- Status vs production deployment: **in sync** through `485dfa0` after the push. Each commit auto-deploys to Vercel.
- Schema state: migrations 001–007 plus `008_phase_d1_blind_draws` (applied 2026-05-18 AM). Live: `round_players.dropped_after_hole`, `blind_draws`, `round_player_actions`, `scores_reject_on_complete` trigger, `finalize_round_with_blind_draws` RPC. Hotfix added an optional `submitted_teams: number[]` field inside the existing `rounds.format_config` JSONB — no migration. `blind_draws` and `round_player_actions` are empty (no live finalize since the morning's broken auto-fire was reverted by the hotfix); first real fill will happen next league round through the submit gate.

## Last commits on master

- `485dfa0` — test(d1): submit-flow test suite + drop obsolete end-round-flow tests (2026-05-18 PM)
- `73de23c` — fix(d1): replace auto-fire with per-team Submit Final Scores gate (2026-05-18 PM)
- `00375bd` — chore: update STATUS.md for Phase D.1 (Blind Draw) ship (2026-05-18 AM)
- `50842db` — test(d1): snapshot-d1.sql + unit tests for pairing + terminal reason (2026-05-18)
- `2779241` — feat(d1): classify P0001 round_finalized + show specific stale-failure copy (2026-05-18)
- `0cc1592` — feat(d1): exclude blind-draw fills + dropouts from Individual Rankings (2026-05-18)
- `3cad777` — feat(d1): render blind-draw fills in RoundResultsView + read-only scorecard (2026-05-18)
- `6413180` — feat(d1): pre-fire warning banner on the final team's scorecard (2026-05-18)
- `ae9cdb3` — feat(d1): auto-fire finalize RPC on last score + post-fire toast (2026-05-18)
- `bf80159` — feat(d1): per-player overflow menu — mark/undo left round + remove (2026-05-18)
- `2ea7ce3` — feat(d1): extend LoadedRoundResults with blindDraws + droppedAfterHole (2026-05-18)
- `f307057` — feat(d1): add blind_draws schema + finalize_round RPC (2026-05-18)
- `6d964b7` — chore: ROADMAP polish section + STATUS.md PM5 entry (2026-05-17 PM5)
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

- vitest: **272/272 pass** across 27 files. Net change today: morning added 8 pairing + 5 terminal-reason + 1 end-round-flow stub update; PM dropped the 7 obsolete end-round-flow cases and added 6 submit-flow cases.
- `tsc --noEmit` clean.
- SQL fixture: `tests/snapshots/snapshot-d1.sql` — 10 assertions covering the D.1 engine (completion check, fill count, no collisions, no own-team draws, dropouts excluded, dropout range, single-fire guard, post-finalize rejection, seed reproducibility). Unchanged by the hotfix — engine semantics didn't move. Runs inside a rollback transaction; reaches `ROLLBACK_OK` sentinel cleanly.
- `tsc --noEmit` clean.
- Component test infra: `tests/components/fake-supabase.ts` (chainable in-memory client supporting `.upsert`, `.or` no-op, `failWrite` hook, `writeDelayMs`, writes log). Used by `scorecard-bug-repro.test.tsx`, `end-round-flow.test.tsx`, `stale-failure-homepage.test.tsx`, `ReconciliationDialog.test.tsx`, `StaleFailureDialog.test.tsx`, `stuckItemsClipboard.test.ts`.
- Library unit tests: `tests/lib/writeQueue/{backoff,storage,WriteQueue}.test.ts` cover the locked D7 backoff schedule, quota eviction order, `markAsTerminal` / `retryTerminal` / `forget` semantics, hail-mary drain, online / offline / visibility / pageshow triggers, and `in_flight` resurrection on mount.

---

## Next-session priorities

1. **Apply `ROADMAP_EDITS_D1.md`.** Companion to today's D.1 ship — table replacement, Blind Draw "Decisions Locked" subsection, May 17 / 18 session log entries, header date bump. Plus the Q3 refinement note: "⋯ overflow menu consolidates Remove + Mark as left + Undo left, replacing the standalone Remove icon." User flagged this as a separate trailing session.
2. **Live-round verification of D.1 end-to-end.** First league round with short teams or a mid-round dropout will exercise: ⋯ menu visual + audit-log writes, dropout caption + +/− disable, pre-fire banner appearing for the final team, auto-fire toast on the last score, blind_draws rows being written, post-finalize read-only scorecard + leaderboard rendering with 🎲 captions, P0001-classified stale-failure copy if any post-finalize write was attempted. Engine correctness already covered by `snapshot-d1.sql`; this is the integration check.
3. **LT1 verification under live-round conditions.** Self-healing recompute is shipped but never confirmed end-to-end. Edit a player's HI mid-round, open the scorecard, check that the row CH, stroke-allocation dots, and engine all read the corrected value.
4. **Option 3 telemetry review.** After a full live round on production, check Sentry for `writeQueue.terminal_failure` events. Watch in particular for `terminal_reason: 'round_finalized'` — every one means a tab tried to write a score after auto-fire fired. Also watch for `user_forget_stale`.
5. **Bug 2 — confirm fixed or queue follow-up.** After a live round on production, ask whether anyone has experienced snap-back. If yes, the JS movement-threshold guard is the queued follow-up; if no, mark Bug 2 confirmed-fixed.
6. **TD entry: CLAUDE.md schema doc is stale.** `round_players.course_handicap` is `integer` (not `numeric`); three columns (`tee_order_priority`, `payout_amount`, `buy_in_amount`) aren't documented. Worth a small consolidation pass.
7. **I13 — admin UI to edit `players.preferred_tee_id`.** Roster has two Waynes (`id=45 Hashimoto` and `id=55 Vincent`); only Vincent has `preferred_tee_id` set. Direct SQL carries real risk of editing the wrong row.

---

## Active blockers / paused work

- **LT1 (Course Handicap display mismatch):** 📋. Self-healing recompute shipped earlier (`a779ced`). Verification across a full live round still pending. **Next-session priority #1.**
- **TD15 (deactivate-while-rostered) and I13 (admin preferred_tee_id UI)** still in ROADMAP. Neither blocks the next live round; I13 is queued for next-session.

---

*If this file is more than 24 hours stale relative to your session work, flag it in the next session as a problem and reconcile before doing other work.*
