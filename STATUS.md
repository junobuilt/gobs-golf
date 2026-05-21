# GOBS Status

*Auto-maintained by Claude Code at end of each session. For session handoff. Single source of truth for "what's the state right now."*

**Last updated:** 2026-05-21
**Session purpose:** Full day sign-off — H.2.5 (handicap snapshot) shipped and live-verified, TD19 closed (legacy `/round/new` deleted), homepage team formation consolidated (yellow hero button, amber toast, in-card duplicate removed, ⛳ empty state). CLAUDE.md and ROADMAP.md updated.

---

## Today's work — 2026-05-21

### Commits shipped today

| Hash | Message |
|------|---------|
| `3495720` | feat: Phase H.2.5 — snapshot handicap_index on round_players |
| `f212fec` | chore: update STATUS.md for 2026-05-21 H2.5 session |
| `07d630b` | feat: unify team formation entry points — replace legacy /round/new with PlayerPickerSheet, close TD19 |
| `da458bf` | feat: consolidate homepage team formation — yellow hero button, remove in-card duplicate, new empty state |
| `c11d16c` | chore: update STATUS.md for 2026-05-21 homepage polish session |

### What landed

**H.2.5 — Handicap Index Snapshot (`3495720`)**
- Migration `010_phase_h25_handicap_index_snapshot.sql` applied to prod via Supabase MCP
- `round_players.handicap_index_snapshot` column (nullable numeric) added + backfilled
- All INSERT paths updated: RoundSetup.tsx (`toggleInRoster`, `goToTeams`), page.tsx team formation handlers, scorecard
- CH math switched from `players.handicap_index` to `round_players.handicap_index_snapshot` across scorecard, summary, leaderboard, RoundResultsView
- LT1 self-heal gated on `is_complete = false` — finalized rounds no longer drift when HI changes
- Admin HI edit cascade: Players.tsx now also updates snapshot on all active-round `round_players` rows
- 10 new unit tests in `tests/lib/handicap-snapshot.test.ts`
- Live-verified: Gary S started a scorecard; `handicap_index_snapshot` populated on the new row

**TD19 closure — delete legacy `/round/new` route (`07d630b`)**
- Hero pill "+ Start a Scorecard" changed to `<button onClick={handleOpenPicker}>` — opens `PlayerPickerSheet` in `form_team` mode
- `/round/active/page.tsx` fallback link `/round/new` → `/`
- Entire `src/app/round/new/` directory deleted
- 1 new test: hero button opens picker, does not call `router.push`

**Homepage team formation polish (`da458bf`)**
- Hero button: label `+ Form a Team`, yellow `#e8a800` / `#1a1a1a`, `aria-disabled` + `opacity 0.4` when round complete
- Disabled-tap: amber toast ("Round is complete — new teams can't be formed.", 3 s, bg `#fdf0cc` / text `#854f0b`)
- `showToast` extended with optional `duration` + `variant` params — no new component
- Removed "Form a new team" in-card button entirely — hero is the only entry point
- Empty state: ⛳ + "No teams exist yet. Set one up by clicking '+ Form a Team' above." — matches leaderboard pattern
- Tests: 8 click targets updated `"Form a team"/"Form a new team"` → `"+ Form a Team"`, describe blocks rewritten, 1 new disabled-toast test

**Doc updates (this commit)**
- CLAUDE.md: removed deleted `round/new/page.tsx` from date-mock surfaces list
- ROADMAP.md: active priority order updated (H.2.5 complete, removed from queue), H2.5.1–H2.5.6 marked ✅, session log entries added
- STATUS.md: full rewrite

---

## Where we left off

- **356/356 tests** across 38 files. `tsc --noEmit` clean.
- **H.2.5 is live.** Migration 010 applied. Gary S snapshot confirmed on prod.
- **No active round.** The Thursday May 21 live round was the last one; round is finalized.
- **Homepage consolidated.** Single `+ Form a Team` yellow hero button; leaderboard-pattern empty state.
- **Phase H.2.5 fully closed.** All 6 sub-items ✅.

---

## Next priority

