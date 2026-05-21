# GOBS Status

*Auto-maintained by Claude Code at end of each session. For session handoff. Single source of truth for "what's the state right now."*

**Last updated:** 2026-05-18 PM (Phase D.1 / Blind Draw shipped to production after overnight ship session covering A1 polish + Phase C close + D.1 + same-night hotfix + post-launch UX fixes)
**Session purpose:** Overnight multi-sub-session ship. Started ~May 17 evening with A1.6 + A1.7 + Phase C PR 3 + Individual Rankings restore + `RoundResultsView` extraction + 3 polish commits; rolled into D.1 (Blind Draw) full ship; same-night hotfix replaced the initial auto-fire trigger with explicit per-team Submit Final Scores after live testing surfaced A6's first-tap-commits-par regression; capped with post-launch UX fixes (missed `isLocked` gate on the `+` button, client-side score-write guard for submitted teams, drawn player's aggregate score surfaced inline on every 🎲 caption). 14 commits to master between the close of PM5 and the hotfix landing.

---

## Today's work — 2026-05-17 / 18 (consolidated overnight ship)

Single consolidated section covering everything that landed across PM1–PM5 sub-sessions on May 17 plus the D.1 ship + hotfix + post-launch UX fixes that bled into May 18. Replaced the per-PM fragmented sections during the 2026-05-20 reconciliation pass; all per-PM detail still lives in commit messages and in the consolidated narrative below.

### Commits in order (oldest first)

