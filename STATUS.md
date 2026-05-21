# GOBS Status

*Auto-maintained by Claude Code at end of each session. For session handoff. Single source of truth for "what's the state right now."*

**Last updated:** 2026-05-21
**Session purpose:** Phase H.2.5 — handicap_index snapshot on round_players. All 6 items (H2.5.1–H2.5.6) shipped in one commit. 354/354 tests green.

---

## Today's work — 2026-05-21

### What landed

**Phase H.2.5 — Handicap Index snapshot** shipped end-to-end.

- **Migration `010`** — `ADD COLUMN handicap_index_snapshot numeric NULL` on `round_players` + backfill `UPDATE` from `players.handicap_index`. **Not yet applied to prod — Jonathan applies manually via Supabase SQL Editor.**
- **H2.5.2** — All 5 `round_players` INSERT paths now write `handicap_index_snapshot` at insert time: `RoundSetup.tsx` (toggleInRoster, goToTeams), `page.tsx` (upsertPlayerToTeam + both callers), `round/new/page.tsx` (startRound), `scorecard/page.tsx` (handleManageTeamAdd).
- **H2.5.3+4** — Scorecard self-heal (LT1 fix) switched from `players.handicap_index` to `handicap_index_snapshot`. `updatePlayerTee` and `applyTempHandicap` also use snapshot. Both SELECT queries updated. Gate on `is_complete = false` was already present (confirmed).
- **H2.5.5** — `Players.tsx` `saveHC` cascades the new value to `round_players.handicap_index_snapshot` for every active round the player appears in.
- **H2.5.6** — 10 unit tests in `tests/lib/handicap-snapshot.test.ts` covering (b) self-heal guard, (c) cascade selection logic, (d) CH from snapshot, (e) finalized round CH unchanged.

### Shipped commit

- `3495720` — feat: Phase H.2.5 — snapshot handicap_index on round_players

---

## Next priority

1. **Apply migration `010`** — run the SQL in Supabase SQL Editor (paste from `supabase/migrations/010_phase_h25_handicap_index_snapshot.sql`). This is the only thing needed to make H2.5 live on prod.
2. **Smoke-test** on live round: start a scorecard, verify `handicap_index_snapshot` is populated on the new `round_players` row.
3. Mark H2.5.1–H2.5.6 as ✅ in ROADMAP.md after migration applied and verified.

---

## Previous session — 2026-05-20 (late night PT)

### What landed

Beta feedback sprint for tomorrow's (Thursday May 21) live round shipped end-to-end. Player-driven team formation + Manage Team is live (5 commits), blind-draw par display bug fixed, leaderboard now shows per-team THRU N / FINAL caption pro-tour style. Full suite at 344/344. Test rot from a hardcoded-date bug introduced May 20 was also caught and fixed. Round 103 on prod had 2 test scorecards (Teams 7 + 8) cleaned up via SQL Editor.

### Today's shipped commits

