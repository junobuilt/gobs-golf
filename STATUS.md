# GOBS Status

*Auto-maintained by Claude Code at end of each session. For session handoff. Single source of truth for "what's the state right now."*

**Last updated:** 2026-05-13 (Track B Option 3 phases A–E all on master; **Bug 1 fully resolved** via the durable write-queue plan)
**Session purpose:** Five back-to-back PRs landed tonight implementing the locked Option 3 write-queue design (`docs/option-3-write-queue-design.md`). The durability path closes Bug 1 (scores reverting to par on the scorecard) for every reproducible mechanism: write failures mid-flight, tab eviction, offline-on-remount, end-of-round recovery, and multi-session recovery. Earlier in the same evening: Track A duplicate-rounds fix + Track B Bug 2 mitigation + Phase 3 repro tests (see prior session entries below). Everything on master, every PR auto-deployed via Vercel.

---

**2026-05-13 entry — Option 3 / Bug 1 resolution (Track B Step 2):** Five phases shipped as five PRs, each reviewed on a Vercel preview before rebase-merging to master. No unique-constraint migration was needed: Phase A's implementation surfaced that `scores_round_player_id_hole_number_key` (a UNIQUE on `(round_player_id, hole_number)`) already existed in prod, predating the `supabase/migrations/` directory and missed by Phase 2's audit because `list_tables` only surfaces PKs and FKs, not unique constraints. The S1 race-condition theory was therefore structurally impossible at the DB level all along; the remaining active Bug 1 mechanism was Phase 3 Sequence D′ (write fails entirely → optimistic state lost on remount), which Phases B–E close end-to-end. All 240 tests pass (vitest run), `tsc --noEmit` clean.

| Phase | Commit | What shipped |
| --- | --- | --- |
| A | `08ecdce` | `setScore` switched from SELECT-then-INSERT/UPDATE to a single `.upsert(..., { onConflict: "round_player_id,hole_number" })`. One round-trip, idempotent under retry, removes a silently-swallowed `error` field on the prior `.maybeSingle()`. |
| B | `116801f` | `src/lib/writeQueue/` — durable `WriteQueue` class + `localStorage`-backed storage + backoff helper, fully unit-tested. Implements D1–D14 from the design doc. Not yet imported by anything. |
| C | `cc0d773` | Wires the queue into `setScore` (enqueue, not await) + `load()` (drain before rehydrate + overlay still-pending items so the optimistic state survives offline-on-remount). Production `instance.ts` singleton wraps `@sentry/nextjs` as the reporter. |
| D | `76e1a8b` | End-Round reconciliation flow. Tap → spinner ("Finishing up…") → hail-mary `drain({ignoreBackoff:true})` → 30s timeout with "Skip and finish" at 15s → if items remain, first-attempt dialog (`Retry sync` / `Skip and finish`) → if retry fails, second-attempt dialog (`Try Again` / `Copy details` / `Finish anyway`). `markAsTerminal(ids, reason)` added to the queue. Bug fix in `drainLoop`: track an `attemptedInThisPass` set so hail-mary mode doesn't loop forever on a persistently-failing item. |
| E | `668da1e` | On-homepage stale-failure prompt. Mount-only check (per D9), suppresses via `sessionStorage` key `gobs:stale-failure-dismissed` on Escape or overlay-click. Buttons: `Retry`, `View details` (toggles inline round-date display), `Forget` (routes through `DangerModal` + `queue.forget(ids, "user_forget_stale")` with Sentry log per D14). Multi-round clipboard formatter for second-attempt `Copy details`. |

Sentry instrumentation per D14 is live for: terminal failures (with `reason` discriminator: `classified_terminal`, `stuck_too_long`, `end_round_timeout`, `end_round_retry_timeout`, `stale_failure_retry_timeout`), storage evictions, drain crashes, queue-size threshold (≥100), and `user_forget_stale` events. No routine ops logged. Telemetry will show whether Bug 1's failure path is firing in practice and at what rate.

Design doc (committed as `docs/option-3-write-queue-design.md` at `59ec72c`) is the canonical reference. All 14 decisions (D1–D14) are locked. Future Phase F is the multi-tab Supabase Realtime work, deferred indefinitely — not needed for Bug 1 closure.