| Commit | Stage | Summary |
| --- | --- | --- |
| `0639b57` | A1.6 (May 17 morning) | F9 / B9 / Tot cumulative-net row on the scorecard team-net pill. Helper `getTeamNetDeltaForHoles(holes): number \| null` walks `buildRoundInput("net").perHole`; Stableford collapses to absolute points by the C3 convention. 240/240 tests. |
| `34699b2` | A1.7 (May 17 PM) | Tap-to-expand hole-by-hole on each live-scorecard player row. Extracted to new reusable `src/components/scorecard/PlayerHoleGrid.tsx` (props: `scores`, `par`, `currentHoleIndex?`, `showRunningTotal?`) for C PR 3 reuse. Multi-expand; chevron + left-section tap; +/− independence preserved; Remove-from-team moved into the expand panel. 251/251 tests. **Phase A.1 closed.** |
| `d322a30` | Phase C PR 3 (PM2) | C4 + C5 + C6. Full rewrite of `/round/[id]/summary` to all-teams ranked drill-down. Header with date + read-only FormatChip + course + Final/In-progress tag; team cards with gold/navy rank badge, F9/B9 leg row, format-aware big total via `formatTeamTotal`; per-player rows on expand (Gross + Net side-by-side, performance color); `PlayerHoleGrid` on per-player expand. Multi-expand at both levels. **Phase C closed.** |
| `d4cc29a` | Individual Rankings restore (PM3) | Cross-team flat list rendered below all team cards on the summary. Best-N ascending, Stableford descending, tie-skip rank semantics matching `rankTeams`. Uses already-loaded data; zero new queries. |
| `cce58d9` | Shared `RoundResultsView` extraction (PM4) | New `src/lib/round/results.ts` (pure async loader + `LoadedRoundResults` types) + new `src/components/round/RoundResultsView.tsx`. Both `/round/[id]/summary` (~770 → ~60 lines) and `/leaderboard` (~450 → ~180 lines) now render the shared view. Tapping a team on `/leaderboard` drills in inline (no extra navigation). |
| `370c7df` | Phase A.1 polish P1 (PM5) | Drop redundant "Tot" from the team-pill F9/B9/Tot row — headline delta IS the total by construction. |
| `00a54c3` | Phase A.1 polish P2 (PM5) | Traditional notation marks on `PlayerHoleGrid` score cells. Concentric circles (under-par) / squares (over-par), tiered to triple. Replaces the green-text birdie treatment. |
| `23d7379` | Phase A.1 polish P3 (PM5) | Three-row visual hierarchy on hole / par / gross — navy primary `#042C53` weight 500 (hole + F9/B9 label), italic muted (par + par subtotal), semibold primary `#1e293b` (gross + gross subtotal). 259/259 tests. |
| `6d964b7` | ROADMAP + STATUS (PM5) | ROADMAP polish section appended; STATUS PM5 entry written. |
| `f307057` | D.1 — migration + RPC | New `round_players.dropped_after_hole INTEGER NULL CHECK (1..17)`; new `blind_draws` table; new `round_player_actions` audit table; new BEFORE INSERT/UPDATE trigger `scores_reject_on_complete` (raises `P0001 round_finalized`); new RPC `finalize_round_with_blind_draws(p_round_id bigint) RETURNS text` (locks rounds FOR UPDATE, completion check, pool composition with `setseed()` + `random()` and pool ordered by `round_players.id ASC`, inserts `blind_draws` rows + flips `is_complete = true` in single transaction; returns `'not_yet' \| 'already_complete' \| 'finalized' \| 'pool_too_small'`). 10-test SQL fixture (rollback transaction) verified. |
| `2ea7ce3` | D.1 — data layer | `LoadedRoundResults` extends with `TeamRow.blindDraws: BlindDrawFill[]` + `PlayerRow.droppedAfterHole: number \| null`. Joins `blind_draws` with `players` and reuses `scoresByRpId` for the drawn player's scores. |
| `bf80159` | D.1 — S1 overflow menu | New shared `src/components/round/PlayerOverflowMenu.tsx` on both admin RoundSetup active view AND live scorecard. ⋯ icon consolidates Mark as left round + Undo left round + Remove from round (per the May 17 design call — avoids mis-tap risk for the 60–80 demographic vs. separate adjacent destructive icons). Two-step modal with hole picker (1..17) + dynamic consequence text + 1.5s confirm delay. Writes flow through the component: `round_players.dropped_after_hole` update + a `round_player_actions` audit row stamped with `surface = 'admin' \| 'scorecard'`. |
| `ae9cdb3` | D.1 — initial auto-fire trigger + S5 toast (LATER REPLACED) | `useEffect` over `scores` + `roundPlayers`; when local completion predicate flipped true, drained the WriteQueue and called `finalize_round_with_blind_draws`. Replaced same-night by `73de23c` after live test surfaced the A6-interaction regression — left in commit history for traceability. |
| `6413180` | D.1 — S2 pre-fire banner | Yellow banner above the hole-scoring UI on team-filtered scorecard view (`?team=N`). Original condition: "every other team complete + this team on hole 17 or 18 + round not yet complete." Reworked by the hotfix to gate on `submitted_teams` instead. |
| `3cad777` | D.1 — S6 blind-draw rendering | Three new surfaces on `/leaderboard` and `/round/[id]/summary`: compact pill under team roster (per fill, stacks); expanded team card pairs dropout fills with their dropped player by `dropped_after_hole + 1 = hole_range_start`; round-start fills render as synthetic pseudo-player rows. Read-only post-finalize scorecard: +/− removed; merged scores in `PlayerHoleGrid`; per-hole big-number swaps to drawn player's score when in a fill range with a "🎲 (blind draw)" caption. |
| `0cc1592` | D.1 — S7 rankings exclusion | Individual Rankings filters dropouts (`droppedAfterHole != null`). Blind-draw fills were already excluded automatically (no `round_players` row). |
| `2779241` | D.1 — WriteQueue P0001 classification | When the trigger rejects a write because the round is finalized, the WriteQueue stamps the item with `terminal_reason: 'round_finalized'` and `StaleFailureDialog` swaps in specific copy ("Round was finalized — N scores can no longer be edited"). New `TerminalReason` union; new `getTerminalReason()` helper; `WriteResult` + `QueueItem` extended; `FakeSupabase` stubs `supabase.rpc()` with default `'finalized'` response. |
| `50842db` | D.1 — snapshot + unit tests | `tests/snapshots/snapshot-d1.sql` (10 assertions inside a `ROLLBACK_OK`-sentinel transaction). Extracted `pairBlindDraws` + `rangeCopy` into `src/lib/round/blindDrawPairing.ts`; added 8-case pairing test + 5-case `getTerminalReason` test. |
| `00375bd` | STATUS (post-initial-D.1) | First STATUS update after the initial D.1 ship landed. |
| `73de23c` | **Hotfix — auto-fire → per-team Submit gate** | Auto-fire raced A6's "first +/− tap commits par": player taps `+` on hole 18 intending bogey, par writes to DB first, completion check passes, RPC fires, round locks. Confirmed live. Removed the entire auto-fire path (the `useEffect`, the "Finish Round" button, "End round early" link, "Finalize this round?" DangerModal, and the Phase D reconciliation flow on the scorecard). Replaced with: explicit Submit Final Scores button at the bottom of each team-filtered scorecard, disabled until `isRoundLocallyComplete()`; tap → DangerModal "Submit Team N's final scores?" → confirm appends `team_number` to `format_config.submitted_teams` (no migration — JSONB column). New `useEffect` over `submittedTeams` + `allTeamNumbers` + `isRoundComplete` fires the RPC when every team is in the set. Derived `isLocked = isRoundComplete \|\| myTeamSubmitted` gates +/− and `PlayerOverflowMenu`. Green "Final scores submitted" caption near the top when myTeamSubmitted. Pre-fire banner reworded ("All other teams have submitted. Tap Submit Final Scores when ready.") and gated on submission state instead of "team on hole 17/18." |
| `485dfa0` | Hotfix — test refresh | Deleted `tests/components/end-round-flow.test.tsx` (7 tests for the removed manual-finalize flow). Added `tests/components/submit-flow.test.tsx` with 6 cases: Submit disabled until every hole scored; appends to `submitted_teams`; partial submit does NOT fire RPC; closing-the-set submit fires RPC once; `Final scores submitted` + Submit hidden after my team is in `submitted_teams`; pre-fire banner appears when my team is the last not-yet-submitted. `FakeSupabase` now logs every `rpc()` call into `rpcCalls`. |
| `773a43f` | STATUS (post-hotfix) | Hotfix STATUS entry written. |
| `c309e18` | **Post-launch UX combo** | Three fixes from tonight's live test: (1) `+` button still visible after team submits because the earlier `replace_all` for `!isRoundComplete → !isLocked` only matched the `−` block (different surrounding context). Switched plus to `!isLocked`. (2) Score-write path didn't check `submitted_teams` — DB trigger only catches post-`is_complete` writes, so a submitted-but-pre-finalize team's scores were still mutable from any tab. Added client-side guard in `setScore`: if `player.team_number ∈ submittedTeams`, abort + show 3.5s orange "This team's scores are locked." toast. Loaded `RoundPlayer.team_number` so the per-player check works in the whole-round view too. (3) Hunting for the drawn player's net across other team rows on `/leaderboard` was painful UX with many teams — added inline aggregate score to every 🎲 caption ("🎲 Blind draw: Dan G (all 18 holes) — Net −11"). New `BlindDrawFill.drawnPlayerNetValue` field (format-aware: best-N signed delta vs par-in-range; Stableford absolute points sum). `results.ts` refactored to two passes (precompute `enginePerTeam` map, then assemble TeamRows with cross-team engine lookups). Threaded `formatConfig` through `TeamCard` → `PlayerSection` / `BlindDrawPseudoPlayerSection`. Verified live on a real 2-team round (Bill T · Bob B + Dan G drawn from Team 2, "Net −11" rendered inline). |

