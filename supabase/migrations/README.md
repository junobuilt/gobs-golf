# supabase/migrations — read me first

These numbered migrations (`001`–`016`) are an **incremental change log**, not a
complete schema. They `ALTER`/extend a base schema (`players`, `tees`, `holes`,
`rounds`, `round_players`, `scores`, `league_settings`, …) that was created by
hand in the Supabase dashboard **before** migration tracking began. There is no
`000_base` here — so this chain **cannot** rebuild a database from scratch on
its own.

## What's authoritative for rebuilding?

**`../schema.sql`** (one directory up) is the authoritative, current full
structure of the production `public` schema. It is regenerated from a real
`pg_dump` every time `npm run db:backup` runs, so it always reflects every
migration applied to date.

- **Rebuild from scratch / seed a fresh (e.g. E2E) DB:** apply `../schema.sql`.
  Do **not** replay `001`–`016` onto it — they assume the pre-migration base and
  would conflict.
- **New incremental change going forward:** add the next numbered migration here
  *and* re-run `npm run db:backup` afterward so `../schema.sql` stays current.

See `../../docs/BACKUP_RESTORE.md` for the full backup/restore/rebuild workflow.
