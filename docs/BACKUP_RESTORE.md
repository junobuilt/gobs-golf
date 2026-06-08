# GOBS Golf — Database Backup & Restore Runbook

Manual, free-tier backup discipline for the production Supabase database
(project ref `crscpwbuhvpiuxdebyxm`, PostgreSQL **17**).

> **Why this exists:** the free tier has **no automated/point-in-time backups**.
> Before any migration that writes or alters production data, take a snapshot
> first. A bad migration with no backup = the league's season is gone.

---

## TL;DR

```bash
# 1. Snapshot prod (prompts for the connection string; nothing is logged)
npm run db:backup

# 2. Prove the snapshot actually restores (into a throwaway LOCAL db)
npm run db:restore-test

# 3. Copy the newest backups/*.dump OFF this laptop (Google Drive / external)
```

Run **before every data-affecting migration** (e.g. roadmap S4b fund reset/override, S3 backfill).

---

## What's in scope

- **Backed up:** the entire `public` schema — all GOBS tables (`players`,
  `tees`, `holes`, `rounds`, `round_players`, `scores`, `league_settings`,
  `seasons`, `round_payouts`, `fund_transactions`, …), their data, and the
  app's SQL functions/RPCs.
- **Not backed up (and why that's fine):** Supabase-managed schemas (`auth`,
  `storage`, etc.) and roles/extensions. A fresh Supabase project reprovisions
  these automatically. GOBS keeps all of its own objects in `public`.

## Prerequisites (already installed on the build laptop)

- **PostgreSQL 17 client tools** (`pg_dump`, `pg_restore`, `psql`) at
  `C:\Program Files\PostgreSQL\17\bin`. The dumper **must** be v17 to match the
  17.x server — an older `pg_dump` refuses to dump a newer server.
  Install/repair with: `winget install -e --id PostgreSQL.PostgreSQL.17`
- The **Session Pooler** connection string from
  **Supabase Dashboard → Settings → Database → Connection string → "Session
  pooler"** (IPv4, port 5432 — works on home networks where the direct
  IPv6-only endpoint does not, and supports `pg_dump`). Shape:
  ```
  postgresql://postgres.crscpwbuhvpiuxdebyxm:<DB-PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
  ```
  The `<DB-PASSWORD>` is set when the project was created (resettable in the
  same dashboard page). **This string is a secret** — see the rules below.

---

## Secret-handling rules (non-negotiable)

- The connection string / DB password lives **only** in your password manager
  or is pasted at runtime. It is **never** committed, never written into a
  tracked file, never echoed to logs.
- `npm run db:backup` prompts for it as hidden input and scrubs it from memory
  after the dump. It is never printed.
- The `backups/` folder is **gitignored** — its `.dump` files contain the
  league's real data and must never be committed.

---

## 1. Take a snapshot

```bash
npm run db:backup
```

You'll be prompted to paste the Session Pooler connection string (input is
hidden). It produces:

| File | Tracked? | Contents |
|---|---|---|
| `backups/gobs_<timestamp>.dump` | **gitignored** | Full schema **+ data**, custom format — the restorable backup |
| `supabase/schema.sql` | **committed** | Schema-only (no data), refreshed from the dump — the recovery/reference artifact |

If the dump fails on SSL, append `?sslmode=require` to the connection string.

### Off-machine copy (do this!)

A backup that lives only on the same laptop as the repo does **not** survive a
dead/stolen laptop. After an important snapshot (especially pre-migration),
copy `backups/gobs_<timestamp>.dump` to **Google Drive** (or an external
drive). Keep the last few; delete ancient ones.

---

## 2. Verify the snapshot restores (safe — local only)

> "A backup you've never restored isn't a backup."

```bash
npm run db:restore-test
```

This restores the newest `backups/*.dump` into a **throwaway local** database
(`gobs_restore_test` on `127.0.0.1`), prints the table/row counts, and drops
the test database. It **never** connects to prod (the host is hardcoded to
localhost). A benign `schema "public" already exists` warning during restore is
expected and ignored.

Pass a specific file with: `npm run db:restore-test -- -DumpFile backups\gobs_<timestamp>.dump`

Sanity-check the printed row counts against what you expect prod to hold.

---

## 3. The committed schema artifact & from-scratch rebuild

**`supabase/schema.sql` is the authoritative definition of the current database
structure.** It exists because the numbered migrations in
`supabase/migrations/` are **incremental only** (`001`–`016` ALTER an
already-existing base that predates migration tracking) — there is no base
`CREATE TABLE` for the core tables in the chain. See
`supabase/migrations/README.md`.

### To rebuild a database from scratch (new project / E2E test DB)

1. Create the empty Postgres/Supabase database.
2. Apply the structure:
   ```bash
   psql "<target-connection-string>" -f supabase/schema.sql
   ```
3. (Optional) Load data by restoring the latest `.dump` **data-only**:
   ```bash
   pg_restore --data-only --no-owner --no-privileges -d "<target>" backups/gobs_<timestamp>.dump
   ```

> **Do NOT** replay `migrations/001`–`016` onto `schema.sql` — they assume the
> pre-migration base and would conflict. `schema.sql` already reflects every
> migration applied to date. The numbered migrations remain only as the
> historical change log.

---

## 4. DISASTER RECOVERY — restore after a bad migration

> ⚠️ **Restoring is destructive — it overwrites data.** NEVER practice/test a
> restore against prod. Step 2 above (local) is the only place you rehearse.
> This section is for a genuine production incident only.

You ran a migration (e.g. S4b/S3) and it corrupted or deleted prod data. You
have a pre-migration `backups/gobs_<timestamp>.dump`. Two options:

### Option A — Restore into a NEW Supabase project, then repoint (safest)

Non-destructive: the damaged project is left untouched as evidence/fallback.

1. Create a new Supabase project (PostgreSQL 17).
2. `psql "<new-project-session-pooler-url>" -f supabase/schema.sql`
3. `pg_restore --data-only --no-owner --no-privileges -d "<new-project-url>" backups/gobs_<pre-migration>.dump`
4. Verify counts, then update the app's `NEXT_PUBLIC_SUPABASE_URL` /
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Vercel env + local `.env.local`) to the new
   project. Redeploy.

### Option B — In-place restore over the same prod project (faster, riskier)

Destructive to the current (broken) prod state; only if you're confident.

```bash
pg_restore --clean --if-exists --no-owner --no-privileges \
  -d "<prod-session-pooler-url>" backups/gobs_<pre-migration>.dump
```

`--clean --if-exists` drops and recreates the public objects before reloading.
Take a *fresh* dump of the broken state first (so you can't lose the only copy),
then restore. Verify row counts immediately after.

**Recommended: Option A.** It's reversible.

---

## Cadence / discipline

- **Before any data-affecting migration:** `db:backup` → `db:restore-test` →
  off-machine copy. This is the safety gate (roadmap H.2).
- **Periodically** (e.g. after a big league night) take an ad-hoc snapshot.
- Free tier = manual discipline. There is no safety net but this runbook.