### Schema deltas applied to live DB (migration `008_phase_d1_blind_draws.sql`)

1. `round_players.dropped_after_hole INTEGER NULL CHECK (1..17)` — mid-round dropout state.
2. New table `blind_draws` `(id PK, round_id FK → rounds, short_team_number, drawn_player_id FK → players, hole_range_start, hole_range_end DEFAULT 18, random_seed bigint, created_at)` + index on `(round_id, short_team_number)`.
3. New table `round_player_actions` (audit log) `(id, round_player_id FK, action text in {'mark_dropout', 'undo_dropout'}, hole, surface in {'admin', 'scorecard'} OR NULL, created_at)`.
4. New BEFORE INSERT/UPDATE trigger `scores_reject_on_complete` on `scores` — raises `P0001 round_finalized` when the parent round's `is_complete = true`.
5. New RPC `finalize_round_with_blind_draws(p_round_id bigint) RETURNS text` — atomic; returns `'not_yet' | 'already_complete' | 'finalized' | 'pool_too_small'`.

Behavioral addition (no migration): `submitted_teams: number[]` inside `rounds.format_config` JSONB. Empty/undefined on rounds created before the hotfix → treat as `[]`.

### Architectural decisions worth flagging

1. **No API layer means the "single-fire guard" lives at the DB.** Score writes go directly from client to Supabase. The spec's "subsequent writes rejected at the API layer" translated to a `BEFORE INSERT/UPDATE` trigger that raises `P0001 round_finalized`. Stronger than an API guard — works regardless of which tab/client wrote.
2. **Atomic finalize via Postgres RPC.** Client-side Supabase calls can't span a transaction over multiple writes. The RPC locks the rounds row `FOR UPDATE` so two tabs racing the all-teams-submitted check can't both fire.
3. **Client-driven RPC call, not a DB trigger on `scores`.** Considered an `AFTER INSERT` trigger that would auto-call `finalize_round_with_blind_draws` server-side. Rejected because the post-fire toast (S5) needs a clear signal back to the user who fired the last submit, and the read-after-write would be uglier than letting the client own the call and branch on the return string.
4. **PRNG reproducibility.** `setseed(seed_bigint::float / 9223372036854775807)` + `random()` inside the function. Pool ordered by `round_players.id ASC` before every draw. Same seed + same pool composition = identical draw sequence. The seed is stamped on every `blind_draws` row written by that call for audit.
5. **The ⋯ consolidation is a UX safety call.** Spec originally separated Mark Left and Remove. Consolidated into one menu after considering the demographic (60–80yo users) and the mis-tap risk of two adjacent destructive icons.
6. **Per-team Submit replaced auto-fire.** Live test surfaced that A6's "first +/− tap commits par" raced the completion-check trigger on hole 18 — par would write, completion would pass, RPC would fire before the player adjusted. Each team now taps Submit Final Scores explicitly; RPC fires only when every team is in `submitted_teams`.
7. **`pool_too_small` is near-impossible but handled defensively.** Pre-check at the top of the RPC computes `pool_size < total_slots`; if so, returns the string without writing anything. Mid-loop subpool-empty case wraps in `RAISE EXCEPTION` so partial writes roll back. Client shows the red banner; round stays live for admin to escalate.

