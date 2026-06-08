<#
.SYNOPSIS
  GOBS Golf - manual production database snapshot (free-tier, on-demand).

.DESCRIPTION
  Takes a COMPLETE, restorable backup of the production `public` schema
  (all GOBS app tables + data + functions) using pg_dump 17, and refreshes
  the committed schema-only artifact (supabase/schema.sql) from that dump.

  READ-ONLY against production: pg_dump only SELECTs. This script never
  restores, never writes to prod, and never alters prod.

  SECRET HANDLING: the connection string (which contains the DB password) is
  prompted for at runtime as a SecureString. It is held in memory only, passed
  to pg_dump, then zeroed. It is NEVER printed, logged, or written to disk.
  Do not pass it on the command line in a shared shell.

.OUTPUTS
  backups/gobs_<timestamp>.dump   (gitignored - full schema+data, custom format)
  supabase/schema.sql             (committed - schema-only, derived from the dump)

.NOTES
  Connection string: Supabase Dashboard -> Settings -> Database ->
  "Session pooler" (IPv4, port 5432, supports pg_dump). Example shape:
    postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
  Append ?sslmode=require if the dump fails on SSL.
#>

param(
  # Optional non-interactive source (env var SUPABASE_DB_URL also honored).
  # Leave unset to be prompted securely (recommended).
  [string]$DbUrl = $env:SUPABASE_DB_URL
)

$ErrorActionPreference = "Stop"
$PgBin = "C:\Program Files\PostgreSQL\17\bin"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackupDir = Join-Path $RepoRoot "backups"
$SchemaArtifact = Join-Path $RepoRoot "supabase\schema.sql"

# --- locate pg_dump / pg_restore (must be v17 to match the 17.x server) ------
$pgDump = Join-Path $PgBin "pg_dump.exe"
$pgRestore = Join-Path $PgBin "pg_restore.exe"
if (-not (Test-Path $pgDump)) { throw "pg_dump not found at $pgDump. Install PostgreSQL 17 (winget install PostgreSQL.PostgreSQL.17)." }

# --- obtain the connection string WITHOUT echoing it -------------------------
if ([string]::IsNullOrWhiteSpace($DbUrl)) {
  $secure = Read-Host -AsSecureString "Paste the Supabase Session Pooler connection string (input hidden)"
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $DbUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
if ([string]::IsNullOrWhiteSpace($DbUrl)) { throw "No connection string provided. Aborting." }

# Safety note: dumping prod is fine. This script does NOT restore anywhere.

# --- run the dump ------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$dumpFile = Join-Path $BackupDir "gobs_$stamp.dump"

Write-Host "Dumping production public schema (schema + data)..."
& $pgDump --format=custom --no-owner --no-privileges --schema=public --file=$dumpFile $DbUrl
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit $LASTEXITCODE). Check the connection string / try ?sslmode=require." }

# --- refresh the committed schema-only artifact from the dump (no 2nd prod hit)
Write-Host "Refreshing committed schema artifact: supabase/schema.sql ..."
& $pgRestore --schema-only --no-owner --no-privileges --file=$SchemaArtifact $dumpFile
if ($LASTEXITCODE -ne 0) { throw "pg_restore (schema extract) failed (exit $LASTEXITCODE)." }

# --- scrub the secret from memory --------------------------------------------
$DbUrl = $null
[System.GC]::Collect()

# --- report (paths + sizes only - NEVER the connection string) ---------------
$dumpSizeKB = [math]::Round((Get-Item $dumpFile).Length / 1KB, 1)
$schemaSizeKB = [math]::Round((Get-Item $SchemaArtifact).Length / 1KB, 1)
Write-Host ""
Write-Host "Backup complete."
Write-Host ("  Full backup (gitignored): {0}  ({1} KB)" -f $dumpFile, $dumpSizeKB)
Write-Host ("  Schema artifact (commit): {0}  ({1} KB)" -f $SchemaArtifact, $schemaSizeKB)
Write-Host ""
Write-Host "Next: verify it restores ->  npm run db:restore-test"
Write-Host "Reminder: copy the .dump off this laptop (Google Drive / external) - see docs/BACKUP_RESTORE.md."
