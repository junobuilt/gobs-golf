# GOBS Status

*Auto-maintained by Claude Code at end of each session. For session handoff. Single source of truth for "what's the state right now."*

**Last updated:** 2026-05-10 (end of night, post-live-test wrap)
**Session purpose:** Pre-Monday hardening sprint. Eight commits to master fixing live-test bugs from earlier this evening. All confirmed by Jonathan as live-golden on homepage, admin flow, tee defaults, and date handling. No outstanding code work from tonight.

---

## Monday May 11 priority order

1. **Phase 0.5 — LT1 + LT2 (the original blockers).** Both still 📋. **Untouched by tonight's sprint** — every commit was admin-flow / date / state / preference work. Phase 0.5 exit criteria require LT1 + LT2 to be unreproducible in a back-to-back live round. Next session should investigate these first.
   - **LT1 — Course Handicap display mismatch.** Likely stale snapshot on `round_players.course_handicap` or wrong tee_id in the join. Self-healing recompute already shipped at scorecard load (`a779ced`); needs verification on a fresh live round that the row CH display, stroke-allocation dots, and engine all read the corrected value.
   - **LT2 — Scores reverting to par on hole navigation.** Reproduced live May 8 by two testers; 2026-05-10 triage on iPhone with Web Inspector against `lt2-repro` ran 3 variants all clean. Branch + instrumentation still deployed. Monday should attempt repro again with the instrumentation live.
2. **Live-test verification of tonight's eight fixes** (checklist below). Run alongside LT1/LT2 repro attempts.
3. **I13 — admin UI to edit `players.preferred_tee_id` from the Players tab.** Bumped 2026-05-10 (night) from regular 📋 to next-session-after-Phase-0.5 priority. Roster has two Waynes (`id=45 Hashimoto` and `id=55 Vincent`); only Vincent has `preferred_tee_id` set. Setting Hashimoto's or any future exception via direct SQL is too risky.
4. **A1.6 Step 2 — engine wiring on `phase-a1-team-pill-segments`** if Jonathan approves the mockup. Same plan as in the prior STATUS.md.

---

## Tonight's eight commits (newest first)

| Commit | Title | What it fixed |
| --- | --- | --- |
| `ebb6987` | Tee default + per-player preference | White/Yellow Combo pre-selected in scorecard Tee Selection picker; Wayne Vincent seeded to White via migration `004`. New `players.preferred_tee_id` column; new `DEFAULT_TEE_ID` constant in `src/lib/tees.ts`. Insert paths unchanged — picker still runs every round; START ROUND bulk-commits the fallback. |
| `d087dd6` | Refresh format state on round delete | `doDeleteRound` was missing `roundFormat`/`roundFormatConfig`/`roundFormatLockedAt` from its manual state reset — Today's Format strip kept rendering the deleted round's format. Replaced manual setStates with `await loadRoundForDate(selectedDate)` (canonical reset path). Defensive: `ensureRoundShell` also explicitly resets the three format vars at the same point it sets the new round id. |
| `c0f9d6e` | Drop hardcoded 4-player minimum on check-in gate | Mobile checkin → teams transition gated on `roster.length >= 4`. League plays in 2s/3s/4s. Replaced with a 1-player floor: "Check in at least one player" when empty, "Assign to teams → (N players)" otherwise. |
| `bfec8ca` | UTC-vs-local mismatch on `rounds.played_on` | Admin date picker used local-date; every other "today" callsite used `new Date().toISOString().split("T")[0]` (UTC). After ~5 PM Pacific, paths diverged → two `played_on` values for one league day. New shared helper `src/lib/date.ts` with `todayLocal()` / `yesterdayLocal()`; routed homepage, `/round/new`, `/round/active`, leaderboard, and admin all through it. |
| `7bbd43d` | Silent inactive-player drop + write race | Admin's `loadRoundForDate` resolved players via `allPlayers.find(p => p.id === rp.player_id)` against an active-only prop — silently dropped any player rostered for a round who'd later been deactivated. Switched to embedded join `players ( id, full_name, display_name, handicap_index, is_active )`. Also added per-player write queue (`writeQueueRef` + `enqueueWrite`) so `toggleInRoster` INSERT and `autosaveAssignment` UPDATE serialize per player_id. `goToTeams` and `doneEditing` drain the queue before their reads. Bonus: `History.tsx` got the same TD2 array-vs-object guard. **TD2 ✅.** |
| `f4474c6` | Hotfix flow pivot: shell config NOT NULL + drop redundant Pick label | Live test surfaced "null value in column 'format_config' violates not-null." Added `DEFAULT_FORMAT_CONFIG_SHELL = { basis: "net", scoring_basis: "net", override_holes: [] }` in `src/lib/format/copy.ts`; `ensureRoundShell` inserts it. Also dropped the redundant "Pick" trailing label on Today's Format button. |
| `0880932` | Phase A.1 follow-up: admin format/team-build flow pivot + TD4 fix | Replaced single "+ Create Today's Round" CTA with two top-level buttons ("Today's Format" + "Edit Teams") that both auto-create a round shell. Homepage stripped of all format UI. `goToTeams` diff-based reconciliation instead of delete-all-reinsert. Decisions Locked entry rewritten (not amended). `FormatNotSetBanner.tsx` deleted. **TD4 ✅.** |

All eight on `master`, all auto-deployed via Vercel, all confirmed live-golden by Jonathan.

---

## Master branch state