### Verification

- `tsc --noEmit` clean across every commit.
- vitest **272/272 across 27 files.** Net change from the night: dropped 7 end-round-flow tests, added 6 submit-flow tests, plus 8 pairing + 5 terminal-reason cases.
- `snapshot-d1.sql` runs the 10 engine assertions inside a `ROLLBACK_OK` sentinel transaction and exits cleanly with zero leftover rows.
- **End-to-end live-verified on a real round (May 18 evening):** Team 1 (Bill T · Bob B, 2 players) + Team 2 (Dan G · Dan S · Dave V, 3 players). Dan G drawn for Team 1's blind-draw fill. Leaderboard rendered correctly with `🎲 Blind draw: Dan G (all 18 holes) — Net −11` caption. Submit gate behaved correctly: Team 1 + Team 2 both submitted, RPC fired exactly once, no premature finalize.

### Known follow-ups (not blockers)

- **CLAUDE.md schema doc partially stale.** `round_players.course_handicap` is `integer`, not `numeric`; `tee_order_priority` / `payout_amount` / `buy_in_amount` columns aren't documented. New TD entry recommended.
- **`format_config.submitted_teams` uses read-modify-write append.** Theoretical race between two simultaneous submits on different devices can lose a write. Acceptable for in-person sequential play; atomic `append_submitted_team` RPC documented as fallback if it ever bites.
- **Post-submit stale tabs can write scores between team submit and round-level finalize.** Mitigated by the client-side guard in `c309e18`; residual edge case if a tab loaded pre-submit attempts a write before realizing the team submitted. Effectively impossible in normal flow.
- **Telemetry watch.** Once a live round goes through finalize, check Sentry for `writeQueue.terminal_failure` events with `terminal_reason: 'round_finalized'` — every one means a stale tab tried to write after the round closed. Also watch for `user_forget_stale`.
- **Sentry dev-only regressions to clean up** (production-safe, dev Fast Refresh artifacts only): `useRouter is not defined` on `/round/[id]/scorecard`, `React is not defined` on same, `IndividualRankings is not defined` on `/round/[id]/summary`. Plus the Sentry wizard scaffolding pages (`/sentry-example-page` + `/api/sentry-example-api`) still in repo — delete + resolve dashboard issues.

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
| **D** | `76e1a8b` | End-Round reconciliation flow. Tap "Finish Round" → DangerModal confirm → spinner ("Finishing up…") → hail-mary `drain({ ignoreBackoff: true })` → 30 s timeout with "Skip and finish" surfacing at 15 s → if items remain, first-attempt dialog (`Retry sync` / `Skip and finish`); if retry fails, second-attempt dialog (`Try Again` / `Copy details` / `Finish anyway`). New `markAsTerminal(ids, reason)` API on the queue. Bug fix in `drainLoop`: track an `attemptedInThisPass` set so hail-mary mode doesn't loop forever on a persistently-failing item. (D.1 hotfix on 2026-05-18 removed the End-Round button + dialog rendering from the scorecard; the WriteQueue + dialog components themselves remain in the codebase.) |
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

