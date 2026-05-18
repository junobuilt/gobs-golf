# GOBS Status

*Auto-maintained by Claude Code at end of each session. For session handoff. Single source of truth for "what's the state right now."*

**Last updated:** 2026-05-13 (end of day)
**Session purpose:** Marathon session, four tracks of work all landed on master and live in production.

---

## Today's work — 2026-05-13 end-of-day summary

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

- HEAD commit: `03828ff` — chore: STATUS.md — Option 3 phases A–E + Bug 1 resolution (will move forward by one once this update commits).
- Status vs production deployment: **in sync.** Each merged PR auto-deployed via Vercel to production. Latest confirmed production deploys: `dpl_GioCMq3TWkTnU5BCRiHasqt6E2Di` (Phase E merge) and `dpl_E3q5pkAyqd86uavSA4cZqpwZDLxV` (prior STATUS.md update), both `state=READY, target=production`.
- Schema state: Track A migrations 005 / 006 / 007 applied; Option 3 added no net schema delta (`option3_phase_a_scores_unique_idx` was created and then reverted in the same session — see migration history). Round 90 holds 10 players across 5 teams (T1–T5) with 180 scores; `rounds.played_on` is UNIQUE; `rounds.updated_at` is auto-maintained.

## Last commits on master

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

- vitest: **240/240 pass** across 24 files. Verified fresh at session end.
- `tsc --noEmit` clean.
- Component test infra: `tests/components/fake-supabase.ts` (chainable in-memory client supporting `.upsert`, `.or` no-op, `failWrite` hook, `writeDelayMs`, writes log). Used by `scorecard-bug-repro.test.tsx`, `end-round-flow.test.tsx`, `stale-failure-homepage.test.tsx`, `ReconciliationDialog.test.tsx`, `StaleFailureDialog.test.tsx`, `stuckItemsClipboard.test.ts`.
- Library unit tests: `tests/lib/writeQueue/{backoff,storage,WriteQueue}.test.ts` cover the locked D7 backoff schedule, quota eviction order, `markAsTerminal` / `retryTerminal` / `forget` semantics, hail-mary drain, online / offline / visibility / pageshow triggers, and `in_flight` resurrection on mount.

---

## Next-session priorities

1. **LT1 verification under live-round conditions.** Self-healing recompute is shipped but never confirmed end-to-end. Edit a player's HI mid-round, open the scorecard, check that the row CH, stroke-allocation dots, and engine all read the corrected value.
2. **Option 3 telemetry review.** After a full live round on production, check Sentry for `writeQueue.terminal_failure` events. Each one tells us whether the queue's failure path is firing in practice or whether everything drains via the happy path. Also watch for `user_forget_stale` — every one indicates a user abandoning scoring data.
3. **Bug 2 — confirm fixed or queue follow-up.** After a live round on production, ask whether anyone has experienced snap-back. If yes, the JS movement-threshold guard is the queued follow-up; if no, mark Bug 2 confirmed-fixed.
4. **I13 — admin UI to edit `players.preferred_tee_id`.** Bumped earlier from regular 📋. Roster has two Waynes (`id=45 Hashimoto` and `id=55 Vincent`); only Vincent has `preferred_tee_id` set. Setting Hashimoto's via direct SQL carries real risk of editing the wrong row.
5. **A1.6 Step 2 — engine wiring on `phase-a1-team-pill-segments`** if Jonathan approves the mockup.

---

## Active blockers / paused work

- **LT1 (Course Handicap display mismatch):** 📋. Self-healing recompute shipped earlier (`a779ced`). Verification across a full live round still pending. **Next-session priority #1.**
- **TD15 (deactivate-while-rostered) and I13 (admin preferred_tee_id UI)** still in ROADMAP. Neither blocks the next live round; I13 is queued for next-session.

---

*If this file is more than 24 hours stale relative to your session work, flag it in the next session as a problem and reconcile before doing other work.*
