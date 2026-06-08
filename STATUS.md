# GOBS Status

*Auto-maintained by Claude Code at end of each session. For session handoff. Single source of truth for "what's the state right now."*

**Last updated:** 2026-06-07 (Wave 1B — team-card entry surface: Commit 2)
**Session purpose:** Wave 1B team-card spine for Shambles. **C0** audit + storage proposal (approved). **C1** foundation: `team_scores` table (migration 018, applied to prod), `"shambles"` registration, `team_ball_count`, `isTeamCardFormat`/`getTeamBallCount`, pure read helper. **C2 (this commit)** the NEW team-card entry surface `/round/[id]/team-card?team=N` — team-level score entry (count-1 one box / count-2 two summed balls), dash-until-tap par-anchored, gross-only (allowance disabled), reachable by direct URL only (routing is C3). **638/638 vitest; 15/15 e2e; `tsc` clean.** Commits 3 (routing + read branches + season exclusion) and 4 (finalize without blind draw) still pending.

---

## 2026-06-07 (Wave 1B — Commit 2: team-card entry surface)

### Where we left off

**The team-card entry surface exists and works (entry only).** Reachable at `/round/[id]/team-card?team=N`. Mirrors the individual scorecard's look + A6 interaction but scores at the TEAM level. Per the spec's split, **Submit + finalize is C4** and **homepage routing + `FORMAT_ORDER` registration is C3** — so the surface is direct-URL-only in C2 (nothing in prod reaches it yet; Shambles still isn't pickable).

- **NEW `src/app/round/[id]/team-card/page.tsx`** (`"use client"`) — sibling route to `scorecard`/`summary` (inherits `round/[id]/layout.tsx`). Requires `?team=N` (else "No team selected"); guards `!isTeamCardFormat(format)` ("Not a team-card round"). Loads round + this team's roster (display names) + holes for the team's representative tee (par is consistent across tees) + existing `team_scores` (hydrated). Per-hole +/- entry via `TeamHoleEntry`; **dash-until-tap, par-anchored** (`current == null ? par : ±1`; "—" until first tap; nothing written until then). On change: optimistic state → **direct per-box upsert** to `team_scores` (last-write-wins; the WriteQueue is `scores`-only and NOT reused) → `ensureFormatLocked()` (same idempotent DB-guarded lock as the scorecard). Header: read-only `FormatChip` + "1/2 balls per hole" + **"Gross only — no handicap"** caption (replaces "Handicaps at N%"). Running totals (delta vs par / thru / gross), hole-nav dots, expand → reuse `PlayerHoleGrid` for the team's hole-by-hole single row. Read-only when `is_complete`. **No Submit button (C4).**
- **NEW `src/lib/round/teamScoresIo.ts`** — `loadTeamScores(roundId)` + `upsertTeamScore({...})` (`onConflict: round_id,team_number,hole_number,ball_index`). Kept out of the pure `teamScores.ts` so the aggregation stays mock-free. C3's `results.ts` will reuse `loadTeamScores`.
- **NEW `src/components/scorecard/TeamHoleEntry.tsx`** — the per-hole stepper(s); count-1 one stepper, count-2 two + summed hole total. Owns the par-anchor + 1..20 range guard (testable); parent owns persistence via `onSet(ballIndex, value)`.
- **MODIFIED `src/app/admin/tabs/RoundSetup.tsx`** — handicap-allowance selector disabled + "N/A · gross only" when `isTeamCardFormat(roundFormat)`. (Unreachable until C3 makes Shambles selectable, but satisfies C2's allowance-disable scope.)
- **MODIFIED `e2e/support/supabaseMock.ts`** — registered `team_scores` (the generic upsert already honors the 4-col `on_conflict`); **MODIFIED `e2e/support/fixtures.ts`** — `seedTeamCardRound({roundId, ballCount})`.

**Files:** NEW `src/app/round/[id]/team-card/page.tsx`, `src/lib/round/teamScoresIo.ts`, `src/components/scorecard/TeamHoleEntry.tsx`, `tests/components/team-hole-entry.test.tsx`, `e2e/teamCard.spec.ts`. MODIFIED `src/app/admin/tabs/RoundSetup.tsx`, `e2e/support/supabaseMock.ts`, `e2e/support/fixtures.ts`, `STATUS.md`.

**Tests:** +7 vitest (`TeamHoleEntry`: dash→par on first +/- tap, increment/decrement, 1..20 guard at both bounds, count-2 two boxes + summed total, total "—" when empty, disabled blocks onSet — fixtures start unscored as negative controls) + 4 Playwright (`teamCard`: dash-until-tap→par + running totals; **writes a `team_scores` row and leaves `scores` empty**; count-2 two boxes + summed hole total 4+5=9; gross-only caption present / "Handicaps at N%" absent). **631 → 638/638 vitest; 11 → 15/15 e2e; `tsc` clean.**

### Today's commits

- (this session) feat(scoring): Wave 1B C2 — team-card entry surface (`/round/[id]/team-card`)
- (this session) chore(db): refresh schema.sql to canonical pg_dump (captures 017 reset_fund + 018 team_scores)

### DB changes (today)

- **None to prod this commit.** C2 is app code only (the `team_scores` table + constraint were migration 018 in C1). `schema.sql` was regenerated to canonical `pg_dump` (captures the previously-missing 017 `reset_fund`/`note` AND C1's 018 `team_scores`/`shambles`), superseding C1's hand-sync — committed as a separate `chore(db)`.

### Tomorrow's priority

1. **Commit 3** — routing via `isTeamCardFormat` (homepage "tap team" → team-card; round-open routing); add `"shambles"` to `FORMAT_ORDER`; `loadTeamScores` branch in `results.ts` → leaderboard/summary single team row (no per-player rows); season/profile exclusion (`playerStats.ts`, `season/page.tsx`, `player/[id]/page.tsx`) — played-with stays included. **Flag the `TeamRow` `players: []` + additive-optional-field for the expand-row as a contract change at C3 plan time** (payout + S5 tracks consume `TeamRow`).
2. **Commit 4** — `finalize_team_card_round` RPC (no blind draw) + Submit button + gate at `scorecard/page.tsx:1049`; golden fixtures with the blind-draw negative control.

### Considered but not changed (confession)

- **Submit Final Scores + finalize deferred to C4** (spec puts them there). C2's card is non-submittable — acceptable, as it isn't in production flow until C3/C4.
- **Homepage routing + `FORMAT_ORDER` registration deferred to C3.** Direct-URL only in C2.
- **`TeamRow` / `results.ts` untouched** (C3). The `players: []` + additive-optional-field decision for the team expand-row is flagged for C3 plan time per the frozen-contract directive.
- **WriteQueue not used** — direct per-box upsert to `team_scores` (last-write-wins), per the C0 audit. No DB trigger yet rejecting team_scores writes on finalized rounds (client read-only guard only; possible C4 hardening mirroring `scores_reject_on_complete`).
- **Allowance-disable added in `RoundSetup` even though Shambles isn't selectable until C3** — spec scopes it to C2; additive + correct now.
- **No browser-preview screenshot.** The e2e suite runs against a real Next dev server with real render + interaction + `team_scores` writes (stronger than a manual screenshot); a prod preview is moot (no Shambles round exists; surface not routable yet).
- **Individual scorecard surface + read path untouched.** Par read from the team's representative tee (par consistent across tees).

---

## 2026-06-07 (Wave 1B — team-card scoring spine: Commit 0 + Commit 1)

### Where we left off

**The team-card scoring spine is laid; only Shambles is registered, and it isn't yet selectable in prod (by design).** Spec: [docs/SPEC_1B_team_card_spine_shambles.md](docs/SPEC_1B_team_card_spine_shambles.md). Plan-first; Commit 0 audit approved before any code.

- **Commit 0 (plan mode) — audit + storage proposal (approved).** Mapped: individual score storage (`scores` per `round_player`); format storage (`rounds.format` + `format_config` jsonb); every score-aggregation read site (`results.ts` keystone → leaderboard/summary; homepage status; scorecard); the finalize/blind-draw gate (**exact point: `scorecard/page.tsx:1049` `rpc("finalize_round_with_blind_draws")`** — and critically the RPC's *completion check* itself counts per-player `scores`, so team-card must bypass the RPC entirely); and the season/profile per-player read sites that must EXCLUDE team-card rounds (`playerStats.ts`, `season/page.tsx`, `player/[id]/page.tsx`) — with **played-with deliberately INCLUDED** (roster is captured normally). **Locked decisions:** storage Option A (long/`ball_index` rows); generic `team_ball_count`; a dedicated `finalize_team_card_round` RPC (C4) for concurrency symmetry; the played-with-include / scoring-exclude asymmetry is intentional.
- **Commit 1 — foundation (this commit).**
  - **Migration `018_phase_1b_team_scores.sql` — APPLIED TO PROD** via MCP `apply_migration` (after read-only verifying the live constraint matched + `team_scores` absent). `team_scores(id, round_id FK→rounds ON DELETE CASCADE, team_number>0, hole_number 1–18, ball_index 1–2 default 1, strokes 1–20, created_at)`, `UNIQUE(round_id, team_number, hole_number, ball_index)` (per-box last-write-wins), index `(round_id, team_number)`, RLS enabled + allow-all policy (mirrors `scores`; client-written). `rounds_format_check` extended to allow `'shambles'`. Ball count lives in `format_config`, not a column. **Post-apply verified:** constraint includes shambles, RLS on, 1 policy, unique key + columns correct.
  - **Classification (single source of truth):** `isTeamCardFormat(format)` in `src/lib/format/helpers.ts` backed by `TEAM_CARD_FORMATS = new Set(["shambles"])` — every future routing/read site consults it; the other 3 formats ride it by one-line registration (+ the CHECK). `getTeamBallCount(config)` reader (default 1, clamp [1,2]).
  - **Type/registration:** `"shambles"` added to the `Format` union + `FormatConfig.team_ball_count?: number` (`src/lib/scoring/types.ts`); `FORMAT_LABELS` + `DEFAULT_FORMAT_CONFIG` (`copy.ts`, shambles = gross, `team_ball_count: 1`). `computeHoleResult`'s exhaustive `switch` gained a `case "shambles"` that **throws** (team-card never uses the per-player engine — fail loud if mis-routed).
  - **Read helper:** `src/lib/round/teamScores.ts` — pure `buildTeamScoreMap` + `getTeamHoleTotal` (sum of balls = hole's team score) / `getTeamHoleBalls` / `holesScoredForTeam` (thru-N) / `getTeamTotal`. No supabase import (kept pure for testability per principle #3); the `loadTeamScores` IO read lands in C3 alongside the `results.ts` branch that uses it.

**Files:** NEW `supabase/migrations/018_phase_1b_team_scores.sql`, `src/lib/round/teamScores.ts`, `tests/lib/round/teamScores.test.ts`. MODIFIED `src/lib/scoring/types.ts`, `src/lib/scoring/engine.ts`, `src/lib/format/copy.ts`, `src/lib/format/helpers.ts`, `supabase/schema.sql` (hand-synced — see confession), `tests/lib/format/helpers.test.ts`, `STATUS.md`.

**Tests:** +18 (`isTeamCardFormat` shambles-true / every-FORMAT_ORDER-false / null; `getTeamBallCount` default/clamp/non-finite; `defaultConfigFor("shambles")` ×2; team-score aggregation ×8: count-1, count-2 sum=9, team isolation, null-for-unscored, thru-N not inflated by 2nd ball, total, duplicate-ball overwrite, empty — fixtures seeded out-of-order/multi-team so the aggregation does real work). **631/631 vitest; `tsc --noEmit` clean.**

### Today's commits

- (this session) feat(scoring): Wave 1B C1 — team-card storage spine (migration 018 + shambles registration + isTeamCardFormat/getTeamBallCount + team-score read helper)

### DB changes (today)

- **Migration 018 applied to prod** (via MCP, after read-only pre-check). Additive only: new empty `team_scores` table + extended `rounds_format_check`. **No existing round touched** — all 21 rounds keep their format; no `team_scores` rows exist. `gobs_20260607_211143.dump` remains a valid pre-1B restore point (the change is purely additive DDL).

### Tomorrow's priority

1. **Commit 2** — the NEW team-card entry surface (separate route from the individual scorecard; one team-score row per hole; count-1 one box / count-2 two boxes + summed total; dash-until-tap par-anchored; allowance control disabled; format chip + ball count). Heaviest commit — may split.
2. **Commit 3** — routing via `isTeamCardFormat` + leaderboard/summary team-row branches + season/profile exclusion (+ add `loadTeamScores` to `results.ts`); add `"shambles"` to `FORMAT_ORDER` once the surface exists.
3. **Commit 4** — `finalize_team_card_round` RPC (no blind draw) + gate at `scorecard/page.tsx:1049`; golden fixtures with the blind-draw negative control.

### Considered but not changed (confession)

- **`supabase/schema.sql` was HAND-SYNCED, not regenerated.** `npm run db:backup` needs the interactive prod connection string (a SecureString prompt) which I can't run headless. I hand-added `team_scores` across every dump section (TABLE + IDENTITY seq, PK + UNIQUE, INDEX, FK, POLICY, ROW SECURITY) mirroring `blind_draws`, and extended the inline `rounds_format_check`. It is **functionally** correct for a from-scratch rebuild, but **not byte-identical** to what `pg_dump` would emit (the dump's object ordering isn't alphabetical, so a future backup will reorder). **Action for Thomas:** run `npm run db:backup` to canonicalize `schema.sql` before the next migration. Migration `018` is the authoritative change record either way.
- **`"shambles"` deliberately omitted from `FORMAT_ORDER`.** That list is the admin FormatPicker's only source; adding shambles now would let an admin pick a format whose entry surface (C2) and routing (C3) don't exist yet — and master auto-deploys. Registered everywhere else (type, labels, defaults, classifier, DB constraint); `FORMAT_ORDER` gets it in C3.
- **`loadTeamScores` (the Supabase read) deferred to C3.** Keeping `teamScores.ts` free of the supabase client import means the pure aggregation is unit-tested without a client mock (principle #3); the IO read belongs with the `results.ts` branch that consumes it (C3) rather than shipping unused now.
- **`shambles` default config is `scoring_basis: "gross"`** (team-card is gross-only, no per-player handicap). Inert — the team-card surface sums raw strokes and never consults `getScoringBasis`/the per-player engine — but set honestly. Existing "net for every format" tests iterate `FORMAT_ORDER` (which excludes shambles), so they're unaffected.
- **No live `team_scores` round-trip / PostgREST read smoke-test yet.** The table is new + empty and the read query (`loadTeamScores`) isn't shipped until C3 — so there's no PostgREST shape to smoke-check this commit (principle #2 check deferred to C3 when the read lands). Live DDL shape WAS verified (constraint/RLS/unique/columns).
- **Out of scope (untouched):** the individual scorecard surface + its read path (C2 builds a separate surface); blind-draw behavior for individual formats (C4 only gates it OFF for team-card); the per-player engine math; the other 3 team-card formats (registration-only later); the pre-existing uncommitted `.claude/settings.local.json` + other untracked files (not mine — left unstaged).

---

## 2026-06-08 (G2 S4b — fund-reset write surface)

### Where we left off

**Admins can reset the BFB or HiO fund to $0 with a required, audited reason.** Plan-first + gated (dry-run on prod → review → apply). Payout-override edit was explicitly deferred to a separate session.

- **Migration 017 (`017_phase_g2_fund_reset.sql`) — APPLIED TO PROD** via MCP `apply_migration` after a transaction-rollback dry-run on prod:
  - `ALTER TABLE fund_transactions ADD COLUMN note text` (nullable) — holds the admin's free-text reason; `reason` stays CATEGORICAL (`'reset'`, already in `REASON_LABELS`), so loadWinnings is untouched and the 016 conventions hold.
  - `reset_fund(p_fund text, p_reason text, p_created_by text)` SECURITY DEFINER — validates `p_fund ∈ (hio,bfb)` + non-blank reason (else RAISE), recomputes the live balance **inside the txn** (no stale client read), and INSERTs ONE balancing row (`amount = -balance`, `reason='reset'`, `source='reset'` [already passed 016's CHECK], `round_id=NULL`, `created_by=COALESCE(blank→'admin')`, `note=<reason>`). Append-only; never deletes.
- **Decisions (all approved):** ① `note` column (keep `reason` categorical); ② already-$0 reset logs a harmless $0 entry (audit the action); ③ `created_by='admin'` constant (no per-user identity — shared PIN gate, matching 016's null/constant attribution); ④ reopen-after-reset can drive a balance negative — accepted as honest append-only accounting, logged as a known limitation in ROADMAP; ⑤ DangerModal extended with additive optional props (reuse, no fork).
- **UI:** `FundsPanel` gains a "Reset Fund…" button per card → `DangerModal` (title "Reset BFB/HiO Fund?", current balance, required reason input as `children`, red confirm gated by `confirmDisabled = reason empty` + the existing 1.5s delay). Success → `resetFund()` → reload → card shows $0 + "Fund reset" in Recent Transactions. `src/lib/payouts/resetFund.ts` wraps the RPC (client never writes `fund_transactions` directly — S2 RLS posture preserved).

**Dry-run (transaction → ROLLBACK, prod):** clean apply; $184→$0 with the correct ledger row; empty reason + bad fund both rejected; already-$0 re-run logs a $0 entry; blank `created_by`→'admin'. Post-rollback: `reset_fund`/`note` absent, 0 rows — prod untouched. **Post-apply verify:** RPC exists (SECURITY DEFINER, correct args), `note` column exists, **0 `fund_transactions` rows / 0 `round_payouts` rows** (migration fired no resets), balances still 0/0.

**Files:** NEW `supabase/migrations/017_phase_g2_fund_reset.sql`, `src/lib/payouts/resetFund.ts`, `tests/lib/payouts/resetFund.test.ts`. MODIFIED `src/components/winnings/FundsPanel.tsx`, `src/app/admin/components/DangerModal.tsx` (additive props), `tests/components/winnings/FundsPanel.test.tsx`, ROADMAP/STATUS.

**Tests:** +4 unit (`resetFund`: RPC name/args + trimmed reason + `created_by='admin'`; blank-reason rejected with NO rpc call; rpc-error propagates) + FundsPanel component tests rewritten (reset buttons render; modal shows balance + gates confirm on required reason — non-zero $184 negative control; confirm → `resetFund('bfb', reason)` → card refreshes to $0 + "Fund reset" entry; modal closes). **613/613 vitest; 11/11 e2e; `tsc` clean.**

### Today's commits

- (this session) feat(winnings): G2 S4b — fund-reset write surface (migration 017 + reset_fund RPC + FundsPanel reset modal)

### DB changes (today)

- **Migration 017 applied to prod** (via MCP, post dry-run + review). Verified post-apply: `reset_fund` exists (SECURITY DEFINER), `fund_transactions.note` exists, **0 fund_transactions / 0 round_payouts** (no reset fired by the migration), balances bfb 0 / hio 0. `gobs_20260607_211143.dump` remains the valid pre-migration restore point (money tables were empty before AND after — no data write).

### Tomorrow's priority

1. **G2 S4b remainder — payout-override edit** (the deferred half; needs a design pass).
2. **G2 S3** — historical payout backfill.
3. **Session 5** — Leaderboard + Round Summary payout displays.

### Considered but not changed (confession)

- **`supabase/schema.sql` not refreshed for the `note` column / `reset_fund`.** It's regenerated by `npm run db:backup` (needs the interactive connection string), which I can't run headless. The committed migration `017` is the authoritative change record; `schema.sql` will pick up the new objects on the next backup. Flagged so it's refreshed then (and re-`db:backup` before the next migration, per the runbook).
- **Reset flow not added to the Playwright e2e suite.** The spec's test plan asked for unit + component + dry-run SQL (not e2e); acceptance #6 is "e2e suite unaffected," which holds (11/11). The modal + success path are covered by the FundsPanel component tests.
- **Not live click-tested.** `/admin` is PIN-gated and local `.env.local` has no `ADMIN_PIN` (same gap as prior admin sessions) — covered by the component tests + the prod RPC dry-run/post-apply verify. `fund_balances` is $0 in prod, so a live reset would log a $0 entry.
- **`reason` carries the category, `note` the human text.** Recent Transactions shows the categorical "Fund reset" label (per mockup); the admin's free-text reason is persisted in `note` for the audit trail but not surfaced in the compact 8-row recent list. loadWinnings deliberately left untouched.
- **Out of scope (per spec, untouched):** payout-override edit modal/RPC, Edit Engine Constants, S5 displays, S3 import, the payout engine, finalize/persist paths, the `fund_balances` view, migrations 001–016, `golden.csv`, the e2e suite.
- **No fund data was altered by the migration itself** — confirmed by the post-apply 0/0 row counts.

---

## 2026-06-07 (H.2 — DB backup & restore workflow)

### Where we left off

**GOBS now has a real, tested backup story.** Free tier = no automated/PITR backups, so this is manual discipline with a verified restore path. Nothing in `src/` changed — this is tooling + docs + one committed schema artifact.

**Tooling discovered on this Windows machine:** no `pg_dump`/`psql`/Supabase CLI/Docker were installed; `winget` + node present. Server is **PostgreSQL 17.6**, so we installed **PostgreSQL 17** via `winget install -e --id PostgreSQL.PostgreSQL.17` (gives version-matched `pg_dump`/`pg_restore`/`psql` 17.10 at `C:\Program Files\PostgreSQL\17\bin` **and** a local server for restore testing).

**Snapshot mechanism — `npm run db:backup`** (`scripts/backup-db.ps1`):
- `pg_dump --format=custom --no-owner --no-privileges --schema=public` of prod → `backups/gobs_<timestamp>.dump` (gitignored; schema **+ data**; restorable).
- Then derives the committed schema artifact `supabase/schema.sql` from that dump via `pg_restore --schema-only` (no second prod hit).
- Connection string (Session Pooler, IPv4:5432) is prompted as a **SecureString**, held in memory only, scrubbed after — **never** printed, logged, or written to disk. Honors `$env:SUPABASE_DB_URL` for future automation.

**Restore verification — `npm run db:restore-test`** (`scripts/restore-test.ps1`):
- Restores the newest `.dump` into a throwaway LOCAL db `gobs_restore_test` on `127.0.0.1` (host hardcoded — **structurally cannot reach prod**), prints structure + per-table row counts, drops the test db.
- Local superuser password defaults to the winget package's `postgres` (local-only throwaway, not a prod secret).

**Base-schema artifact — `supabase/schema.sql` (committed, 34.7 KB, 1312 lines):** the missing base schema (migrations are incremental-only) is now captured as a full schema-only dump of prod's `public` (16 tables + 6 functions; **0 data rows, 0 secrets** — verified). It is **authoritative for from-scratch rebuilds**; `supabase/migrations/README.md` documents that `001`–`016` are historical change-log only and must NOT be replayed onto `schema.sql`. Closes ROADMAP **TD32** and unblocks the deferred real-DB finalize E2E (a disposable project can be seeded from it).

**Runbook — `docs/BACKUP_RESTORE.md`:** snapshot how-to, local restore-test, from-scratch rebuild path, disaster recovery (Option A: restore into a NEW project + repoint — recommended/reversible; Option B: in-place `pg_restore --clean` — destructive), the **off-machine copy reminder** (copy important `.dump`s to Google Drive/external — a backup on the same laptop doesn't survive a dead laptop), and the run-before-every-migration cadence.

### Tonight's baseline (taken + verified)

- File: `backups/gobs_20260607_211143.dump` (110.4 KB, gitignored).
- Restore-test: **PASS** — restored counts matched prod exactly: players 55 / tees 4 / holes 72 / rounds 21 / round_players 304 / scores 4968 / league_settings 2 / seasons 1 / round_payouts 0 / fund_transactions 0; 16 tables, 6 routines. Test db dropped.
- **Prod untouched:** counts + structure identical before and after the session (read-only `pg_dump`; verified via MCP).
- ⏳ **Action for you:** copy `backups/gobs_20260607_211143.dump` to Google Drive / external (off-machine).

### Today's commits

- (this session) chore(db): H.2 — manual backup/restore workflow + committed base schema (`supabase/schema.sql`)

### DB changes (today)

- **None to prod.** Read-only dump only. (Locally: created + dropped a throwaway `gobs_restore_test` during verification.)

### Tomorrow's priority

1. **Resume feature work** per the priority order (E6 admin Played With redesign, etc.). H.2 was the safety-gate blocker — now cleared.
2. **Before S4b / S3 (fund reset/override, payout backfill):** run `npm run db:backup` → `npm run db:restore-test` → off-machine copy. This is now mandatory pre-migration.
3. Optional: real-DB finalize/payout E2E (TD29 follow-up) — now seedable from `supabase/schema.sql`.

### Files (this session)

- **NEW:** `scripts/backup-db.ps1`, `scripts/restore-test.ps1`, `supabase/schema.sql` (committed base-schema artifact), `supabase/migrations/README.md`, `docs/BACKUP_RESTORE.md`.
- **MODIFIED:** `package.json` (`db:backup` + `db:restore-test` scripts), `.gitignore` (+`/backups/`), `ROADMAP.md` (H2 ✅, TD32 ✅, priority order, TD29 note), `STATUS.md`.
- **UNTOUCHED (by design):** all `src/` logic, migrations `001`–`016`, payoutEngine, finalize/persist paths, the vitest + e2e suites. The pre-existing uncommitted `src/app/admin/tabs/RoundSetup.tsx` change (not mine) was left unstaged.

### Confession (this session)

- **No credential was committed or logged.** The prod connection string was entered by you at runtime as hidden SecureString input; the backup script never prints/persists it. `supabase/schema.sql` was scanned before commit: 0 `COPY`/`INSERT` (no data), 0 password/secret/connection-string matches. `backups/` (which holds the real-data dumps) is gitignored and not staged.
- **Scope additions beyond the literal file list (all within intent):** added `supabase/migrations/README.md` to make `schema.sql`'s authority unambiguous; created TD32 in ROADMAP (no standalone base-schema item existed — it had only been described inside TD29).
- **Considered but NOT done:** a second Supabase project for restore verification (you chose local; it remains the future E2E-DB option, now seedable from `schema.sql`); automated/scheduled backups (Pro-only, explicitly out of scope).
- **Minor friction (not app issues):** PowerShell 5.1 reads `.ps1` as ANSI, so initial UTF-8 em-dashes in the scripts mangled a `Write-Host` line — fixed by making both scripts ASCII-only (smoke-tested green before the real run). The `schema "public" already exists` line during restore is a benign pg_restore warning (errors-ignored: 1), documented in the runbook.
- **Date note:** machine clock / backup timestamp is 2026-06-07; the prior STATUS entry is dated 2026-06-08 (Wave 1A, not my work). I dated this entry to the actual backup timestamp and left the Wave 1A entry untouched.

---

## 2026-06-08 (Wave 1A — handicap allowance + GHIN adjusted score + 3 scorecard bugs)

## 2026-06-08 (Wave 1A — handicap allowance + GHIN adjusted score + 3 scorecard bugs)

### Where we left off

**Wave 1A shipped as 4 commits, all on the scorecard scoring-display read-path.** A Commit-0 read-site audit (approved) drove the whole batch so "no surface lies." Two new pure helpers carry the two distinct handicap bases by design.

- **C1 (`37c9072`) — allowance storage + single read helper.** `format_config.handicap_allowance` (integer percent, default 100). `getPlayingStrokes(rawCH, allowance)` in `src/lib/scoring/handicap.ts` = `round(rawCH × allowance / 100)` (.5 up, null→null, 100%=identity) — the ONLY place the percentage is applied. `getHandicapAllowance(formatConfig)` in `src/lib/format/helpers.ts` (default 100, clamp [10,100]). Routed through every stroke-allocation read site: `results.ts` roster + blind-draw engine input; scorecard `computeHoleFor`, `buildRoundInput`, the dots, blind-draw drawn-CH. The CH **number label** stays RAW everywhere.
- **C2 (`50bd816`) — allowance UI.** Round Setup "Handicap Allowance" selector (100→10, steps of 10) in the format strip, shown once a round shell exists; writes `format_config.handicap_allowance` merging onto existing config. Pre-score → immediate write; mid-round (score exists) → existing `DangerModal`. `FormatPicker.commitSave` now preserves `handicap_allowance` across a format change (independent controls). Scorecard caption **"Handicaps at N%"** under the FORMAT chip when ≠100, orange `#c2410c`.
- **C3 (`00220ac`) — GHIN Adjusted Score (Net Double Bogey).** New pure `src/lib/scoring/adjusted.ts` (`netDoubleBogeyCap`, `computeAdjustedHoleScores`, `sumAdjusted`). Cap = par+2+strokes@**100%** — IGNORES the allowance by design (GHIN posts against full handicap). `PlayerHoleGrid` gains optional `adjScores` → orange Adj F9/Adj B9 second summary column + Adj. Tot nested under Tot (no behavior change when absent). Wired: scorecard expand, summary + `/leaderboard` drill-down (`results.ts` `PlayerRow.adjScores` → `RoundResultsView`), player profile round history (per-round Adj total; query now loads per-hole strokes + tee SI/par). Read-only; never touches competition net/ranking/payouts. `TODO(F.1)` marker left in `RoundResultsView`.
- **C4 (`a209305`) — three per-player row bugs.** Bug#2: ball labels sequential 1..N by net rank (ties→roster order), each used once — fixes the dup-"Ball 2"/no-"Ball 3" on override holes; re-ranked on the scorecard (engine returns roster order on override holes). `TODO(I16)` near the label logic. Bug#3: Net always renders when a score exists (dropped the `net !== gross` guard). Bug#1: triple-bogey notation evenly nested (28→22→16, consistent 3px gaps).

**Files:** NEW `src/lib/scoring/adjusted.ts`, `e2e/handicapAllowance.spec.ts`, `tests/lib/scoring/adjusted.test.ts`, `tests/lib/round/results-adjusted.test.ts`, `tests/components/scorecard-ball-labels.test.tsx`. MODIFIED `src/lib/scoring/{types,handicap,index}.ts`, `src/lib/format/helpers.ts`, `src/lib/round/results.ts`, `src/components/scorecard/PlayerHoleGrid.tsx`, `src/components/round/RoundResultsView.tsx`, `src/components/format/FormatPicker.tsx`, `src/app/admin/tabs/RoundSetup.tsx`, `src/app/round/[id]/scorecard/page.tsx`, `src/app/player/[id]/page.tsx`, `tests/lib/{scoring/handicap,format/helpers}.test.ts`, two PlayerRow fixtures.

**Tests:** +26 (getPlayingStrokes/getHandicapAllowance, NDB golden + negative control, results-layer adjScores golden, ball-labels Bug#2/#3) + 3 e2e (caption present@80 / absent@100; mid-round danger-modal gate + Cancel-reverts + Confirm-writes). **607/607 vitest; 11/11 e2e; `tsc --noEmit` clean.**

### Today's commits

- `37c9072` feat(handicap): Wave 1A C1 — handicap allowance storage + single read helper
- `50bd816` feat(handicap): Wave 1A C2 — allowance UI (Round Setup control + scorecard caption + recalc modal)
- `00220ac` feat(scoring): Wave 1A C3 — GHIN Adjusted Score (Net Double Bogey)
- `a209305` fix(scorecard): Wave 1A C4 — three per-player row bugs (ball labels, Net, notation)
- (trailing) test(e2e): Wave 1A — mid-round handicap-allowance danger-modal spec

### DB changes (today)

- **None.** `handicap_allowance` is an additive key inside the existing `format_config` JSONB column — no migration. All pre-1A rounds read as 100% via `getHandicapAllowance`.

### Tomorrow's priority

1. **Resume G2** — S4b (fund Reset + payout override write surfaces) / S3 (historical payout backfill) / S5 (Leaderboard + Round Summary payout displays).
2. **Live admin smoke test** of the allowance selector + mid-round recalc modal once `.env.local` has `ADMIN_PIN`. The gating + write logic is now e2e-covered against the mock (`handicapAllowanceModal.spec.ts`); this remaining step is a real-PIN visual confirmation only. (`.env.local` is gitignored — `.gitignore:45 .env*`, `git check-ignore` confirms — so a PIN can be written there safely; note the e2e suite uses its own sentinel PIN from `e2e/constants.ts`, independent of `.env.local`.)

### Considered but not changed (confession)

- **Cross-round aggregates left at 100% (approved):** `playerStats.ts` avg-net and `season/page.tsx` cumulative net read raw CH and do NOT apply the per-round allowance. They don't load `format_config`, and season-long net is conventionally full-handicap. An 80% round shows reduced net on its own surfaces (scorecard, summary, `/leaderboard` drill-down) but the player's season/profile avg-net stays full. Deliberate; flagged at audit and confirmed.
- **Allowance caption is scorecard-only.** Per C2's explicit scope + the 1A mockup. Summary / `/leaderboard` drill-down show allowance-reduced net **without** a "Handicaps at N%" caption — a possible follow-up if it reads as a surface lie in practice.
- **Adj skipped on two niche surfaces:** dropout-merged grids (post-drop holes are the drawn player's CH/SI, which wouldn't line up with the dropped player's `adjScores`) and the blind-draw pseudo-rows (`BlindDrawFillRow` / `BlindDrawPseudoPlayerSection` — no drawn-player SI/CH carried into the fill shape). Both pass no `adjScores` → no Adj column. Could be added later by threading the drawn player's SI/CH into `BlindDrawFill`.
- **Net color stays navy `#0c3057`, not orange.** The mockup tinted the always-shown Net orange as a "this is new" annotation; orange `#c2410c` is reserved (C3 locked decision) for Adj numbers only, and Net is an actual competition score. Left navy.
- **Bug #1 verified by code + ring-count unit tests, not a pixel snapshot.** The notation size change is pure arithmetic; the existing PlayerHoleGrid tests assert ring counts (unchanged) but not sizes. No Playwright snapshot added.
- **Dots-reduction Playwright assertion substituted** with `getPlayingStrokes` unit tests + live-preview no-regression on a 100% round (the self-heal recompute + hole-nav made an exact dot-count e2e brittle). The caption (present@80/absent@100) is covered by e2e.
- **Engine untouched.** Allowance is applied at READ time (engine input), not inside the engine; GHIN cap is computed outside the engine. No change to competition net, ranking, payouts, format math, the net/gross basis toggle, `course_handicap` storage, or LT1 self-heal. No per-format allow/deny list. Entry is not blocked at the GHIN cap.

---

## 2026-06-07 (TD29 — Playwright E2E harness)

### Where we left off

**Playwright E2E is live and green locally.** `npm run e2e` boots a dedicated dev server (port 3100) with a SENTINEL Supabase URL and runs 8 specs. Purely additive test infrastructure — no `src/` logic, migrations, or the vitest suite were touched.

**TEST-DATA STRATEGY (the crux) — network interception, NOT a real DB.** Decisive finding: `supabase/migrations/` is **incremental-only** (starts at "add columns to rounds"); there is **no base-schema bootstrap**, so a disposable test project / local Postgres can't be stood up from the repo alone (would need a prod schema dump first). The 5 priority bugs are client-side render/modal/wiring bugs anyway. So:
- `e2e/support/supabaseMock.ts` is an in-process PostgREST-over-HTTP shim. The dev server is handed `NEXT_PUBLIC_SUPABASE_URL = https://e2e-supabase.local` (sentinel) — it **never** receives the prod URL. Every `/rest/v1/*` + `/rpc/*` call is served from a per-test in-memory `MockDb`.
- **Prod safety is airtight + proven:** (1) sentinel env means the app can't reach prod; (2) a Playwright route aborts AND records any request containing the prod ref `crscpwbuhvpiuxdebyxm`, and the fixture **fails the test** on any such hit (`assertNoProdHits`); (3) prod `rounds`/`round_players`/`scores`/`round_payouts`/`fund_transactions` counts were captured before AND after a full run — **identical** (21 / 304 / 4968 / 0 / 0). No path exists by which an E2E finalize hits the prod fund ledger.
- HONEST CAVEAT (CLAUDE.md principle #2): mocks encode our model of PostgREST, not its real behavior — same blind spot as the vitest fake-supabase. Acceptable here because the scenarios are render-layer; NOT a substitute for real SQL/RPC testing. The finalize/payout-integrity E2E needs a real disposable DB (deferred, see below).

**Auth:** `e2e/global-setup.ts` logs in once via `/admin/login` with the throwaway PIN `0000` and saves `e2e/.auth/admin.json` storageState, reused by all specs (the homepage team-formation flow isn't admin-gated; only the calculator is).

**Specs (8, all green):**
- `calculator.spec.ts` — admin → Winnings tab → 24 players / 2-per-team renders **25/23/20/16 per player, $168 total, $0 sweep** (independently-known values, not snapshotted from prod). Proves the harness end-to-end (auth + interception + real render).
- `teamFormation.spec.ts` — the 5 render-layer scenarios: **create_new** (forms new team via the atomic RPC), **silent_join** (no modal, routes to team), **confirm_join** (asserts BOTH buttons of the two-button modal render; Cancel returns to picker with selection intact; Add writes the player), **mixed_teams_error** (⚠️ modal appears, **no silent merge** — verified team_numbers unchanged), and the homepage **empty state**.
- `buttonVisibility.spec.ts` — **Manage Team** shows pre-score and **hides after the team's first score** (with a negative-control assertion that the main scorecard render was actually reached).

### Today's commits

- (this session) test(e2e): TD29 — Playwright harness + calculator & team-formation specs

### DB changes (today)

- **None.** Test-infra-only session. Prod was never written (proven by before/after counts + the prod-ref guard).

### Tomorrow's priority

1. **TD29 follow-up (a):** CI GitHub Actions wiring — `npm ci` → `npx playwright install --with-deps chromium` → `npm run e2e`. The suite is self-contained (sentinel env baked into `playwright.config.ts`), so this should be a thin workflow file.
2. **TD29 follow-up (b) — STRETCH that was deferred:** real-DB **finalize → payout/fund** E2E. Requires a disposable Supabase project seeded from a **prod schema dump** (migrations can't reproduce base tables). Only this can validate the real `round_payouts` + `fund_transactions` writes; the network mock deliberately cannot.
3. Resume feature work: **G2 S4b** (fund Reset + payout override write surfaces) / **G2 S3** (historical payout backfill).

### Files (this session)

- **NEW:** `playwright.config.ts`; `e2e/constants.ts`, `e2e/global-setup.ts`, `e2e/support/{supabaseMock,fixtures}.ts`, `e2e/{calculator,teamFormation,buttonVisibility}.spec.ts`.
- **MODIFIED:** `package.json` (`e2e`/`e2e:ui`/`e2e:report` scripts + `@playwright/test` devDep), `.gitignore` (test-results/, playwright-report/, playwright/.cache/, e2e/.auth/), `ROADMAP.md` (TD29 → 🚧), `STATUS.md`.
- **UNTOUCHED (by design):** all `src/` app logic, the vitest suite, migrations, `payoutEngine/*`, the finalize/persist paths.

### Confession (this session)

- **Scenario-3 spec discrepancy (flagged, not "fixed"):** the prompt described the confirm_join modal as "Add X to Team N" vs "Start new team with X only". The CURRENT `JoinTeamConfirmModal` renders **"Add to Team N"** + **"Cancel"** (Cancel returns to the picker) — there is no "Start new team" button in the code. The spec asserts the REAL two buttons. I did not add the missing button (an app-logic change, out of scope). Worth deciding later whether the modal should offer the explicit "start new team" choice.
- **`tsc` covers e2e:** `tsconfig.json` `include` is `**/*.ts`, so the new e2e files are type-checked by `tsc --noEmit` (clean). Playwright transpiles specs at run time (esbuild), and the green run confirms they execute.
- **Considered but NOT done:** (a) a dedicated disposable Supabase project / local stack — rejected this session because the repo can't reproduce the schema (logged as the finalize follow-up); (b) the finalize/score-entry E2E (explicit stretch, deferred); (c) CI wiring (deferred per scope). None block the local bar.
- **Minor harness friction (not app issues):** the controlled-input PIN field needed type-then-poll (fill raced React hydration); a stale `.next/dev` cache from a killed server caused a one-off Sentry-instrumentation parse error (cleared with `rm -rf .next/dev`).

---

## 2026-06-07 (G2 S4a — read-only Winnings tab)

### Where we left off

**The admin Winnings tab exists (read-only).** Sibling tab between History and Settings, PIN-gated like the rest. Layout per `docs/payout_ui_mockups.html`: Funds + Calculator on the top row (auto-fit → stacked on mobile), Historical Payouts full-width below.

- **FundsPanel** (`src/components/winnings/FundsPanel.tsx`) — GLOBAL (no season toggle): BFB + HiO cards from the `fund_balances` view; Recent Transactions (latest 8 `fund_transactions`, newest-first, signed, friendly reason labels). **No Reset button** (S4b). Subtitle worded globally ("N contributions" / "No hole-in-one payout yet") — deviates from the mockup's "this season" text because funds are season-independent (locked decision).
- **CalculatorPanel** — pure: `players` (number input, default 24) + `team_size` (select); `balance = players × (buyIn − 3)`; calls `calculatePayouts({players, team_size, balance})` abstract and renders per-place `$/player`, total, sweep verbatim. `players < 2×team_size` → "Not enough players for a payout."
- **HistoryPanel** — season-scoped via the reused `SeasonToggle` (navy, default This season): one row per finalized round with payout rows, newest-first; header date + format + "N plyrs · M teams" + "$paid · $sweep to BFB"; stats Contributed/HiO/BFB/Balance; **Admin Override** badge when any payout row `was_overridden`; tap → per-team rows (gold rank badge for 1st; tied teams "T{place}" + 🤝); **Export CSV** (one row per team-payout) respecting season scope; empty state.
- **`src/lib/payouts/loadWinnings.ts`** (read-only): `loadFundBalances`, `loadRecentFundTransactions`, `loadWinningsHistory(seasonId, buyIn)` (round_payouts ⋈ rounds!inner ⋈ round_players for rosters/headcount; money mirrors S2), `winningsToCsv`. **`src/lib/payouts/winningsMoney.ts`** holds the pure money helpers (no supabase) so the calculator/tab don't drag in the DB client.

**Money derivation** mirrors S2 (`persistRoundPayouts.ts`, frozen): `buyIn = settings.buy_in_amount ?? "10"`; per round `contributed = headcount×buyIn`, `hio = ×1`, `bfb = ×2`, `balance = ×(buyIn−3)`; `paid = Σ total_for_team` (authoritative, from `round_payouts`); `sweepToBfb = balance − paid`. `num_teams`/`headcount` from `round_players` (payout rows only cover placing teams).

**Files:** NEW `src/app/admin/tabs/Winnings.tsx`, `src/components/winnings/{FundsPanel,CalculatorPanel,HistoryPanel}.tsx`, `src/lib/payouts/{loadWinnings,winningsMoney}.ts`, `tests/lib/payouts/loadWinnings.test.ts`, `tests/components/winnings/{CalculatorPanel,FundsPanel,HistoryPanel}.test.tsx`. MODIFIED `src/app/admin/page.tsx` (register tab + pass `settings`), `tests/lib/payoutEngine/engine.test.ts` (flake timeout), ROADMAP/STATUS.

**Tests:** 19 new (lib money math + query contracts incl. season-filter & out-of-order negative controls + CSV; Calculator matches engine incl. golden 24/2 → 25/23/20/16 + not-enough-players; Funds render/order/no-reset; History expand + override-badge-only-when-set + season-toggle filter + empty state). **581/581; `tsc` clean** (3 consecutive green runs after the flake fix).

### Today's commits

- (this session) feat(winnings): G2 S4a — read-only admin Winnings tab (funds, calculator, history)

### DB changes (today)

- **None.** Read-only session. `round_payouts` is still empty in prod (no finalized rounds since S2) → History shows its empty state live; Funds show $0.

### Tomorrow's priority

1. **G2 S4b** — fund Reset modal/RPC + payout override editing (the write surfaces; modals already in the mockup).
2. **G2 S3** — historical import/backfill of past finalized rounds' payouts.
3. **Session 5** — Leaderboard + Round Summary payout displays (mockups present).

### Considered but not changed (confession)

- **Funds subtitle wording** — global ("N contributions") rather than the mockup's "this season" (funds are season-independent per the locked decision). Approved.
- **History tie rendering** ("T{place}" + 🤝) extrapolated from the leaderboard mockup; History ties aren't explicitly drawn. Approved.
- **Buy-in for historical stats** uses the current `buy_in_amount` fallback (same reader as S2); if buy-in ever changes, past rounds' Contributed/Balance reflect the current setting (`paid` is always authoritative). Academic today (buy-in unset → $10).
- **Money constants duplicated** in `winningsMoney.ts` because `persistRoundPayouts.ts` is frozen (can't add exports). Comment pins it as the source of truth.
- **Pre-existing flake fixed (out of original scope):** the S1 engine property-fuzz test (~54k runs) intermittently crossed vitest's 5s default timeout under parallel load. Raised that one test's timeout to 20s — no behavior change. Disclosed here since it's outside the Winnings file set.
- **Not live click-tested** — `/admin` is PIN-gated and local `.env.local` has no `ADMIN_PIN` (same gap as prior admin sessions); covered by the 19 component/lib tests. `round_payouts` empty in prod anyway, so History would show the empty state live.
- **Out of scope (untouched):** `payoutEngine/*`, `golden.csv`, migration 016 objects, `persistRoundPayouts.ts`, finalize/reopen paths, Leaderboard/Summary (S5), reset/override (S4b).

---

## 2026-06-07 (G2 S2 — payout + fund persistence)

### Where we left off

**Payouts + fund movements now persist at finalize.** The frozen S1 engine is wired into the finalize flow via a new orchestration layer; nothing about the engine or `finalize_round_with_blind_draws` changed.

- **Migration `016_phase_g2_payout_persistence.sql`** (NOT yet applied to prod — gated):
  - `round_payouts` — one row per (round, placing team); ties = multiple rows at the same place; columns per the locked list + `team_size`/`total_for_team` (approved adds), `admin_override`/`was_overridden`/`original_amount`/`import_source` for S4. `UNIQUE(round_id, team_number)`; indexes on round_id + season_id. `season_id` stamped by the RPC from `rounds.season_id`.
  - `fund_transactions` — append-only ledger (`fund`, signed `amount`, `reason`, nullable `round_id` ON DELETE SET NULL, `source`, `created_by`).
  - `fund_balances` — VIEW summing the ledger per fund (global, both funds always shown).
  - `persist_round_payouts(p_round_id, p_payload jsonb)` — SECURITY DEFINER; one txn: replace round_payouts; credit funds guarded by `NOT EXISTS (… GROUP BY fund HAVING SUM<>0)` so re-runs are no-ops and post-reversal re-finalize re-credits.
  - `reverse_round_payouts(p_round_id)` — SECURITY DEFINER; appends one balancing negative per fund (`GROUP BY … HAVING SUM<>0`) and deletes payout rows. Idempotent.
  - RLS enabled; public SELECT only; no write policies → RPCs are the sole write path.
- **`src/lib/payouts/persistRoundPayouts.ts`** — `computeAndPersistRoundPayouts(roundId)`: `loadRoundResults` → derive `team_size = max roster`, `num_teams`, `players = num_teams × team_size` (so short blind-drawn teams still count — validated against round 149), `headcount = Σ rosters`, `balance = (buyIn−3) × headcount` (buyIn from `league_settings`, `?? 10`), `team_finishes` (net_score = `team.total`, basis from `isStablefordFormat`) → engine tie mode → payload. Funds: +$1/pl HiO, +$2/pl BFB, +`bfb_sweep`. `below_floor` derived (`per_player < FLOOR`; engine doesn't expose it). Funds credited even when `places_paid === 0` (whole pot sweeps).
- **Wiring:** scorecard `tryFinalizeIfAllSubmitted` (on `finalized` + `already_complete`, non-fatal) and `EditModeBanner.handleFinalize` call the orchestration; `reopenRound` calls `reverse_round_payouts` before flipping `is_complete`.

**Verification (branching needs Pro → transaction dry-run on prod, single `execute_sql`, ends in ROLLBACK):** clean DDL apply; persist→3 payout rows/3 fund rows/net $50, season stamped; persist twice→no dups; reverse→0 payout rows/net $0; reverse again→idempotent; re-finalize→recreated/net $50; `fund_balances` `bfb=34 hio=16`; ties→2 rows same place, all `is_tied`. Post-rollback check: all new objects `null`, 0 policies — **prod untouched.**

**Tests:** NEW `tests/lib/payouts/persistRoundPayouts.test.ts` (10 — normal, short-team negative control, tie, below-floor, <2 teams, Stableford sort, buy-in read, unsupported size, load-fail, rpc-error); `tests/lib/round/reopenRound.test.ts` +2 (reversal rpc fired; aborts on reverse error); `tests/components/submit-flow.test.tsx` updated (finalize-once + persist fired). **562/562; `tsc` clean.**

### Today's commits

- (this session) feat(payouts): G2 S2 — persist payouts + fund movements at finalize

### DB changes (today)

- **Migration `016` applied to prod** (via MCP `apply_migration`, after a transaction dry-run + ROLLBACK confirmed it clean). Verified post-apply: 3 tables/view + 2 functions exist, RLS on with 2 read-only policies, `round_payouts`/`fund_transactions` both **0 rows** — existing finalized rounds intentionally NOT backfilled (S3 import). `fund_balances` reads `hio=0 bfb=0`.

### Tomorrow's priority

1. **G2 S3** — historical import / backfill of past finalized rounds' payouts.
2. **G2 S4** — admin override flow (`was_overridden`/`original_amount`) + Winnings UI + fund-balance surfaces.
3. Carry-over: live admin smoke test once `.env.local` has `ADMIN_PIN`.

### Considered but not changed (confession)

- **Branch verification → dry-run on prod:** Supabase branching requires Pro (org isn't), so the approved "branch first" step became a transaction-wrapped dry-run on prod ending in ROLLBACK (approved). Persisted nothing.
- **Short-team payout semantics:** engine pays `per_player × nominal team_size`; a blind-drawn team has fewer real members. Persisted verbatim; `bfb_sweep` used as locked. How a short team's pot is physically handed out is an S4 display concern.
- **`below_floor` derived, not from engine:** frozen engine doesn't expose it on `TeamPayout`; derived as `per_player < FLOOR`.
- **Deleting a still-finalized round** won't auto-reverse funds (`round_id` → SET NULL keeps the ledger row but leaves the net credit). Safe path is reopen-then-delete; wiring `doDeleteRound` is out of scope.
- **`buy_in_amount` absent in prod** → uses the app's `?? "10"` fallback; HiO/BFB fixed at $1/$2.
- **Out of scope (per spec):** S3 backfill, S4 overrides/UI, any change to `finalize_round_with_blind_draws` or the payout engine.

---

## 2026-06-07 (G2 — payout engine logic module)

### Where we left off

**The payout engine exists as a pure logic module — no persistence, no UI (those are Sessions 2–4).** Implements `docs/PAYOUT_ENGINE.md` v3 cascade balancing. `calculatePayouts(input)` is the single public entry point with two modes:
- **Abstract (no `team_finishes`)** — returns `places_paid`, `per_player[]`, `total_paid`, `bfb_sweep`; `team_payouts` empty. Drives the future what-if calculator UI.
- **Tie-resolved (with `team_finishes`)** — sorts teams (asc best_n / desc stableford), groups ties, combines paid pots, splits evenly per player (floor), populates `team_payouts[]`, recomputes the sweep.

**Files created:**
- `src/lib/payoutEngine/constants.ts` — CAP 25 / FLOOR 5 / GAP 3→2→1 / PROPORTIONS / `targetPlacesForTeams`.
- `src/lib/payoutEngine/types.ts` — `PayoutInput` / `TeamFinish` / `PayoutResult` / `TeamPayout`. No `any`. **`places_paid` widened to `0|1|2|3|4`** (was `1|2|3|4`) so the §9 no-payout case is expressible — see confession.
- `src/lib/payoutEngine/engine.ts` — abstract calculator: §7 places-loop, §8 `build(places,gap)` (proportions → cap+redistribute → gap → cascade w/ 200-iter guard → validate), §7 Step 3 two-pass leftover spread (gap=3 then gap=1). Integer arithmetic throughout.
- `src/lib/payoutEngine/tieResolver.ts` — `resolveWithTies` + exported pure helper `splitTiedPot`.
- `src/lib/payoutEngine/index.ts` — `calculatePayouts` dispatch + re-exports.

**Tests created (101, all green):**
- `golden.test.ts` — parses read-only `golden.csv` at runtime, `it.each` over all 73 rows; exact `per_player` / `places_paid` / `bfb_sweep` + `total_paid === balance − sweep` cross-check.
- `engine.test.ts` — the four §10 worked examples (as corrected) + structural invariants + a ~54k-input property fuzz (cap/floor/order/conservation).
- `edge-cases.test.ts` — balance 0, <2 teams, single-team, 2-team capped, max compression, non-divisible remainder, 100-player <10ms perf.
- `tieResolver.test.ts` — 2/3/4-way top ties, cutoff straddle (5th doesn't back in), multi-position ties, stableford sort, no-tie mirror, `splitTiedPot` cap/floor/remainder clamps. Negative controls throughout.

**Docs corrected:** `PAYOUT_ENGINE.md` §10 Examples A (`[14,8,5]`→`[15,8,5]`, sweep 2→0) and B (`[25,22,16,10]`→`[25,22,19,11]`, sweep 8→0) — both originally skipped the Rule 6 leftover-spread step and disagreed with `golden.csv`. Dated correction notes added; golden.csv declared source of truth.

### Today's commits

- (this session) — feat(payout): G2 payout engine logic module — cascade balancing + tie resolution (pure, tested)

### DB changes (today)

- **None.** Out of scope this session (Sessions 2–4).

### Tomorrow's priority

1. **G2 Session 2** — persistence layer (`round_payouts` records) + integration with `finalize_round_with_blind_draws`. Engine is ready to call.
2. Carry-over: live admin smoke test once `.env.local` has `ADMIN_PIN`; historical backfill decision for the 5 corrected best-N rounds.

### Considered but not changed (confession)

- **`places_paid` type widened to `0|1|2|3|4`** (spec said `1|2|3|4`). The spec body (§9) mandates an empty "no payout" result for <2 teams, which the literal union can't express honestly. Widened one field rather than fake a `places_paid:1` with an empty array. Minimal, documented deviation.
- **`BETTING_RULES.md` does not exist** in the repo (a required pre-read). Searched root + all dirs — absent. The money context it would carry is self-contained in `PAYOUT_ENGINE.md` §2 (buy-in → HIO/BFB deductions → balance). Proceeded on the spec doc; flagging rather than inventing the file.
- **`splitTiedPot` cap-clamp is unreachable via the full public API** — the engine pre-caps 1st place, so the average of any subset of paid pots is ≤ CAP. The branch is retained per spec and unit-tested directly (not through `calculatePayouts`). Documented in code + test.
- **Below-floor tie splits paid as-is** (v1 limitation, per spec) — `splitTiedPot` flags `belowFloor` but does not redistribute; documented, not "fixed."
- **`@vitest/coverage-v8` devDependency added** — not in the stated file list, but AC#7 requires a measured coverage number and it's the standard vitest companion. Flagged as an addition.
- **No-payout sweep semantics:** when <2 teams, the whole balance sweeps to BFB (`bfb_sweep = balance`); when balance is 0, sweep is 0. The spec says "empty result" without specifying the sweep destination — chose BFB as the only fund the money can go to.
- **Out of scope (per spec):** all DB/migration work, UI/Storybook, `finalize_round_with_blind_draws` integration, admin overrides. Sessions 2–4.

---

## 2026-06-06 (E6 — admin Played-With redesign)

### Where we left off

**The admin Played-With tab is now three question-driven sections, not a heatmap.** Closes E6 (was blocked on H3, unblocked 2026-06-06). The legacy `played_with_matrix` full_name-keyed view is gone — every Played With surface now computes from `round_players` via one shared lib.

- **Section 1 — Player View:** `PlayerCombobox` (searchable single-select, active players, alphabetized by `getDisplayName`) → renders the egocentric four-bucket panel inline. Empty state "Pick a player to see their partners". Own season toggle.
- **Section 2 — Today's Group:** per-player cards (Recommendation A) for everyone in today's round (by `played_on === todayLocal()`, regardless of team). Each card: top-3 partners + first-5 never-paired (this season). Empty state "No round set up for today" + a button that jumps to the Round Setup tab (`onGoToRoundSetup`). Fetches the season's rows once, computes buckets per player in memory. Own season toggle.
- **Section 3 — Pair Lookup:** two comboboxes (A excludes B and vice-versa) → "N times" headline + "Last played together: {date}" + collapsible "Show all rounds" (date · Team N · format). Zero → "never played together". Own season toggle.

**Step 2–3 extractions (approved — shared lib over copy):**
- `src/lib/playedWith/compute.ts` — `fetchPlayedWithRows(seasonId)`, `computeBuckets(focalId, rpRows, allPlayers)`, `loadPlayedWith(focalId, seasonId)`, `fetchPairRounds(a, b, seasonId)` + `Partner`/`NeverPlayed`/`PlayedWithBuckets`/`PairRound` types. Byte-faithful to the shipped E5 profile compute; the profile's `loadPlayedWith` is now a thin wrapper (verified by its 4 existing tests, still green).
- `src/components/playedWith/PlayedWithPanel.tsx` — the egocentric panel + helpers moved out of the profile. `showAllNever` **internalized** as component state (dropped the two lifted props); added optional `focalPlayerName` for third-person "{name} has played with everyone" copy (profile keeps second-person "You've…").
- `src/components/season/SeasonToggle.tsx` — the pill toggle, with an `accent` prop (`green` default = profile unchanged; `navy` for admin) and optional self-hide via `hideWhenNoActiveSeason`/`activeSeason`. `SeasonFilter` type now lives here.
- `src/components/playedWith/PlayerCombobox.tsx` — NEW small searchable single-select (none existed; FormatPicker is a card list, PlayerPickerSheet is multi-select).

**Step 5 — view dropped:** verified via MCP that `played_with_matrix` was a VIEW with **no DB-side dependents**, and the only app consumer (`admin/page.tsx`) was removed this session. Migration `015_drop_played_with_matrix_view.sql` applied to prod via MCP; re-queried `still_exists = 0`.

**Files changed:**
- NEW: `src/lib/playedWith/compute.ts`, `src/components/playedWith/PlayedWithPanel.tsx`, `src/components/playedWith/PlayerCombobox.tsx`, `src/components/season/SeasonToggle.tsx`, `supabase/migrations/015_drop_played_with_matrix_view.sql`.
- REPLACED: `src/app/admin/tabs/PlayedWith.tsx` (three-section layout; old heatmap + `played_with_matrix` consumption deleted).
- `src/app/admin/page.tsx` — dropped the `played_with_matrix` fetch + `MatrixRow` type; stopped passing `matrix` to RoundSetup/PlayedWith; wired `onGoToRoundSetup`.
- `src/app/admin/tabs/RoundSetup.tsx` — removed the dead `matrix`/`MatrixRow` prop (was never used).
- `src/app/player/[id]/page.tsx` — consumes the three extracted modules; inline panel/toggle/compute removed; behavior unchanged.

**Tests:** NEW `tests/components/PlayedWithPanel.test.tsx` (4 — bucket split, focalPlayerName copy, season-scoped empty, show-all cap) + `tests/components/admin-played-with.test.tsx` (5 — Section 1 pick→buckets; Section 2 with/without a round today [date-mocked per the locked rule]; Section 3 zero pairs, multi-pair + show-all). **439 → 448/448; `tsc --noEmit` clean.**

**Live verification:** `/player/45` — extracted `PlayedWithPanel` renders all four buckets + the internalized "Show all (29)" toggle + the shared `SeasonToggle`; no console errors. `/admin` still redirects to the PIN login (route compiles, no 500). Admin tab itself not click-tested live (no local `ADMIN_PIN`) — covered by the 9 new tests.

### Today's commits

- (this session) — feat(played-with): E6 admin redesign — three sections + shared extractions; drop played_with_matrix view

### DB changes (today, not in git history)

- **Migration 015 applied** to prod via MCP: `DROP VIEW played_with_matrix`. Verified gone (`still_exists = 0`).

### Tomorrow's priority

1. **E2 / E3 / E4** — improved sortable grid (desktop secondary), tap-cell detail, stored last-played-together field — the remaining Phase E items.
2. Carry-over: live admin smoke test (D.2 + season UI + this E6 tab) once `.env.local` has `ADMIN_PIN`; historical backfill decision for the 5 corrected best-N rounds. (The stale "Played With v2" DB-layer disambiguation locked bullet is being retracted in admin cleanup per this session's note — no longer a carry-over.)

### Considered but not changed (confession)

- **Render-time disambiguation vs. locked decision #575:** the shared compute disambiguates names at render via `getDisplayName` (matching the shipped E5 profile), which contradicts the literal "#575: handle at the DB layer" bullet. Mirrored the shipped behavior for cross-surface consistency; #575 is being retracted as stale in admin cleanup (per the user's instruction this session).
- **`SeasonToggle` accent:** added a `navy` accent for the admin tab; the profile keeps `green` (default) so its render is byte-identical. No other profile change.
- **`showAllNever` internalized** into `PlayedWithPanel` (was lifted to the profile page). User-visible behavior identical; the profile's `showAllNever` state was removed.
- **Admin tab not live click-tested** — no local `ADMIN_PIN`; same gap as prior admin sessions. Covered by the 9 new component tests against a realistic fake (live-JOIN queries actually execute).
- **Out of scope (per spec):** pair-recommendation engine (I6); E2/E3; E4 stored last-played column (derived inline for now); any visual change to the profile beyond consuming the extracted components; the old desktop heatmap / mobile-search code (deleted, not ported).

---

## 2026-06-06 (E5 — Played With season filter)

### Where we left off

**The player-profile Played With card can now scope to the active season.** A small "This season / All-time" pill toggle sits to the right of the "Played With" heading (default **This season**). Closes the E5 item parked since the E1 v1 ship (d506460); unblocked by H3 (e4c2daf).

**Investigation (plan-first, approved):**
- The live JOIN + bucket computation live in one `load()` effect; buckets derive entirely from `rpRows`, so filtering `rpRows` by season scopes the 6+/3-5/1-2 buckets automatically. Never-played universe stays all active players.
- Player profile is a client component; `getActiveSeason()` returns `Season | null` with `.id`. No `--navy` token on this page — it's green-themed (`--green-700`).

**Implementation:**
- **Split** the played-with load out of the main `load()` into `loadPlayedWith(filter, seasonId)` (useCallback) + an effect keyed on `[playerId, effectiveFilter, activeSeason?.id, seasonLoaded]`, so toggling re-queries **only** the played-with data (not player/rounds/stats). The computation is byte-for-byte identical to the pre-E5 inline block, parameterized by `filter`.
- `activeSeason` loaded once on mount; `effectiveFilter = activeSeason ? seasonFilter : "all_time"`; toggle hidden + forced all-time when no active season.
- Query: when This season, adds `season_id` to the `rounds!inner` embed + `.eq("rounds.season_id", id)`.
- Empty copy: "No partners this season yet" when scoped + zero partners.
- `AccordionSection` gained an optional `headerRight` slot; `SeasonToggle` uses the page's green palette (no navy token), `aria-pressed` marks the active option.

**Bug caught in live verify (hydration error / Next "2 Issues"):** the `SeasonToggle` `<button>`s were nested inside the accordion header `<button>` (invalid HTML → hydration error). **Fixed** by restructuring the header into a flex `<div>` with **separate** title and chevron toggle buttons and `headerRight` as a sibling — no nested buttons. Live DOM confirmed `nestedButtonCount: 0`; a fresh `/player/22` load emitted no hydration errors (the lingering console errors were stale, all referencing the pre-fix `/player/45` bundle with `width:"100%"`).

**Files changed:**
- `src/app/player/[id]/page.tsx` — `getActiveSeason`/`Season` import + `SeasonFilter` type; season state; split `loadPlayedWith` callback + effect; `SeasonToggle` component; `AccordionSection` `headerRight` prop + non-nested header restructure; `PlayedWithPanel` `seasonScoped` empty-copy.
- `tests/app/player-profile-ordering.test.tsx` — added `.gt()` to its MiniFake (closes the `.gt is not a function` swallowed-error gap; the TD26 test still passes).

**Tests:** NEW `tests/app/player-profile-season-filter.test.tsx` (3): default This season shows only current-season partners (key negative control: a past-season partner is absent); switching to All-time reveals the past-season partner (re-query); no active season hides the toggle and shows all-time. **439/439; `tsc --noEmit` clean.**

**Live verification:** `/player/45` (Wayne Hashimoto) + `/player/22` (Jeff Irvin) — toggle defaults This season (green-filled), All-time outlined; tapping All-time swaps `aria-pressed` and re-queries (same data, since all 20 rounds are in the one 2026 season); green pills match the page; no new console errors.

### Today's commits

- (this session) — feat(player-profile): Played With season filter toggle (E5)

### Tomorrow's priority

1. **E6 — admin Played With redesign** (next in the active order); will deprecate the `played_with_matrix` view.
2. Carry-over: live admin smoke test (D.2 + season UI) once `.env.local` has `ADMIN_PIN`; historical backfill decision for the 5 corrected best-N rounds; retract the superseded "Played With v2" DB-layer disambiguation locked bullet.

### Considered but not changed (confession)

- **"Navy" → green palette:** the visual spec said navy selected / navy border, but the player profile has no navy token and is green-themed. Used `--green-700` (matching the page's `.btn`/`.btn-secondary`) so the toggle sits cohesively next to the green-900 heading. Flagged as a deliberate deviation.
- **Naming collision:** the user's "TD30 gap" meant the `.gt` mock gap (now fixed). ROADMAP's actual **TD30 is unrelated** (Wayne Hashimoto's tee preference) — left untouched (needs Dad's input).
- **Accordion header restructure** touched `AccordionSection` (shared by Season Stats / Round History / Played With) — necessary to avoid nested buttons. The two other accordions now also render a separate chevron button; the TD26 ordering test still passes, confirming no behavior change.
- **One-season data:** This season vs All-time currently show identical data (all 20 rounds are in the 2026 season) — the filter is verified by the unit test's two-season fixture rather than live divergence.
- **Out of scope (per spec):** E6, bucket thresholds / pill restyle, multi-season dropdown, URL persistence of the toggle, `played_with_matrix` deprecation.

---

## 2026-06-06 (season management — H3.1–H3.5)

### Where we left off

**GOBS now has seasons.** Schema, backfill, end/reopen flow, and auto-start-on-new-round all shipped together (admin needs the UI to act on the new tables, so schema+UI couldn't split). This unblocks Phase E v2 (E5 season filter, E6 admin redesign).

**Step 1 (Supabase MCP, plan-first, approved via AskUserQuestion):**
- No `seasons` table, no `rounds.season_id` — clean slate. Found **21 rounds** (ROADMAP's ~16 was stale) and **1 in-progress round (164)** — an empty abandoned shell (format null, 0 players, 0 scores). Per approval, **deleted 164** (→ 20 rounds) so the End-Season gate is clean.
- **Approved deviations from the spec:** (1) dates of record use **`todayLocal()`** (client) not server `NOW()::date` — matches the locked May-10 UTC-bug pattern; (2) `ensureRoundShell` stays **unchanged**, the wrapper sets `season_id` via a follow-up UPDATE; (3) the season-name prompt lives in the **UI** (the lib returns a `needs_season_name` signal) since a pure lib can't render a modal.

**Migration `014_phase_h3_seasons.sql` (applied to prod via MCP):**
- `seasons (id, name, started_on, ended_on NULL, is_active, created_at)`.
- Partial unique index `seasons_only_one_active` — at most one active season.
- `rounds.season_id` nullable FK.
- Backfill: created "2026 Season" (active, started 2026-01-01), attached all 20 rounds; a `DO` block aborts the migration if any `season_id` stays NULL. **Verified post-apply: 1 season, 0 null, 20 attached.**

**Files added:**
- `src/lib/seasons/{types,queries,mutations,index}.ts` — `Season`/`SeasonRound` types + `SeasonHasInProgressRounds` error; `getActiveSeason`, `listSeasons`, `listPastSeasons`, `getRoundCountForSeason`, `getInProgressRoundsForSeason`; `createSeason`, `endSeason` (throws if in-progress rounds), `reopenSeason` (pause-then-activate; partial unique index is the race guard).
- `src/lib/round/ensureSeasonAndRoundShell.ts` — season-aware wrapper + `defaultSeasonName()`.
- `src/components/season/SeasonStartModal.tsx` — auto-start name prompt (shared by homepage + Round Setup).
- `src/app/admin/components/SeasonManagement.tsx` — Current Season (name, started, round count, End Season → block modal or DangerModal) + Past Seasons (Reopen → DangerModal; copy adjusts for the no-active edge case).
- `supabase/migrations/014_phase_h3_seasons.sql`.

**Files changed:**
- `src/app/admin/tabs/Settings.tsx` — render `<SeasonManagement/>` above Money; removed the stale "Season date range" Coming-Soon placeholder.
- `src/app/page.tsx` + `src/app/admin/tabs/RoundSetup.tsx` — round creation now goes through `ensureSeasonAndRoundShell`; both show `SeasonStartModal` when no season is active (RoundSetup tracks `pendingAction` to resume Format vs Teams after naming).
- `tests/app/page-team-formation.test.tsx` — seeded an active season into the MiniFake (round creation is now season-aware) + added `.is()` support; new auto-start-prompt test.

**Tests:** `tests/lib/seasons/seasons.test.ts` (10 — queries with negative-control filters, mutations, end-of-season + reopen-toggle integration), `tests/components/SeasonManagement.test.tsx` (3). **436/436; `tsc --noEmit` clean.**

### Today's commits

- (this session) — feat(seasons): season management — schema, backfill, admin UI, auto-start (H3.1–H3.5)

### DB changes (today, not in git history)

- **Deleted round 164** (empty abandoned shell, today's date) via SQL — prep so the End-Season gate isn't blocked by junk.
- **Migration 014 applied** to prod: seasons table + index + `rounds.season_id` + 2026-Season backfill. Verified 0 null `season_id`.

### Tomorrow's priority

1. **Phase E v2 — E5 (Played With season filter)** then E6 (admin Played With redesign). Now unblocked.
2. Carry-over: live admin smoke test (D.2 + this session's season UI) once `.env.local` has `ADMIN_PIN`; historical backfill decision for the 5 corrected best-N rounds; retract the superseded "Played With v2" DB-layer disambiguation locked bullet.

### Considered but not changed (confession)

- **Admin season UI not click-tested live** — local `.env.local` has no `ADMIN_PIN`, so `/admin` redirects to login (same gap as the D.2 session). Covered by `SeasonManagement.test.tsx` + the seasons integration tests; homepage smoke-tested clean (renders, no console errors).
- **Auto-start prompt not live-tested** — prod now has an active season, so the prompt won't fire without ending it; I won't end the prod season just to test. Covered by the homepage auto-start test.
- **Reopen atomicity** — done as two sequential client UPDATEs (pause current, activate target), not an RPC transaction. Matches the spec's "index protects against races" intent and the codebase's serial-usage norm (cf. `submitted_teams`). The partial unique index makes a concurrent double-activate fail loudly; the UI shows a retry. An RPC would be strictly atomic if ever needed.
- **Spec discrepancy (reopen integration test):** the spec's wording "re-end the reopened → previous active resumes" contradicts the mutation spec (`endSeason` only deactivates; it never reactivates a prior season). Implemented per the mutation spec; tested the reopen *toggle* (reopen A→B, then B→A) instead. Flagged for a decision if auto-resume-on-end is actually wanted.
- **`rounds.season_id` follow-up UPDATE uses `.is("season_id", null)`** so an existing round keeps its original season; required adding `.is()` to the homepage test's MiniFake.
- **Out of scope (per spec):** E5/E6, `round_payouts.season_id`, season selectors on leaderboard/history/profile, BFB/HiO fund-season coupling, season-end reminder banner.

---

## 2026-06-06 (scorecard 🎲 blind-draw pseudo-rows)

### Where we left off

**The read-only scorecard now shows WHY a short team's total moved.** After the best-N blind-draw fixes (30443bc engine + 7b6c043 scorecard headline), the scorecard headline correctly included the fill but the drawn player had no row — viewers saw a moved number with no explanation. The summary already rendered a 🎲 pseudo-row; this brings the scorecard to parity. **Pure render addition; no engine change.**

**Investigation (plan-first, AskUserQuestion — user skipped, proceeded on the two Recommended options):**
- The summary's pseudo-row is `BlindDrawPseudoPlayerSection` ([RoundResultsView.tsx:529](src/components/round/RoundResultsView.tsx)) — local/non-exported, summary-styled, depends on the results.ts `BlindDrawFill` shape + `fillScoreCopy`/`rangeCopy`. Not directly reusable; a scorecard-native card matching the roster-row layout is the right move.
- The read-only scorecard is the **same render path** as live entry (`+/−` gated on `!isLocked`); rows slot in after the `roundPlayers.map` and before the nav buttons.
- **Decision 1 (scope):** dropout fills (`holeRangeStart > 1`) are **already shown** on the scorecard — merged into the dropped player's row via `fillsByRpId`, mirroring the summary. So new pseudo-rows are for **round-start fills only** (`holeRangeStart === 1`); rendering dropout fills too would duplicate. All 5 affected prod rounds are round-start; zero dropout fills exist.
- **Decision 2 (data gap):** the drawn player's **name is not in `blindDrawInputs`** (it stores `round_players.id`, and drawn players are on other teams → not in `roundPlayers`). Minimal fix: added `players(full_name)` to the **existing** `drawnRps` join inside `refreshBlindDrawInputs` (no new query) + a new `blindDrawFillRows` render state. Name disambiguated **at render time** via `getDisplayName(..., allActivePlayers)` (fresh at render; carrying `fullName` keeps it correct even for an inactive drawn player).

**Files touched:**
- `src/app/round/[id]/scorecard/page.tsx` — new module-level `BlindDrawFillRowData` type + `BlindDrawFillRow` component (muted dashed-border card, 🎲 + "Blind draw: {name}", current-hole big number, expandable `PlayerHoleGrid` with out-of-range holes blank); new `blindDrawFillRows` state; `refreshBlindDrawInputs` enriched (name join + render rows, cleared on the no-rows path); render block after the roster map filtered to `holeRangeStart === 1`.
- `tests/components/scorecard-blinddraw-row.test.tsx` — NEW, 5 tests (FakeSupabase harness): round-start fill → one 🎲 row + disambiguated "Ward C" + expanded 18-hole grid (F9/B9 = 27); pre-finalize → none; finalized no-draws → none; dropout fill (10–18) → no duplicate pseudo-row; two round-start fills → two rows. **Negative-control verified** (disabling the render fails the 2 positive tests, the 3 absence guards still pass).

**Live verification (`next-dev`, prod data):**
- `/round/101/scorecard?team=1` — 🎲 "Blind draw: Ward C" row (Kevin I + Wayne H roster), expanded grid shows Ward's scores, **headline Team Net −17 unchanged**.
- `/round/161/scorecard?team=4` — 🎲 "Blind draw: Ron L", headline −11. No console errors.

### Today's commits

- (this session) — feat(scorecard): render 🎲 blind-draw fill rows on the read-only scorecard

### Tomorrow's priority

1. **H3.x — `seasons` table + migration** — top remaining feature priority.
2. Carry-over: live admin smoke test (D.2); historical backfill decision for the 5 corrected best-N rounds; retract the superseded "Played With v2" DB-layer disambiguation locked bullet (flagged in the prior session).

### Considered but not changed (confession)

- **Dropout-fill pseudo-rows** — deliberately excluded (Decision 1): dropout fills are already shown via the existing `fillsByRpId` merge into the dropped player's row. Adding pseudo-rows for them would duplicate. No dropout fills exist in current data; if uniform pseudo-rows are ever wanted, the merge would need removing in the same change.
- **Per-hole fill-contribution highlight** — not implemented (out of scope per the issue): `PlayerHoleGrid` has no per-cell "contributing" highlight and roster rows don't either (contribution is shown at card level via Ball 1/Ball 2). The 🎲 grid renders the drawn scores like any roster grid.
- **The one data touch** — `players(full_name)` added to an existing join + a render-state array; unavoidable since the name isn't otherwise reachable from `blindDrawInputs`. No new query, no engine change.
- **Comment-placement glitch** at `scorecard/page.tsx` ~line 77 (the Phase D.2 chip comment now sits above `disambiguatedName` rather than `isHistoricalAdd`, from the prior session's edit) — left as-is to avoid unrelated churn.

---

## 2026-06-06 (display-name disambiguation — full rollout)

### Where we left off

**The naming convention now applies on every surface that renders player names.** Closes the rollout decision parked in this morning's Played With session (its Tomorrow-priority #1). Convention is unchanged and locked: first name + the *minimum* last-name suffix needed to disambiguate among **all active players**, always (even with no collision today — "Bill Carlson" → "Bill C"); derived from `full_name` only, `display_name` nicknames intentionally ignored.

**Approved decisions (plan-first, AskUserQuestion before coding):**
- **Option A** for the leaderboard/summary path — compute names in `results.ts` (the shared data layer) rather than threading raw `full_name` + roster into `RoundResultsView`. Smallest diff; RoundResultsView + both pages untouched. No DB/query-semantics change (the file already formatted names).
- Fold in the **PlayedWith mobile list** (was left raw this morning).
- Include `JoinTeamConfirmModal` + `MixedTeamsErrorModal` (found outside the original audit list).
- **Skip** the Players admin tab and the players directory page — full name is the point there.
- `display_name` override everywhere applied surfaces (no nicknames in the data → no manual-override tier needed).

**Cross-cutting design note:** the universe for `getDisplayName` must be the *full active roster* on every surface, else the same player's suffix length would differ between screens (e.g. "Bill Carl" on the leaderboard vs "Bill Ca" in a picker subset). Surfaces that only loaded a per-round subset (History, scorecard, results.ts) gained a one-off active-player fetch. New helper `buildDisplayNameMap(allPlayers)` added for convenience (not yet widely used — most sites call `getDisplayName` directly).

**Files touched:**
- `src/lib/players/displayName.ts` — added `buildDisplayNameMap` convenience (id → name Map). Helper itself unchanged.
- `src/lib/round/results.ts` — **Option A.** New active-roster fetch + `nameFor(playerId, fullName)`; applied to `playerLookup.displayName`, `rosterDisplay`, per-player `displayName`, and blind-draw `drawnPlayerName`. Drives /leaderboard + /round/[id]/summary + RoundResultsView with zero changes to those files.
- `src/app/admin/tabs/PlayedWith.tsx` — folded the mobile pairing list onto `shortName(full_name)` (desktop heatmap already shipped this morning).
- `src/app/admin/tabs/History.tsx` — added active-roster fetch (parallel with rounds) + `player_id` to the round_players select; team rosters now disambiguated.
- `src/app/page.tsx` (homepage) — `player_id` added to the team-card round_players select; team cards, create/join toasts, and `playerNamesToAdd` disambiguated; `allActivePlayers` passed to the three team-formation children.
- `src/app/season/page.tsx` — active-roster fetch + `nameFor`; leaderboard rows disambiguated.
- `src/app/player/[id]/page.tsx` — `nameOf` switched to `getDisplayName` against the active roster (partner + never-played lists). **Page title still shows the full name.**
- `src/app/round/[id]/scorecard/page.tsx` — `RoundPlayer` gains raw `full_name`; new `allActivePlayers` state loaded on mount; `display_name` is now the disambiguated short name (computed at both mapping sites via `disambiguatedName()`), so all ~15 downstream reads update automatically; ManageTeamSheet gets raw `full_name` + `allActivePlayers`.
- `src/components/teamFormation/{PlayerPickerSheet,ManageTeamSheet,JoinTeamConfirmModal,MixedTeamsErrorModal}.tsx` — each takes an optional `allActivePlayers` prop and applies `getDisplayName` against it (falls back to its locally-known players when omitted, so existing call sites/tests stay valid).
- `tests/components/teamFormation/PlayerPickerSheet.test.tsx` — updated expected names to disambiguated forms ("Alice" → "Alice A"); NEW two-Waynes collision test.
- `tests/lib/round/results-displayName.test.ts` — NEW. Drives `loadRoundResults` through the FakeSupabase harness with two Waynes + a third active player not in the round; asserts `rosterDisplay` = "Wayne H · Wayne V" and per-player names. Covers leaderboard + summary (shared path). The third player proves the universe is the full active roster.

**Live verification (`next-dev`, real prod data):**
- `/season` — shows **"Wayne V"** and **"Wayne H"**.
- `/player/45` (Wayne Hashimoto) — title stays **"Wayne Hashimoto"** (full); partner/never lists show disambiguated names incl. real collisions **"Dan G" / "Dan S"**, "Don D", "Bill T".
- No console errors. (Homepage/leaderboard had no round today → no team cards to inspect live; covered by the results.ts + PlayerPickerSheet tests. Admin History is PIN-gated locally → covered by tsc + suite.)

### Today's commits

- (this session) — feat(players): roll out display-name disambiguation to all name surfaces

### Tomorrow's priority

1. **H3.x — `seasons` table + migration** — top remaining feature priority.
2. **Scorecard fill rendering** (deferred display enhancement, from the morning best-N session).
3. Carry-over: live admin smoke test (D.2); historical backfill decision for the 5 corrected best-N rounds.

### Considered but not changed (confession)

- **Players admin tab + players directory page** — deliberately skipped (approved): full name is the editing/identity surface there.
- **Scorecard `player_name` in the write-queue payload + stale-failure dialog** — now uses the disambiguated `display_name` (it reads `rp.display_name`); acceptable/better, not a behavior regression.
- **Two active-player fetches on the scorecard** — the mount fetch (`allActivePlayers`, for row disambiguation) and the lazy `manageTeamActivePlayers` fetch (for the add flow) both hit `players`. Left as-is to keep the diff narrow and avoid touching the working Manage Team flow; could be unified later.
- **`buildDisplayNameMap`** added but most sites still call `getDisplayName` per-player — fine at 50 players (~2500 comparisons, microseconds); no caching needed per scope.
- **`results.ts:359-382` drawn-player duplication**, mixed-tee par approximation — untouched carry-over, out of scope.

---

## 2026-06-06 (best-N blind-draw — scorecard headline total)

### Where we left off

**Scorecard headline now consistent with leaderboard/summary.** Third best-N blind-draw fix of the day: 30443bc fixed the engine + the `loadRoundResults`-backed surfaces (summary, leaderboard, RoundResultsView), but the scorecard renders its headline through its own `buildRoundInput` → `computeRoundResult` call (line ~820), which omitted `blindDraws`. So a finalized short team's scorecard total stayed roster-only and disagreed with every other surface. This session plumbs the fill data into that one call. **Engine and display layer untouched — pure call-site + data-loading change.**

**Investigation (plan-first, approved before coding):**
- All headline/aggregate numbers (`getTeamTotal`, `getTeamParTotal`, F9/B9 via `getTeamNetDeltaForHoles`, `holesWithTeamScores`) funnel through `buildRoundInput`. One omission there is the whole bug. `computeHoleFor` (per-hole Ball pills / dots) deliberately left roster-only — display layer, out of scope.
- `roundPlayers`/`scores`/`holesByTee` are scoped to the **displayed team** (`?team=N`), so the drawn player's row/scores/tee-holes aren't loaded — must be fetched separately (mirrors `loadRoundResults`).
- `fillsByRpId` (the existing dropout-grid state) is **not reusable**: it loads dropout fills only (`hole_range_start > 1`), excludes round-start fills, and carries no CH/tee-holes. All 5 affected rounds are round-start fills.
- blind_draws only exist post-finalize → loading is a no-op pre-finalize; no early-return skips it.

**Files touched:**
- `src/app/round/[id]/scorecard/page.tsx` — import `BlindDrawInput`; new `blindDrawInputs` state; new self-contained `refreshBlindDrawInputs()` (re-reads team filter, scoring basis, and the drawn player's `round_players`/`scores`/`holes` from the DB — independent of render-state to avoid mount-time staleness; loads ALL fills for the team incl. round-start); called at the same 3 sites as `refreshBlindDrawFills` (mount + 2 post-finalize branches); `buildRoundInput` now passes `blindDraws: blindDrawInputs`.
- `tests/components/scorecard-blinddraw-total.test.tsx` — NEW, 2 tests via the FakeSupabase harness. Finalized single-player team + round-start fill → headline −18 (negative-control verified: with the call-site line removed the test fails, headline stays +18); pre-finalize with no blind_draws rows → headline unchanged at +18 (no-op).

**Accepted trade-offs (per approval):**
- Scorecard read-only view is now **consistent but not self-summable** for round-start fills: the headline includes the fill, but the drawn player is not rendered as a row on the scorecard (only on summary/RoundResultsView). Adding scorecard fill rendering is a deferred display enhancement.
- Mixed-tee par approximation deferred (single-tee data today).

**Live verification:** `next-dev` → `/round/101/scorecard?team=1` headline reads `Team Net −17` (F9 −8 · B9 −9), matching the leaderboard/summary. Old value was −11.

### Today's commits

- (this session) — fix(scorecard): include blind-draw fills in headline team total

### Tomorrow's priority

1. **H3.x — `seasons` table + migration** — top remaining feature priority.
2. **Scorecard fill rendering** (deferred display enhancement) — render round-start fills as a 🎲 row on the scorecard so the headline is self-summable, matching RoundResultsView's pseudo-player rows.
3. Carry-over: Played With convention rollout decision; live admin smoke test (D.2); historical backfill decision for the 5 corrected best-N rounds.

### Considered but not changed (confession)

- **`computeHoleFor` / per-hole Ball-1/Ball-2 pills** — left roster-only (display layer, out of scope). Means the per-hole BALL selection shown on the scorecard doesn't reflect the fill, consistent with how summary/RoundResultsView render the fill as a separate 🎲 element.
- **No-team-filter case** (`buildRoundInput` over all teams when `?team=` absent) — pre-existing behavior; `refreshBlindDrawInputs` only filters fills by team when `?team=N` is present. Not a real production path (scorecard links always carry `?team=N`); not addressed.
- Mixed-tee par approximation; dropout-fill scorecard scenario (no current data); `results.ts:359-382` drawn-player duplication — all carry-over, out of scope.

---

## 2026-06-06 (Played With — display-name disambiguation)

### Where we left off

**Display-name disambiguation shipped for the Played With heatmap.** New pure helper `getDisplayName(player, allPlayers, { activeOnly = true })` returns first name + the *minimum* prefix of the last name needed to tell the player apart from every same-first-name peer in the roster. Convention: "Bill Carlson" alone → "Bill C"; two Waynes → "Wayne H" / "Wayne V"; "Norm Carstairs" + "Norm Carlson" → "Norm Cars" / "Norm Carl"; single-word name → as-is; identical full names → not handled (out of concern, per spec). Recomputes on every render from the current roster — no DB storage.

**Files touched:**
- `src/lib/players/displayName.ts` — NEW. Pure function, no side effects. `PlayerLike = { id, full_name, is_active? }`. Splits first token / remainder, finds same-first-name peers (case-insensitive, excludes self by id, active-only by default), grows the last-name prefix to the first non-colliding length (capped at full last name). Handles single-word names, hyphens, apostrophes via plain string-prefix slicing; preserves original casing.
- `src/app/admin/tabs/PlayedWith.tsx` — import helper; build a `full_name → getDisplayName` Map once per render; use it for desktop heatmap **column headers** (was `name.split(" ")[0]` — the actual first-name-only bug) and **row labels** (was full "First Last"). Matrix keying / `getCount` stay on `full_name` — display only. Mobile list left unchanged.
- `tests/lib/players/displayName.test.ts` — NEW, 10 tests: the 4 convention cases, realistic GOBS roster incl. both Waynes, roster-growth (one-char grow to "Bill Ca"/"Bill Co"; true-minimal "Bill Car"/"Bill Cal"), active-only vs activeOnly:false, apostrophe/hyphen cases. Negative-control-friendly fixtures.

### Today's commits

- (this session) — feat(admin): disambiguate player names on Played With heatmap

### Tomorrow's priority

1. **Decide whether to roll the convention out to other surfaces** (see confession audit) — RoundSetup, Players, History, leaderboard rosters, round summary, scorecard, player profile. Deliberately left for a separate decision.
2. **H3.x — `seasons` table + migration** — top remaining feature priority.
3. Carry-over: best-N blind-draw scorecard headline total (2026-06-06 morning confession); live admin smoke test (D.2).

### Considered but not changed (confession)

- **Spec example imprecision flagged, not silently honored:** the issue's roster-growth example said "Bill C" → "Bill Ca" *when Bill Calderson joins*. "Carlson" and "Calderson" share "Ca", so "Bill Ca" would NOT disambiguate them — the correct minimal result is "Bill Car" / "Bill Cal". The helper implements true-minimal disambiguation; the test asserts the correct "Car"/"Cal" and separately demonstrates the one-char "Bill Ca"/"Bill Co" growth with a joiner (Cooper) that genuinely produces it.
- **Mobile Played With view** (`PlayedWith.tsx` `isMobile` branch) — left on DB `display_name || full_name`. It already shows full unambiguous names with room to spare and is not first-name-collapsed, so the bug doesn't apply. Touching it would mean choosing between the new helper and the DB column — out of scope (spec: don't change `players.display_name` behavior).
- **STEP 4 audit — other player-name surfaces, NOT changed (separate rollout decision):**
  - `admin/tabs/RoundSetup.tsx`, `admin/tabs/Players.tsx`, `admin/tabs/History.tsx` — render `full_name` / `display_name`.
  - `app/page.tsx` (homepage team rosters), `app/season/page.tsx` / leaderboard rosters.
  - `round/[id]/scorecard/page.tsx` (Manage Team / score entry), `round/[id]/summary` via `loadRoundResults` → `results.ts` (`display_name || full_name || "?"`).
  - `player/[id]/page.tsx` and `players/page.tsx` (profiles / directory).
  - Grep confirms **only** PlayedWith used the first-name-collapsing `split(" ")[0]` pattern; all others show full or DB names, so none are *broken* — rollout is a consistency choice, not a fix.

---

## 2026-06-06 (best-N blind-draw scoring — engine fix)

### Where we left off

**Best-N blind-draw scoring shipped.** Mirrors the 2026-05-26 Stableford fix, but the mechanism differs by necessity: Stableford adds drawn-player points to a separate `blindDrawTotal` accumulator (all scores count); best-N instead **injects the fill into the per-hole selection pool** so it can win or lose a "best of" spot. On override ("all scores count") holes the fill counts unconditionally — including over par (Dad confirmed: fills are full team members both ways).

**Step 1 verification (Supabase MCP, approved before coding):**
- 5 affected finalized best-N rounds with blind draws: **101** (best_ball, ovr [9,18]), **118** (best_ball, ovr [6,11]), **141** (2_ball), **147** (best_ball, ovr [12]), **161** (2_ball, ovr [9,10]). All full-18 round-start fills; all players (team + drawn) on tee 4 → uniform stroke-index allocation.
- Current (displayed) vs corrected totals and **placing impact**:
  - **101**: −11 → −17. **Round winner flips: Team 1 overtakes Team 3.**
  - 118: −4 → −3 (**worse by +1** — fill's over-par scores on override holes [6,11] count). Team 6 drops tied-4th → 5th.
  - 141: +12 → −1. Team 3 last → tied-2nd.
  - 147: +8 → +1. Same rank (still 7th); total corrected by 7.
  - 161: 0 → −11. Team 4 last → 4th.
- No payouts calculated for any of these → no dollar impact, league-placing/record impact only. **No deploy gating** (Dad's call) — corrections surface live on next deploy; Dad will communicate the 5 round changes separately.

**Files touched:**
- `src/lib/scoring/types.ts` — new `BestNFill` type; new optional `HoleInput.fills`. Updated stale `BlindDrawInput` doc (now consumed by both paths).
- `src/lib/scoring/engine.ts` — `computeBestNHole` builds a combined pool (roster `perPlayer` + fill results), runs both the override branch and best-N selection over it; selected fills land in `teamScore` + `contributingPlayerIds` (scales `teamParAtScored`) but stay out of the returned `perPlayer` (roster-only display invariant). New `resolveBestNFills` helper resolves per-hole fills using the **drawn player's own tee** stroke-index/par. Round loop injects fills for best-N only; Stableford path unchanged. Stale "best-N ignored / TODO" comment block rewritten.
- `src/lib/round/results.ts` — comment-only update (best-N now uses the pool; `total = rawTeamScore + blindDrawTotal − teamPar` formula unchanged — best-N keeps `blindDrawTotal = 0`, no double-count).
- `tests/lib/scoring/engine-bestn-blinddraw.test.ts` — NEW, 6 tests, each negative-control seeded (fail without the fix): best_ball 1-player+fill, 2_ball 3-player+fill, 3_ball 2-player+fill, mid-round dropout (1 active + dropout thru 9 + fill 10-18), override holes [9,18], and a drawn-player-own-tee net check.
- `tests/snapshots/verify-bestn-blinddraw.mjs` — NEW belt-and-suspenders script: runs the real engine over all 5 rounds before/after and asserts the deltas match the SQL replication. **All 5 ✓.**

**Audit-pass (CLAUDE.md principle #1):**
- `result.teamScore` / `contributingPlayerIds` readers: `results.ts` (rawTeamScore, legTotal par-scaling via `.length`), summary/leaderboard/RoundResultsView through `loadRoundResults`. All pick up the fix.
- `teamParAtScored` (engine.ts) scales by `contributingPlayerIds.length` — fills now in that list, so par reference scales correctly (uses the team's hole par; uniform-tee in all current data).

### Today's commits

- (this session) — feat(scoring): include blind-draw fills in best-N team totals

### Tomorrow's priority

1. **Scorecard headline total for short teams** — see confession; decide whether the live scorecard's own-team total should reflect round-start fills (currently roster-only by design; authoritative totals live on summary/leaderboard).
2. **H3.x — `seasons` table + migration** — top remaining feature priority.
3. **Historical recalculation/backfill** of the 5 corrected rounds — parked as a separate decision (was explicitly out of scope this session).

### Considered but not changed (confession)

- **Scorecard headline team total (`getTeamTotal` / `buildRoundInput` in `scorecard/page.tsx`)** does **not** pass `blindDraws`, so a finalized short team's total on the *scorecard* surface stays roster-only (round-start fills render as pseudo-player rows on the *summary*, per existing D.1 design; the scorecard's `refreshBlindDrawFills` deliberately skips `hole_range_start = 1` fills). The authoritative placing surfaces (summary / leaderboard / RoundResultsView via `loadRoundResults`) ARE corrected. Flagged not fixed — it's display-layer (explicitly out of scope) and touching the live-entry total risks pre-finalize behavior. Same gap would affect a *dropout* best-N fill's scorecard headline (none exist in current data). Decision for next session.
- **Historical backfill** of the 5 rounds — out of scope per spec; totals recompute live on read, so no DB write is strictly needed, but the round-101 winner change is a league-record event worth a deliberate sign-off.
- **`results.ts:359-382` `drawnPlayerNetValue` block** — still duplicates engine drawn-player aggregation; untouched (carry-over, out of scope).
- **Mixed-tee par reference** — `teamParAtScored` and `legTotal` use the team's hole par for fill contributors, not the drawn player's; exact for all current data (everyone on tee 4) but a latent approximation if a future fill comes from a different tee. Noted, not addressed.

---

## 2026-05-30 (A9 follow-up — tie-prompt / manual ball-override removed)

### Where we left off

**Best-N tie-prompt + manual ball-override fully removed from the live scorecard.** In 2-Ball / 3-Ball / Best Ball the scorecard always auto-picks the N best net balls per hole and resolves ties silently and deterministically (best-N by roster order). The read-only **BALL 1 / BALL 2** pills remain (informational). The amber "Tied" affordance, the tied-for-Ball banner, and the tap-to-override footer are gone.

**Investigation (plan-first, approved before coding):**
- `countingOverrides` was pure ephemeral React `useState` — never written to or read from the DB. It fed the engine live via `manualContributors` only while mounted.
- `FormatConfig` has **no** manual-contributor key. Scores persist raw strokes only; team totals are always recomputed.
- Prod check (Supabase MCP): `format_config` keys across **all** rounds are only `basis / best_n / override_holes / scoring_basis / submitted_teams`. **Zero** rounds (finalized or not) have a manual ball override on record — there is no schema location for one. → ephemeral-only end state: UI-only removal, **no migration, no finalized-round impact**.

**Files touched:**
- `src/app/round/[id]/scorecard/page.tsx` — deleted `countingOverrides` state, `getTieInfo`, `toggleOverride`, the tie banner, the interactive "Tied" pill, the override footer, the card tap-to-override `onClick` (cursor → default), the amber hole-dot override highlight, and the `manualContributors` plumbing in `computeHoleFor` / `buildRoundInput`. Kept `getCountingPlayerIds` + BALL 1/2 pills.
- `src/lib/scoring/types.ts` — comment above `HoleInput.manualContributors` marking it a retained extension point (no production caller as of 2026-05-30; exercised only by `engine-overrides.test.ts`). **Param not removed.**
- `tests/components/scorecard-tie-no-override.test.tsx` — NEW. On a 3-way net tie in a 2-Ball round: banner + footer copy absent, "Tied" pill absent, BALL 1 / BALL 2 still render.
- `tests/lib/scoring/engine-bestn.test.ts` — 3 new deterministic tie-resolution cases (three-way exact tie → first N by input order; tie for last spot → lower input index; 3-Ball three-way tie still excludes the worst ball).

**What NOT changed (confession):**
- **Engine `manualContributors` param** — retained per the approved plan (ephemeral end-state = no engine change). It's now dead-but-tested API. Optional Low-sev tech-debt: remove it from the engine + `engine-overrides.test.ts:35` if a future cleanup wants it. Not required.
- **B3.1 `override_holes`** (admin "all scores count") — untouched; `engine-overrides.test.ts` unchanged and green.
- Stableford-family formats, the best-ball selection math, RoundResultsView / summary / leaderboard (verified they don't surface the banner/footer).

**Verification:** `tsc --noEmit` clean. Full suite **397/397** green (includes new tests; note the prior 392/392 D.2 baseline grew). Verified via the new component test rather than live preview — reproducing a live 3-way net tie needs specific seeded data; the component test exercises the real component deterministically with the fake-supabase harness.

### Today's commits

- (this session) — feat(scorecard): remove tie-prompt / manual ball-override in best-N (A9)

### Tomorrow's priority

1. **Live admin smoke test** — still the carry-over from D.2: end-to-end reopen of a real finalized round, add player, edit HI, finalize.
2. **H3.x — `seasons` table + migration** — top remaining feature priority.
3. **Best-N blind-draw scoring** — engine `// TODO` still open.

### Considered but not changed (confession)

- **Removing `manualContributors` from the engine** — deliberately left per approved plan; logged above as optional Low-sev TD.
- Carry-over from prior sessions (unchanged this session): `results.ts:359-382` drawn-player duplication; best-N blind-draw scoring gap; `tests/app/player-profile-ordering.test.tsx` `.gt` mock gap.

---

## 2026-05-27 (Phase D.2 ship)

### Where we left off

**Phase D.2 fully shipped.** Admin can now reopen any finalized round from `/admin` → Round Setup → Edit Round, edit HI per-player on the scorecard, and re-finalize via the banner's "Finalize Round" button. Engine-layer math (CH recompute, blind-draw preservation, snapshot writes) covered by 27 new tests including negative controls per CLAUDE.md engineering principle #3.

**Files touched:**
- `supabase/migrations/012_phase_d2_rounds_was_finalized.sql` — new column + trigger + backfill UPDATE.
- `supabase/migrations/013_phase_d2_round_players_hi_verified.sql` — new nullable timestamp column.
- `src/lib/round/reopenRound.ts` — new helper. Read-modify-write on `format_config`; clears `submitted_teams=[]`, flips `is_complete=false`. Preserves blind_draws, scores, was_finalized.
- `src/lib/round/finalizeRoundAdmin.ts` — new helper. Single `UPDATE rounds SET is_complete=true`; latch trigger handles was_finalized.
- `src/app/admin/tabs/RoundSetup.tsx` — Edit Round button + reopen DangerModal (copy varies by blind_draws count); `loadRoundForDate` now selects `was_finalized` and counts `blind_draws`; scorecard links append `?admin=1&edit=1` when reopened.
- `src/components/round/EditModeBanner.tsx` — conditional Finalize vs Done based on `is_complete=false AND was_finalized=true` (reopened state). All other combos show Done.
- `src/app/round/[id]/scorecard/page.tsx` — `RoundPlayer` gains `created_at` + `hi_verified_at`. SELECT query updated. New `isHistoricalAdd` helper, Edit HI modal state, `openEditHiModal` / `saveEditHi` handlers. UI: Edit HI link next to HI display, HI verification chip next to player name, modal with Save + "Verify (no change)" buttons.
- `src/components/round/RoundResultsView.tsx` — removed D1.11 "Edit Round Scores" button + 4 unused imports.
- `tests/components/admin-edit-flow.test.tsx` — DELETED (covered the removed summary-page button).
- `tests/components/edit-mode-banner.test.tsx` — rewritten for the 3 conditional banner states + 3 regression tests for the in-browser-caught bug (Finalize was rendering on D1.11 edit-in-place sessions).
- `tests/lib/round/reopenRound.test.ts` — 8 unit tests including negative-control for `submitted_teams` clearing.
- `tests/lib/round/finalizeRoundAdmin.test.ts` — 4 unit tests.
- `tests/components/edit-hi-flow.test.tsx` — 8 tests: modal open, chip predicate, CH recompute (negative-control fixture seeds stale CH=99), Save + Verify, scope isolation (no `players` writes, no other-row writes).

**Preflight findings (CC spec required before code):**
1. ✅ LT1 self-heal at `scorecard/page.tsx:263` exists and is gated on `!roundIsComplete` (H.2.5.4) — but the useEffect dep is `[roundId]` only, so it does NOT re-fire on snapshot changes. Edit HI save path computes CH explicitly via `computeCourseHandicap`. Documented in `saveEditHi`.
2. ✅ `rounds.format_config` is `jsonb NOT NULL` with default shell. `submitted_teams` is an array of integers (team numbers), only present after first submit. All readers tolerate missing/empty via `Array.isArray(cfg?.submitted_teams) ? ... : []`.
3. ✅ Migration numbers 010 + 011 taken; D.2 uses 012 + 013.

**Audit-pass (CLAUDE.md principle #1, "writes must audit all reads"):**
- `was_finalized` readers: EditModeBanner (showFinalize gate), RoundSetup (link construction). Both new this session; correct under the trigger semantics.
- `hi_verified_at` readers: scorecard chip predicate (`isHistoricalAdd && verified == null`). Only render path; no other consumer yet.
- `format_config.submitted_teams` writers: scorecard `submitTeam` (read-modify-write append), reopenRound (read-modify-write clear). Race window documented at both sites; matches league usage (in-person, essentially serial).
- `round_players.handicap_index_snapshot` writers: applyTempHandicap (existing, pre-round HI entry), saveEditHi (new), Manage Team add path (insert with snapshot from `players.handicap_index`), Players.tsx admin HI edit cascade. All four paths consistent.
- `round_players.course_handicap` writers: applyTempHandicap, updatePlayerTee, LT1 self-heal (fire-and-forget at scorecard mount), saveEditHi (new). All four agree on `computeCourseHandicap(snapshot, slope, CR, par)` formula.

**DB changes applied to prod (via Supabase MCP):**
- Migration 012 applied. Backfill verified: 16 finalized rounds → 16 `was_finalized=true`. Total rounds = 16; never_finalized = 0 (all current prod rounds are finalized).
- Migration 013 applied. Verified: 198 round_player rows, all with `hi_verified_at = NULL` as expected.

**Browser verification (round 156, finalized 2026-05-27):**
- `/round/156/summary` — confirmed Edit Round Scores button is gone (D1.11 entry point removed).
- `/round/156/scorecard?team=1&admin=1&edit=1` — confirmed EditModeBanner shows **Done** (round is `is_complete=true AND was_finalized=true` → D1.11 admin edit-in-place, not reopened); 3 Edit HI links rendered (one per player); 0 verification chips (correct — all rows created on round day, predicate fails).
- Edit HI modal: opens on click, prefilled with current snapshot (20.5 for Rick C), Save and "Verify (no change)" buttons both rendered.

### Today's commits

- (this session) — feat(admin): Phase D.2 — Admin Edit Round button, HI override, Finalize/Done banner conditional

### Tomorrow's priority

1. **Live admin smoke test** — Jonathan (or Dad) does an end-to-end reopen of a real finalized round, adds a player to a new team, edits their HI, verifies CH recomputes correctly, finalizes the round. The flow has 392/392 test coverage but a hands-on click-through is worth doing once before the next live round.
2. **H3.x — `seasons` table + migration** — top remaining feature priority per 2026-05-24's lock, still gated on this manual smoke.
3. **Best-N blind-draw scoring** — engine `// TODO` from 2026-05-26 still open. Worth scoping when the next best-N round needs to include drawn players.

### Considered but not changed (confession)

- **`results.ts:359-382` `drawnPlayerNetValue` block** — still duplicating engine drawn-player aggregation per the 2026-05-26 note. Out of scope this session.
- **Admin tab end-to-end browser verification** — skipped because the local dev `.env.local` has no `ADMIN_PIN` set, so the PIN gate redirects every `/admin` hit to login. The Edit Round button is covered by 8 unit tests (reopenRound) + 4 (finalizeRoundAdmin) + 10 (EditModeBanner conditional). Worth a manual click-through next time `.env.local` is configured.
- **TD20 closure** — `withAdminFlags` is now used by RoundSetup's per-team scorecard link construction (the conditional `?admin=1&edit=1` append for reopened rounds), but I implemented it as an inline ternary rather than calling the helper, to keep the diff narrow. Worth a 1-line refactor next session if `withAdminFlags` would simplify it.
- **Best-N blind-draw scoring gap** — same engine `// TODO` from 2026-05-26; explicitly out of scope for D.2.

### Independent issues surfaced during D.2, not fixed

- **`tests/app/player-profile-ordering.test.tsx`** still logs the `.gt is not a function` mock gap from 2026-05-24. Not touched this session.
- **`tests/components/admin-edit-scorecard.test.tsx`** test at line 167 renders `<EditModeBanner />` directly without seeding `fakeRef.current` — relies on test-order side effect from prior tests in the file. Brittle; works today, would break if vitest changed isolation defaults. Worth tightening but not blocking.

---

## 2026-05-26 (evening)

### Where we left off

**Fix shipped.** Engine API change is additive (new optional input field; two new always-present output fields with `0` / `{}` defaults). Stableford team totals on `/round/[id]/summary` and the live leaderboard now include drawn-player points. Round 155 expected display after reload: Team 1 = 139, Team 2 = 129 (was 105 vs 129). No DB backfill needed — team totals are computed at read time.

**Files touched:**
- `src/lib/scoring/types.ts` — new `BlindDrawInput` type, optional `RoundInput.blindDraws`, new `RoundResult.blindDrawTotal` + `RoundResult.blindDrawPerHole`.
- `src/lib/scoring/engine.ts` — `computeRoundResult` aggregates drawn-player Stableford points (resolves the format-correct point table once at the round level; `mergePointTable(GOBS_STABLEFORD_POINTS, formatConfig.point_values)` for GOBS).
- `src/lib/round/results.ts` — builds per-team `BlindDrawInput[]` from the existing `blindDrawRows` + `playerLookup` + `scoresByRpId` + `holesByTee`. `total = rawTeamScore + blindDrawTotal − teamPar`. `legTotal()` adds `blindDrawPerHole[h]` for each hole in F9 / B9.
- `tests/lib/scoring/engine-stableford.test.ts` — three new tests + tightened existing baseline (now asserts `blindDrawTotal` defaults to 0 / `{}`).

**Audit-pass (CLAUDE.md principle #1, "writes must audit all reads"):**
- `result.teamScore` readers: `engine.ts` internal; `scorecard/page.tsx` (in-round, no blind draws yet — unchanged); `results.ts:247` (rawTeamScore). All correct under the new semantic ("team's own players only").
- `result.perHole[h].teamScore` readers: `results.ts` `legTotal()` (updated to also add `blindDrawPerHole[h]`); `scorecard/page.tsx:750,810` (in-round, unchanged). Per-hole invariant preserved.
- `team.total` readers: `rank.ts` (sort), `RoundResultsView` (display). Both pick up the fix through the new headline formula.
- `team.f9Total` / `team.b9Total` readers: `RoundResultsView`. Picks up fix via `legTotal()` change.
- `BlindDrawFill.drawnPlayerNetValue` readers: `RoundResultsView` caption. Unchanged (per-fill aggregate computed independently from per-team accumulator; both paths produce consistent numbers because both use the drawn player's own CH + tee SI).

### Today's commits

- (this session) — fix(scoring): include blind-draw points in Stableford team totals

### Tomorrow's priority

1. **Manual verification of round 155** — reload `/round/155/summary`; confirm Team 1 = 139, Team 2 = 129.
2. **Resume previous H3.x track** — `seasons` table + migration is still the top remaining feature priority per 2026-05-24's plan.
3. **Best-N blind-draw scoring** — same engine path likely has the same gap for 2-Ball / 3-Ball / Best Ball formats; engine currently silently ignores `blindDraws` for them with a `// TODO` marker. Worth scoping next time best-N rounds need to include drawn players.

### Considered but not changed (confession)

- **`results.ts:359-382` `drawnPlayerNetValue` block** — duplicates the engine's drawn-player aggregation for the per-fill caption. The new `blindDrawPerHole` lets us derive per-fill totals too, so this could be folded into the engine output. Left as-is to keep this commit narrow.
- **Best-N blind-draw scoring** — same bug shape almost certainly affects 2-Ball / 3-Ball / Best Ball; spec explicitly deferred.
- **`tee_id` mixed-tee handling** in `results.ts`'s `firstTeeId` lookup — pre-existing; not touching.

---

## 2026-05-24 (evening)

### Where we left off

**Part 1 — Admin PIN gate (D1) shipped.** `/admin` and `/admin/*` now gated behind a 4-digit PIN. Middleware on the Edge runtime (`src/middleware.ts`) checks an HMAC-SHA256-signed `admin_session` cookie (90-day expiry). Login page at `/admin/login` uses a server action (`src/app/admin/login/actions.ts`) that timing-safely compares the submitted PIN against `process.env.ADMIN_PIN`. No rate limiting per spec. Homepage Admin button unchanged. 7/7 unit tests passing on the sign/verify helpers (round-trip, tampered, expired, malformed). `tsc --noEmit` clean.

**Crucial pre-deploy step still on Jonathan:** Add `ADMIN_PIN` and `ADMIN_COOKIE_SECRET` to Vercel Production + Preview + Development environments. Without them, the deployed gate will reject every PIN with "Incorrect PIN" and the Edge runtime will log `ADMIN_PIN is not set` / `ADMIN_COOKIE_SECRET is not set` per request. Local `.env.local` is already set.

**Part 2 — Jeff Irvin White tees (DB-only, no commit).** Mental model in the spec was imprecise: there is no Wayne hardcode in code. Tee preference is stored as a per-row column `players.preferred_tee_id`. Discovered TWO Waynes — only Wayne Vincent (id=55) had `preferred_tee_id = 2` set; Wayne Hashimoto (id=45) is NULL (uses league default). Updated Jeff Irvin (id=22) `preferred_tee_id` from NULL → 2 (White) via Supabase MCP. Verified with RETURNING in same round-trip.

### Today's commits

- `8234b9e` — docs: 2026-05-24 evening doc reconciliation — D1 closed, H1 withdrawn, Phase E v2 + H3.x precursor (Part 3)
- `828bbf1` — Add admin PIN gate (D1) (Part 1)
- `d506460` — feat(player-profile): Phase E1 v1 — Played With section with four buckets (morning)
- `f04d79a` — chore: update STATUS.md for 2026-05-24 Phase E1 v1 session (morning)

### DB changes (today, not in git history)

- `UPDATE players SET preferred_tee_id = 2 WHERE id = 22` — Jeff Irvin → White tees, matches Wayne Vincent's pattern. No migration file; per-row data update, not a schema change.

### Tomorrow's priority

Per the new active-priority order locked in ROADMAP.md today (TD22 → H3.x → Phase E v2 → E2/E3/E4 → H.2 → F.1 → G):

1. **Manually add Vercel env vars** before any deploy: `ADMIN_PIN`, `ADMIN_COOKIE_SECRET` to Production + Preview (Development blocked for sensitive vars — expected; local `.env.local` covers dev). Without these the deployed /admin path is broken (rejects every PIN).
2. **Manual smoke test of the PIN gate** on `npm run dev` per the spec's 7-step checklist (clear cookies → /admin redirects → wrong PIN → see error → correct PIN → lands on /admin → refresh stays in → /admin/players direct hit redirects correctly).
3. ~~**TD22**~~ — **closed late evening 2026-05-24.** Polyfill in `tests/setup-dom.ts` rebinds `globalThis.localStorage`/`sessionStorage` from the JSDOM instance vitest exposes at `globalThis.jsdom`. Suite is **368/368** green again. Root cause was deeper than the original guess: Node 26 ships an experimental built-in `localStorage` global that returns undefined without `--localstorage-file`, and its descriptor wins against vitest's `populateGlobal` step. The `--localstorage-file` warning is gone from test output, confirming jsdom storage is now active.
4. **H3.1 — `seasons` table + migration** is the gating dep for everything in H3.x. **This is now the top remaining priority.**
5. **Small follow-up with Dad next time it comes up naturally:** Wayne Hashimoto (id=45) `preferred_tee_id` is NULL — does he actually play a specific tee, or is the league default (White/Yellow Combo) correct?
6. **Carry-over beta feedback from 2026-05-22:** confirm_join modal switch from one-button to two-button. Still outstanding.

### Doc-fix log (resolved this session, no longer carry-over)

- ✅ CLAUDE.md `played_with_matrix` schema corrected (was integer FK → now text full_name string). Caption added.
- ✅ New Engineering principle #4 added to CLAUDE.md.
- ✅ H1 withdrawn / D1 closed in ROADMAP.md.
- ✅ Phase E expanded with v2 items (E5 reframed, E6 added).
- ✅ H3.x sub-items added as season management precursor.
- ✅ Played With v2 Decisions Locked subsection added.
- ✅ **TD22 closed** — test env polyfill in `tests/setup-dom.ts` for Node 26 localStorage shadowing. Suite 368/368.

### Independent issues surfaced during TD22, not fixed

- **`tests/app/player-profile-ordering.test.tsx`** logs to stderr `supabase.from(...).select(...).eq(...).gt is not a function` — the test's supabase mock doesn't chain `.gt()` after `.eq()` for the `src/app/player/[id]/page.tsx:120` played-with query. Test passes only because the failed load is swallowed and the assertion doesn't depend on played-with data. Real coverage of that code path is missing. Worth a separate small task.
- **`DEP0205` Node deprecation** — `module.register() is deprecated. Use module.registerHooks() instead.` From vitest/vite internals on Node 26. Cosmetic; will resolve when vitest upgrades. Ignore.

---

## Previous session — 2026-05-22 (morning)

### Where we left off

Bug surfaced live this morning: Dad and Jonathan setting up teams on two phones at the same time merged into one team of 6 instead of two separate teams. Diagnosed as both concurrent race AND sequential stale-data collision on client-side team_number computation. Shipped ea04dd0: atomic team creation via Postgres RPC + picker refetch on open. Migration 011 applied to prod. Live-verified both scenarios with two devices — concurrent and sequential stale-data both produce correct sequential team numbers now. Additional manual verification: picker shows "Team N" captions for already-assigned players (refetch working), confirm_join modal fires correctly for mixed selection cases.

### Commits

- 7b490f2 — chore: resolve merge conflict in settings.local.json
- ea04dd0 — fix: atomic team creation via RPC + picker refetch on open; prevents both concurrent-device race and stale-data sequential collision

---

## Previous session — 2026-05-21

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