- HEAD commit (pre-reconciliation-commit): `5c2fe7f` — Add files via upload (introduced `docs/ai-patterns.md`). The trailing reconciliation commit will move HEAD forward by one.
- Status vs production deployment: **in sync** through `5c2fe7f` after the push. Each commit auto-deploys to Vercel.
- Schema state: migrations 001–007 plus `008_phase_d1_blind_draws` (applied 2026-05-18 AM). Live: `round_players.dropped_after_hole`, `blind_draws`, `round_player_actions`, `scores_reject_on_complete` trigger, `finalize_round_with_blind_draws` RPC. Hotfix added an optional `submitted_teams: number[]` field inside the existing `rounds.format_config` JSONB — no migration. `blind_draws` and `round_player_actions` populated by the May 18 evening live round (Dan G drawn for Team 1, audit log captured the dropout mark).

## Last commits on master

- `5c2fe7f` — Add files via upload (`docs/ai-patterns.md` reference doc, 2026-05-19)
- `c309e18` — fix(d1): post-launch UX — plus-button + write guard + fill score inline (2026-05-18 PM)
- `773a43f` — chore: STATUS.md — D.1 hotfix entry (2026-05-18 PM)
- `485dfa0` — test(d1): submit-flow test suite + drop obsolete end-round-flow tests (2026-05-18 PM)
- `73de23c` — fix(d1): replace auto-fire with per-team Submit Final Scores gate (2026-05-18 PM)
- `00375bd` — chore: update STATUS.md for Phase D.1 (Blind Draw) ship (2026-05-18 AM)
- `50842db` — test(d1): snapshot-d1.sql + unit tests for pairing + terminal reason (2026-05-18)
- `2779241` — feat(d1): classify P0001 round_finalized + show specific stale-failure copy (2026-05-18)
- `0cc1592` — feat(d1): exclude blind-draw fills + dropouts from Individual Rankings (2026-05-18)
- `3cad777` — feat(d1): render blind-draw fills in RoundResultsView + read-only scorecard (2026-05-18)
- `6413180` — feat(d1): pre-fire warning banner on the final team's scorecard (2026-05-18)
- `ae9cdb3` — feat(d1): auto-fire finalize RPC on last score + post-fire toast (2026-05-18, later replaced by 73de23c)
- `bf80159` — feat(d1): per-player overflow menu — mark/undo left round + remove (2026-05-18)
- `2ea7ce3` — feat(d1): extend LoadedRoundResults with blindDraws + droppedAfterHole (2026-05-18)
- `f307057` — feat(d1): add blind_draws schema + finalize_round RPC (2026-05-18)
- `6d964b7` — chore: ROADMAP polish section + STATUS.md PM5 entry (2026-05-17 PM5)
- `23d7379` — style(scorecard): clarify hole/par/gross visual hierarchy (P3, 2026-05-17 PM5)
- `00a54c3` — feat(scorecard): add traditional notation marks to score cells (P2, 2026-05-17 PM5)
- `370c7df` — feat(scorecard): remove redundant Tot from team pill (P1, 2026-05-17 PM5)
- `cce58d9` — refactor(round-results): extract shared RoundResultsView + use on /leaderboard (2026-05-17 PM4)
- `d4cc29a` — feat(summary): restore Individual Rankings cross-team section (2026-05-17 PM3)
- `d322a30` — feat(summary): Phase C PR 3 — C4/C5/C6 ranked drill-down summary (2026-05-17 PM2)
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