**2026-05-13 entry — May 11 duplicate-rounds (Track A):** Merged `fix/may11-duplicate-rounds` to master at `df0ee7b` (rebased onto Track B's tip before merge — clean rebase, no conflicts). Investigation report walked the chain: round 90 (3 teams, fully scored) and round 91 (2 teams, fully scored, 31 min later) coexisted for played_on = '2026-05-11'. Original duplicate-cause hypothesis (round-complete-then-stale-tab) was invalidated by score-timestamp triangulation — round 90's `is_complete` couldn't have flipped until ~6:46 PM PT (8+ hours after round 91 was minted). Revised hypothesis: admin RoundSetup race against initial `loadRoundForDate`, OR stale `/round/new` tab. Both paths now use find-or-create with 23505 unique-violation fallback. Migrations `005_fix_may11_duplicate_rounds_cleanup` (idempotent DO block raises if post-merge counts don't match 10 / 5 / 180), `006_rounds_played_on_unique`, `007_rounds_updated_at` applied to prod via Supabase MCP in order. Verified: tsc clean, 170/170 vitest pass, all 5 snapshot scripts clean, live slow-load Chrome test confirmed buttons go disabled+opacity 0.5 within 156 ms of date-picker change and back to enabled at 5799 ms.

**2026-05-13 entry — Scorecard Bug 1 / Bug 2 (Track B Step 1):** Two commits landed on master before Track A:
- `5729e2f` — Bug 2 CSS mitigation: `touchAction: 'pan-x'` on the hole-dot rail, `touchAction: 'manipulation'` on each dot, dot tap targets bumped from 35×35 to 44×44 (WCAG 2.1 AA). Suppresses iOS Safari's scroll-into-tap which was the suspected mechanism for the snap-back-to-prior-hole behavior. CSS-only; no JS movement-threshold handler yet.
- `ec7a614` — Phase 3 of the scorecard bug investigation. Added `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`. Per-file env opt-in via `// @vitest-environment jsdom` (Vitest 4 removed `environmentMatchGlobs`). New `tests/components/fake-supabase.ts` (chainable in-memory client with writes log + `failWrite` hook) and `tests/components/scorecard-bug-repro.test.tsx` (6 sequences A–E + bonus D'). Bug 1's data-loss path was reproducible on demand via the forced-INSERT-failure scenario — and is now closed by Option 3 (D′ flipped to demonstrate the fix in Phase C, see Sequence F).

**2026-05-13 entry — Sentry phase 1:** Sentry error tracking installed — phase 1 plumbing only (`@sentry/nextjs` 10.53.1, DSN via `NEXT_PUBLIC_SENTRY_DSN`, source maps uploading to Vercel, no custom instrumentation yet). Merged at `47cebc9`. Phase E above is the first feature to actually emit Sentry events from custom code (terminal-failure logging from the write queue).

---

## Bug status

| Bug | Status |
| --- | --- |
| **Bug 1 — scores reverting to par.** Originally LT2 in the roadmap. | **✅ Resolved.** Option 3 phases A–E closed every reproducible mechanism. Telemetry (Sentry `writeQueue.terminal_failure` + `writeQueue.forget`) will surface any residual occurrences. |
| **Bug 2 — hole snap-back.** | **Mitigated (live).** CSS fix shipped 2026-05-13 (`5729e2f`). If user testing surfaces continued snap-back, the JS movement-threshold guard is the queued follow-up; otherwise no further work planned. |
| **LT1 — Course Handicap display mismatch.** | 📋 still open. Self-healing recompute shipped at scorecard load earlier (`a779ced`). Untouched by Option 3 work. Verification across a full live round still pending. |

---

## Next-session priorities

1. **LT1 verification under live-round conditions.** Self-healing recompute is shipped but never confirmed end-to-end. Edit a player's HI mid-round, open the scorecard, check that the row CH, stroke-allocation dots, and engine all read the corrected value.
2. **Option 3 telemetry review.** After a full live round on production (which now runs Phase E), check Sentry for any `writeQueue.terminal_failure` events. Each one tells us whether the queue is genuinely needed in practice or whether everything drains via the happy path.
3. **I13 — admin UI to edit `players.preferred_tee_id`.** Bumped earlier from regular 📋 to next-after-Phase-0.5 priority. Roster has two Waynes (`id=45 Hashimoto` and `id=55 Vincent`); only Vincent has `preferred_tee_id` set. Setting Hashimoto's or any future exception via direct SQL is too risky.
4. **A1.6 Step 2 — engine wiring on `phase-a1-team-pill-segments`** if Jonathan approves the mockup. Unchanged by tonight.

LT2 is removed from the list — it's the resolved Bug 1.

---

## Master branch state

- HEAD commit: `668da1e` — feat(homepage): stale-failure prompt (Phase E of Option 3) (2026-05-13)
- Status vs production deployment: **in sync.** Phase E auto-deployed to production at `dpl_GioCMq3TWkTnU5BCRiHasqt6E2Di` (build kicked off on the rebase-merge push). No schema changes shipped in Option 3 — the `scores_round_player_id_hole_number_key` constraint that the upsert relies on was already in place; the temporary `005` index I accidentally created in Phase A was reverted in the same session (see migration history: `option3_phase_a_scores_unique_idx` + `option3_phase_a_scores_unique_idx_revert`, net schema delta zero). Earlier in the session: Track A's migrations `005_fix_may11_duplicate_rounds_cleanup`, `006_rounds_played_on_unique`, `007_rounds_updated_at` are applied. Round 90 holds 10 players across 5 teams (T1–T5) with 180 scores; round 91 deleted; `rounds.played_on` is UNIQUE; `rounds.updated_at` populated with auto-update trigger.

## Open / unmerged branches

| Branch | Ahead of master | Status | Notes |
| --- | --- | --- | --- |
| `origin/phase-a1-team-pill-segments` | 1 commit (`3afe566`) | awaiting visual review — do not merge | A1.6 Step 1: static team-pill mockup. Unchanged by tonight's work. Vercel preview at `gobs-golf-git-phase-a1-team-pill-segments-junobuilts-projects.vercel.app/mockup/team-pill` (SSO-gated). Step 2 (engine wiring) starts only after Jonathan approves the look. |
| `origin/lt2-repro` | 2 commits | **safe to delete.** | LT2 (Bug 1) is resolved by Option 3. Instrumentation no longer needed. Hasn't been touched in days. |

Option 3 working branches (`option3-phase-a` through `option3-phase-e`) all rebase-merged to master and deleted on origin.

## Last 6 master commits

- `668da1e` — feat(homepage): stale-failure prompt (Phase E of Option 3) (2026-05-13)
- `76e1a8b` — feat(scorecard): End-Round reconciliation flow (Phase D of Option 3) (2026-05-13)
- `cc0d773` — feat(scorecard): wire WriteQueue (Phase C of Option 3) (2026-05-13)
- `116801f` — feat(writeQueue): durable retrying write queue (Phase B scaffolding) (2026-05-13)
- `08ecdce` — refactor(scorecard): setScore → single upsert (Phase A of Option 3) (2026-05-13)
- `59ec72c` — docs: Option 3 write-queue design (Step 2 — decisions locked) (2026-05-13)

## Test surface (master)

- vitest: **240/240 pass** across 24 files (171 prior + 6 Phase 3 sequences + 27 Phase B unit + 20 Phase D component/integration + 22 Phase E component/integration + misc).
- `tsc --noEmit` clean.
- Component test infra (added in Phase 3, extended in C–E): `tests/components/fake-supabase.ts` (chainable in-memory client with `.upsert`, `.or` no-op stub, failWrite hook, writeDelayMs, writes log).
- Library unit tests: `tests/lib/writeQueue/{backoff,storage,WriteQueue}.test.ts` cover the locked D7 backoff schedule, quota eviction order, `markAsTerminal`/`retryTerminal`/`forget` semantics, hail-mary drain, online/offline/visibility/pageshow triggers, and `in_flight` resurrection on mount.

## Active blockers / paused work

- **LT1 (Course Handicap display mismatch):** 📋. Self-healing recompute shipped earlier (`a779ced`). Verification across a full live round still pending. **Next-session priority #1.**
- **TD15 (deactivate-while-rostered) and I13 (admin preferred_tee_id UI)** still in ROADMAP. Neither blocks the next live round; I13 is queued for next-session.

LT2 (Bug 1) is no longer in this list — see Bug status table.

---

*If this file is more than 24 hours stale relative to your session work, flag it in the next session as a problem and reconcile before doing other work.*