1. **Triage beta feedback** from today's live round — watch for UX bugs in the picker / Manage Team flow that surfaced with real users.
2. **Pick next phase:** H.2 (DB backup strategy) is the gating dependency for Phase E (historical import H.5). If backup work is too large, Phase E spec or Phase F.1 are alternatives.
3. **Add to ROADMAP** any new beta feedback items from today's round.

---

## Previous session — 2026-05-20 (late night PT)

### What landed

Beta feedback sprint for Thursday May 21 live round shipped end-to-end. Player-driven team formation + Manage Team is live (5 commits), blind-draw par display bug fixed, leaderboard now shows per-team THRU N / FINAL caption pro-tour style. Full suite at 344/344. Test rot from a hardcoded-date bug introduced May 20 was also caught and fixed. Round 103 on prod had 2 test scorecards (Teams 7 + 8) cleaned up via SQL Editor.

### Shipped commits

- **Commit 1** — Lift `ensureRoundShell` to `src/lib/round/`
- **Commit 2** — `smartJoin` pure logic + 9 tests
- **Commit 3** — `PlayerPickerSheet` component (two modes, mobile/desktop)
- **Commit 4** (`187f9ed`) — Homepage integration + write queue + smart-join branches + `JoinTeamConfirmModal` + `MixedTeamsErrorModal`
- **Commit 4.5** — Dedupe today's-teams section (was rendering twice); delete `TodaysTeamsList`; fold "Form a new team" into existing card
- **Commit 5** (`c7d4694`) — Manage Team button + sheet on scorecard
- **Commit 6** — Blind-draw par display bug (#2): `drawnPlayerPar` threaded through `results.ts` instead of hardcoded par-4
- **Commit 7** — Pin `todayLocal`/`yesterdayLocal` in `page-team-formation.test.tsx` (test rot introduced by `3b5c5e0`)
- **Commit 8** (`c89a504`) — Leaderboard per-team caption (#3): FINAL / THRU N / —

---

## Tech debt added this session

None new. Prior open items:
- **TD17** — Delete-scorecard affordance on admin RoundSetup. Per-team ⋯ delete with DangerModal; don't renumber gaps.
- **TD18** — Extract `Player` type to `src/lib/types.ts` (currently lives at `@/app/admin/page`; 5 team-formation files import from there).
- **TD20** — `withAdminFlags` in `src/lib/admin.ts` exported but unused. Will be used when summary↔scorecard linking surfaces.
- **TD21** — LT1 self-heal documentation: after H.2.5, the Decisions Locked entry needs a one-line amendment noting self-heal reads from snapshot and only fires on active rounds.

---

## Locked patterns added to CLAUDE.md

No new patterns this session. Existing patterns still in effect:
- **Per-player write queue** — port from RoundSetup.tsx when writing to `round_players`
- **Date-mock requirement** — tests touching `todayLocal`/`yesterdayLocal` must `vi.mock('@/lib/date')`

---

## Known prod state

- Round 103 (May 20): finalized blind-draw round with 6 real teams. Cleaned up.
- Round for May 21: played today; finalized.
- Migrations applied to prod: 001–010 (including 009 drops finalize trigger, 010 adds snapshot column).
- No active live round at sign-off.

---

## Open questions / decisions parked

- None new.

---

## Things to know that aren't obvious from code

- Default Claude Code model is `opusplan` (set in `.claude/settings.local.json`). Plan mode uses Opus, execution drops to Sonnet automatically.
- Pre-implementation walkthrough is the norm before any substantial Claude Code spec. Stack with plan-mode in Claude Code for best results.
- Type imports: `RoundPlayer` / `SmartJoinResult` from `src/lib/teamFormation/smartJoin.ts`. `Player` from `@/app/admin/page` (until TD18 extracts it). No parallel type definitions across team formation files.
- `handicap_index_snapshot` is now the canonical HI for all CH math. `players.handicap_index` is the live/current value only; `round_players.handicap_index_snapshot` is what was in effect at round time.

---

*If this file is more than 24 hours stale relative to your session work, flag it in the next session as a problem and reconcile before doing other work.*