- vitest: **272/272 pass** across 27 files.
- `tsc --noEmit` clean.
- SQL fixture: `tests/snapshots/snapshot-d1.sql` — 10 assertions covering the D.1 engine (completion check, fill count, no collisions, no own-team draws, dropouts excluded, dropout range, single-fire guard, post-finalize rejection, seed reproducibility). Runs inside a rollback transaction; reaches `ROLLBACK_OK` sentinel cleanly.
- Component test infra: `tests/components/fake-supabase.ts` (chainable in-memory client supporting `.upsert`, `.or` no-op, `failWrite` hook, `writeDelayMs`, writes log, and now `rpcCalls` log + `rpcFinalizeResult` override option). Used by `scorecard-bug-repro.test.tsx`, `submit-flow.test.tsx`, `stale-failure-homepage.test.tsx`, `ReconciliationDialog.test.tsx`, `StaleFailureDialog.test.tsx`, `stuckItemsClipboard.test.ts`.
- Library unit tests: `tests/lib/writeQueue/{backoff,storage,WriteQueue,getTerminalReason}.test.ts` cover the locked D7 backoff schedule, quota eviction order, `markAsTerminal` / `retryTerminal` / `forget` semantics, hail-mary drain, online / offline / visibility / pageshow triggers, `in_flight` resurrection on mount, and the `P0001 round_finalized` classifier.
- Pairing helper: `tests/lib/round/blindDrawPairing.test.ts` covers 8 cases for the cross-team fill ↔ dropped-player pairing logic + `rangeCopy` formatting.

---

## Next-session priorities

1. **Live-round verification of D.1 end-to-end (full chain).** First league round (Monday) will exercise: ⋯ menu visual + audit-log writes, dropout caption + +/− disable, per-team Submit Final Scores gate, pre-fire banner, post-fire toast, blind_draws rows being written, post-finalize read-only scorecard + leaderboard rendering with 🎲 captions and inline Net/Gross/Pts aggregates, P0001-classified stale-failure copy if any post-finalize write was attempted. May 18 evening was a partial live test (one round, no live-tap stress); next league round is the real integration check.
2. **Sentry dev-only regressions cleanup** — three D1-era Fast Refresh artifacts firing on dev only (production unaffected): `useRouter is not defined` + `React is not defined` on `/round/[id]/scorecard`, `IndividualRankings is not defined` on `/round/[id]/summary`. Plus delete the Sentry wizard scaffolding pages (`/sentry-example-page` + `/api/sentry-example-api`) and resolve the matching dashboard issues.
3. **LT1 verification under live-round conditions.** Self-healing recompute is shipped but never confirmed end-to-end. Edit a player's HI mid-round, open the scorecard, check that the row CH, stroke-allocation dots, and engine all read the corrected value.
4. **Option 3 telemetry review.** After a full live round, check Sentry for `writeQueue.terminal_failure` events. Watch in particular for `terminal_reason: 'round_finalized'` — every one means a tab tried to write a score after auto-fire fired. Also watch for `user_forget_stale`.
5. **Bug 2 — confirm fixed or queue follow-up.** After the live round, ask whether anyone has experienced snap-back. If yes, the JS movement-threshold guard is the queued follow-up; if no, mark Bug 2 confirmed-fixed.
6. **CLAUDE.md schema doc TD entry.** `round_players.course_handicap` is `integer` (not `numeric`); three columns (`tee_order_priority`, `payout_amount`, `buy_in_amount`) aren't documented. Add a TD entry, then a small consolidation pass to correct the doc.
7. **I13 — admin UI to edit `players.preferred_tee_id`.** Roster has two Waynes (`id=45 Hashimoto` and `id=55 Vincent`); only Vincent has `preferred_tee_id` set. Direct SQL carries real risk of editing the wrong row.

---

## Active blockers / paused work

- **LT1 (Course Handicap display mismatch):** 📋. Self-healing recompute shipped earlier (`a779ced`). Verification across a full live round still pending. **Next-session priority #1 alongside the D.1 live verification.**
- **TD15 (deactivate-while-rostered) and I13 (admin preferred_tee_id UI)** still in ROADMAP. Neither blocks the next live round; I13 is queued for next-session.

---

*If this file is more than 24 hours stale relative to your session work, flag it in the next session as a problem and reconcile before doing other work.*