- **Commit 1** — Lift `ensureRoundShell` to `src/lib/round/`
- **Commit 2** — `smartJoin` pure logic + 9 tests
- **Commit 3** — `PlayerPickerSheet` component (two modes, mobile/desktop)
- **Commit 4** (`187f9ed`) — Homepage integration + write queue + smart-join branches + `JoinTeamConfirmModal` + `MixedTeamsErrorModal`
- **Commit 4.5** — Dedupe today's-teams section (was rendering twice); delete `TodaysTeamsList`; fold "Form a new team" into existing card
- **Commit 5** (`c7d4694`) — Manage Team button + sheet on scorecard
- **Commit 6** — Blind-draw par display bug (#2): `drawnPlayerPar` threaded through `results.ts` instead of hardcoded par-4
- **Commit 7** — Pin `todayLocal`/`yesterdayLocal` in `page-team-formation.test.tsx` (test rot introduced by `3b5c5e0`)
- **Commit 8** — Leaderboard per-team caption (#3): FINAL / THRU N / —

---

## Tomorrow's priority (Thursday morning, pre-round)

1. **Smoke-test THRU N on live data.** Watch first few holes of dad's round; confirm leaderboard caption updates per-hole as scores enter.
2. **Watch team formation flow on real users.** This is the first round exercising the new picker / Manage Team flow with the actual league. Expect 1–2 minor UX bugs to surface.
3. **Add to ROADMAP after round:** any new beta feedback items.

---

## Tech debt added today

- **TD17** — Delete-scorecard affordance on admin RoundSetup. Surfaced when Jonathan had to SQL-Editor two test scorecards off prod round 103. Per-team ⋯ delete with DangerModal; don't renumber gaps.
- **TD18** — Extract `Player` type to `src/lib/types.ts` (currently lives at `@/app/admin/page`; 5 team-formation files import from there now — fragile if `/admin/page.tsx` is ever refactored).
- **TD19** — Migrate `/round/new` to use lifted `ensureRoundShell`. Skipped in Commit 1 because its inline pattern is tangled with team-number resolution.
- **TD20** — `withAdminFlags` in `src/lib/admin.ts` exported but unused. Will be used when summary↔scorecard linking surfaces.

---

## Locked patterns added to CLAUDE.md

- **Per-player write queue** (added before Commit 1)
- **Date-mock requirement:** tests touching `todayLocal`/`yesterdayLocal` must `vi.mock('@/lib/date')` to pin dates. Otherwise tests pass on commit day, fail later. (See Commit 7 diagnosis.)

---

## Known prod state

- Round 103 (May 20): finalized blind-draw round with 6 real teams. Teams 7 + 8 (test scorecards) deleted via SQL on 2026-05-20. `format_config.submitted_teams` still populated (audit trail only, not load-bearing).
- Migration 009 applied directly to prod via Supabase MCP earlier (drops `scores_reject_on_complete` trigger). Code expects this state.
- No active live round at sign-off; first round of the day is tomorrow.

---

## Open questions / decisions parked

- None new. All locked decisions from today's #4 work folded into ROADMAP under Player-driven team formation.

---

## Things to know that aren't obvious from code

- Default Claude Code model is `opusplan` (set in `.claude/settings.local.json`). Plan mode uses Opus, execution drops to Sonnet automatically.
- Pre-implementation walkthrough is the norm before any substantial Claude Code spec. Stack with plan-mode in Claude Code for best results.
- Type imports: `RoundPlayer` / `SmartJoinResult` from `src/lib/teamFormation/smartJoin.ts`. `Player` from `@/app/admin/page` (until TD18 extracts it). No parallel type definitions across team formation files.
- 5 chat sessions ran in parallel today (CC) plus 2 planning chats (claude.ai). Handoff via this STATUS.md is the single source of truth — don't trust local memory of any single session.

---

## Previous session — 2026-05-20 AM (D1.11 + H1)

**Session purpose:** Drop the D.1 DB-level finalize lock with a UI lock + admin edit mode; fold in the `/thomas-admin` → `/admin` rename.

### What landed

**Migration `009_phase_d1_drop_scores_finalize_trigger.sql`** — drops trigger `scores_reject_on_complete` and function `reject_scores_on_complete_round`. Applied to prod via Supabase MCP.

**Client-side score-write guard removed** in `src/app/round/[id]/scorecard/page.tsx`. The per-team UI gate (`isLocked` from `myTeamSubmitted`) still hides +/− buttons on submitted teams.

**`isLocked` derivation rewritten** to support admin edit mode:
```ts
const adminEditModeActive = isAdmin && isRoundEditMode && isRoundComplete;
const isLocked = !adminEditModeActive && (isRoundComplete || myTeamSubmitted);
```

**New `src/lib/admin.ts`** — `useIsAdmin()` / `useIsRoundEditMode()` / `enterRoundEditMode` / `exitRoundEditMode` / `buildSearchString` / `withAdminFlags`.

**New `src/components/round/EditModeBanner.tsx`** — pinned yellow banner with Done button, self-gates on `?admin=1&edit=1`.

**New `src/app/round/[id]/layout.tsx`** — wraps summary + scorecard so banner pins across navigation within a round.

**`RoundResultsView.Header` extended** — "Edit Round Scores" button conditional on `data.isComplete && useIsAdmin()`. Tap → DangerModal → confirm navigates to `/round/[id]/scorecard?admin=1&edit=1`.

**Rename `/thomas-admin` → `/admin`** — 4 DangerModal import paths + nav link + docs updated.

**Tests:** 26 new; 298/298 passing pre-today.

### Verification

- `tsc --noEmit` clean.
- 298/298 across 36 files before today's session.
- Browser-verified on prod data (round 103, finalized).

---

*If this file is more than 24 hours stale relative to your session work, flag it in the next session as a problem and reconcile before doing other work.*
