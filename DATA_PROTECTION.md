# DATA_PROTECTION.md

**Purpose:** a standing register of everything that protects GOBS Golf data from loss.
Items are discussed and decided one at a time. Nothing here is committed work until its
status says so.

**Created:** 2026-07-28, after the loss of the 2026-07-27 league round.

---

## Principle (added after the 07-27 incident)

**Hardening is not recoverability.** Tests, agreement checks, migration discipline, and
type-safety reduce how often something breaks. None of them get data back once it is gone.
Every item below is tagged **PREVENT** or **RECOVER**. A plan made only of PREVENT items is
not a data protection plan.

**Second principle: a backup that has never been restored is not a backup.** The 07-27 loss
was survivable — there was a `db:backup` script, and it had been producing 0-byte files.
Nobody checked, because it exited cleanly.

---

## The incident this register exists because of

- **What:** a finalized league round (2026-07-27, ~20 players, blind draw, pots settled) was
  deleted from production.
- **When:** finalized 21:41:48 UTC 07-27; deleted before 03:20 UTC 07-28.
- **How:** the admin "Delete round" button in production. It has no guard against deleting a
  round that has scores or was already finalized.
- **Why it was fatal:** free-tier Supabase (no backups, no PITR), local dumps were 0 bytes,
  no off-platform copy, no soft delete, no audit log.
- **Recovered:** nothing. Four `fund_transactions` rows survived on `ON DELETE SET NULL` and
  confirm the round existed and its shape. Hole-by-hole scores are gone.
- **Ruled out:** scheduled jobs, database triggers, and the test suite. All confirmed unable
  to delete production rounds.

---

## Register

Status: `⬜ not discussed` · `🟡 discussed, undecided` · `✅ agreed` · `🔵 done` · `❌ declined`

### R1 — Off-platform daily backup, verified by restore — **RECOVER**
`⬜`
A real `pg_dump` on a schedule, stored somewhere that is not Supabase, that is proven to work
by actually restoring it — not by the script exiting without error. Includes a size check and
a loud failure if the dump is empty or missing.

*Why it's first:* it covers every failure mode, including the ones we haven't thought of. The
existing `db:backup` script produced 0-byte files and nobody knew.

---

### R2 — Supabase Pro daily backups — **RECOVER**
`🔵 done 2026-07-28`
Upgraded to Pro. Daily snapshots with 7-day retention, automatic, no configuration. Worst case
this loses up to 24 hours of data, which is exactly what happened on 07-27. It is a floor, not
a solution. R1 still needed.

---

### R3 — Guard the delete button — **PREVENT**
`⬜`
A round that has scores, or was ever finalized, should refuse to delete. Reopen first, or
nothing. This is the specific hole that let 07-27 happen.

---

### R4 — Soft delete plus audit log — **RECOVER**
`⬜`
Deleted rounds get flagged, not erased. A log records what was deleted, when, and from which
surface. Turns an incident like this into a five-minute undo, and answers "how did this
happen" without a forensic investigation.

*Note:* this is what would have made 07-27 a non-event.

---

### R5 — Separate the development database from production — **PREVENT**
`⬜`
Local dev (`.env.local`) and the Vercel preview both point at the single production Supabase
project. Every admin screen touched while building is the live one. A round that looks like
test data is somebody's real afternoon.

---

### R6 — Tighten row-level security — **PREVENT**
`⬜`
`rounds`, `round_players`, and `scores` currently allow all operations to the public role,
including DELETE. Anyone holding the public key can delete any round. Narrowing this closes
the widest door in the system.

---

### R7 — Backup failure alerting — **RECOVER**
`⬜`
A backup that silently stops working is worse than no backup, because it creates false
confidence. Needs to fail loudly — a notification when a backup is missing, empty, or stale.

---

### R8 — Scheduled restore drill — **RECOVER**
`⬜`
Restore a backup into a throwaway project on a regular cadence and confirm the data is intact.
The only way to know a backup works is to use it.

---

### R9 — Type-to-confirm on round deletion — **PREVENT**
`⬜`
The tournament teardown already requires typing the tournament name. The round delete uses a
1.5-second modal. Consider matching them, so the destructive action requires deliberate intent
rather than a second tap.

---

### R10 — Point-in-Time Recovery — **RECOVER**
`❌ declined 2026-07-28`
Costs hundreds per month, requires a compute add-on, and replaces daily backups. Wrong scale
for a golf league. Revisit only if R1 proves unworkable.

---

## Decision log

| Date | Item | Decision |
|------|------|----------|
| 2026-07-28 | R2 | Upgraded to Supabase Pro. Daily backups active from 07-28 onward. Not retroactive. |
| 2026-07-28 | R10 | Declined. Cost and complexity out of proportion. |
| 2026-07-28 | — | Autovacuum disabled on `rounds`, `round_players`, `scores` to preserve deleted rows pending a Supabase support response. **Must be re-enabled once that resolves.** |
| 2026-07-28 | — | Phase 4 self-serve teardown button blocked from shipping until R3 and R4 are done. |

---

## Open threads

- Supabase support ticket for dead-tuple extraction — filed 2026-07-28, low odds, no action pending.
- `GOBs Recovery` project (`dwwnzufzhglhgqkxaglb`) — delete once the ticket resolves.
- Orphaned `fund_transactions` rows 107–110 must be deleted before any rebuilt 07-27 round is
  finalized, or the pot buy-ins will be double-counted.
- Autovacuum re-enable: `ALTER TABLE <t> RESET (autovacuum_enabled)` on all three tables.