- HEAD commit: `ebb6987` — Tee default + per-player preference (2026-05-10)
- Status vs production deployment: **in sync**. Migration `004_phase_a_preferred_tee` applied to prod via MCP before the code push.

## Open / unmerged branches

| Branch | Ahead of master | Status | Notes |
| --- | --- | --- | --- |
| `origin/phase-a1-team-pill-segments` | 1 commit (`3afe566`) | awaiting visual review — do not merge | A1.6 Step 1: static team-pill mockup. Unchanged by tonight's work. Vercel preview at `gobs-golf-git-phase-a1-team-pill-segments-junobuilts-projects.vercel.app/mockup/team-pill` (SSO-gated). Step 2 (engine wiring) starts only after Jonathan approves the look. |
| `origin/lt2-repro` | 2 commits | watch-item — instrumentation deployed | Branch + instrumentation stay deployed for Monday's live-round LT2 repro attempt. |

## Last 5 master commits

- `ebb6987` — Tee default + per-player preference (2026-05-10)
- `d087dd6` — Admin RoundSetup: refresh format state on round delete (2026-05-10)
- `c0f9d6e` — Admin RoundSetup: drop hardcoded 4-player minimum on check-in gate (2026-05-10)
- `bfec8ca` — Fix UTC-vs-local mismatch on "today" date for rounds.played_on (2026-05-10)
- `7bbd43d` — Admin RoundSetup: fix silent inactive-player drop + write race (2026-05-10)

## Active blockers / paused work

- **LT1 (Course Handicap display mismatch):** 📋. Self-healing recompute shipped at scorecard load earlier (`a779ced`). Verification across a full live round still pending. **Monday priority #1.**
- **LT2 (scores reverting to par on hole navigation):** 📋. Triage clean across 3 iPhone variants 2026-05-10. Instrumentation stays deployed on `lt2-repro` for Monday's live round. **Monday priority #1.**
- **TD15 (deactivate-while-rostered) and I13 (admin preferred_tee_id UI)** logged tonight — see ROADMAP. Neither blocks the next live round; I13 is queued right after Phase 0.5 lands.

## Branch hygiene (2026-05-10 night cleanup)

Deleted (local + remote where applicable):
- `phase-a1-stableford-best-ball-format-picker` (PR 1 was already merged under a different SHA)
- `claude/fervent-dewdney-adc672` (worktree, local-only)
- `claude/happy-bhabha-f06a52` (worktree, local + remote)
- `claude/peaceful-pasteur-e4d9d7` (worktree, local + remote)

Worktrees `.claude/worktrees/{fervent-dewdney,happy-bhabha,peaceful-pasteur}` removed with `--force` (uncommitted agent scratchpads). One worktree (`funny-nightingale-895061`, detached HEAD at `2108a5e`) was not on the approved-deletion list and left alone.

Kept: `lt2-repro` (instrumentation), `origin/phase-a1-team-pill-segments` (A1.6 mockup awaiting review).

---

## Monday live-test checklist

### Eight fixes from tonight — verify these are golden under actual round conditions

1. **Admin flow rewrite (six scenarios from the spec):**
   1. Empty Round Setup tab → tap Today's Format → picker opens against freshly created round shell → save → returns with format set, no teams built.
   2. Empty Round Setup tab → tap Edit Teams → enters check-in with freshly created round shell (no format yet).
   3. Homepage `/` with no admin action → player taps "Start a Scorecard" → `/round/new` auto-creates shell → scorecard locks via `ScorecardLockNotice` waiting for admin format.
   4. Admin sets format after players built scorecards → next refresh on the locked scorecard reads the new format and unlocks.
   5. In Edit Teams, build a team, tap Done with simulated mid-save failure (manually disconnect network) → existing team assignments preserved.
   6. Homepage shows zero format UI in every state.
2. **Date timezone (after 5 PM PT only — UTC has rolled):** admin RoundSetup default date and homepage "Start a Scorecard" both resolve to the same local `played_on`.
3. **Inactive-player display:** deactivate a player who's in a round → admin RoundSetup still renders them (no badge, no filter).
4. **Write race (rapid tap):** quickly check player in, drag to team, tap Done — team_number persists, not 0.
5. **Check-in gate:** with 1, 2, 3, 4, and 7 players checked in, the "Assign to teams →" button is enabled in every case.
6. **Stale format on delete:** delete a round with a format set → Today's Format strip immediately reverts to "Pick today's format" empty nudge.
7. **Tee defaults on scorecard:** Tee Selection picker opens with White/Yellow Combo pre-highlighted for most players; pre-highlighted with White for Wayne Vincent. Tapping START ROUND with no manual tee taps still works — fallback gets bulk-committed.
8. **Tee defaults on /round/new:** Same pre-selection behavior — Wayne defaults to White, others to White/Yellow Combo.

### LT1 / LT2 reproduction attempts

9. **LT1 repro:** in admin Players tab, edit a player's HI value mid-round. Then open the scorecard for the round containing that player. Confirm the displayed Course Handicap matches the recomputed value from the new HI (not the stale captured value from round-creation). Check stroke-allocation dots use the corrected number too.
10. **LT2 repro:** with `lt2-repro` instrumentation live, enter a score on hole N, navigate to hole N+3, navigate back to hole N. Score should persist as entered, not revert to par. Repeat with multiple players, varying nav patterns. Open Web Inspector console; check for `[LT2]` log entries and run `window.__LT2()` for state snapshot.

---

*If this file is more than 24 hours stale relative to your session work, flag it in the next session as a problem and reconcile before doing other work.*
