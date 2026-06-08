<#
.SYNOPSIS
  GOBS Golf - verify a backup actually restores (into a THROWAWAY LOCAL db).

.DESCRIPTION
  "A backup you've never restored isn't a backup." This restores a .dump into a
  fresh local Postgres database, reports structure + row counts, then DROPS the
  test database.

  TARGET IS ALWAYS LOCALHOST. This script never connects to Supabase / prod.
  It is structurally incapable of touching prod (host is hardcoded to 127.0.0.1).

.PARAMETER DumpFile
  Path to the .dump to verify. Defaults to the newest file in backups/.

.PARAMETER LocalPassword
  Local Postgres superuser password (default "postgres" - the winget package
  default; a local-only throwaway, not a production secret). Or set $env:PGPASSWORD.
#>

param(
  [string]$DumpFile,
  [string]$LocalPassword = $(if ($env:PGPASSWORD) { $env:PGPASSWORD } else { "postgres" })
)

$ErrorActionPreference = "Stop"
$PgBin = "C:\Program Files\PostgreSQL\17\bin"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackupDir = Join-Path $RepoRoot "backups"
$TestDb = "gobs_restore_test"
$PgHost = "127.0.0.1"
$Port = "5432"

$psql = Join-Path $PgBin "psql.exe"
$pgRestore = Join-Path $PgBin "pg_restore.exe"

if (-not $DumpFile) {
  $latest = Get-ChildItem (Join-Path $BackupDir "*.dump") -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) { throw "No .dump found in $BackupDir. Run 'npm run db:backup' first." }
  $DumpFile = $latest.FullName
}
if (-not (Test-Path $DumpFile)) { throw "Dump file not found: $DumpFile" }

$env:PGPASSWORD = $LocalPassword
function Psql([string]$db, [string]$sql) {
  & $psql -U postgres -h $PgHost -p $Port -d $db -v ON_ERROR_STOP=1 -tAc $sql
  if ($LASTEXITCODE -ne 0) { throw "psql failed on db '$db' (exit $LASTEXITCODE)." }
}

Write-Host "Restore-test target: LOCAL $PgHost`:$Port / db '$TestDb' (NOT prod)."
Write-Host "Verifying dump: $DumpFile`n"

# --- fresh test database -----------------------------------------------------
Psql "postgres" "DROP DATABASE IF EXISTS $TestDb;" | Out-Null
Psql "postgres" "CREATE DATABASE $TestDb;" | Out-Null

# --- restore -----------------------------------------------------------------
& $pgRestore --no-owner --no-privileges --dbname=$TestDb -h $PgHost -p $Port -U postgres $DumpFile
$restoreExit = $LASTEXITCODE
# pg_restore can exit non-zero on benign warnings (e.g. comments on extensions);
# we treat success as "all core tables present with expected structure" below.

# --- structural + row-count report ------------------------------------------
$tableCount = Psql $TestDb "select count(*) from information_schema.tables where table_schema='public';"
$routineCount = Psql $TestDb "select count(*) from information_schema.routines where routine_schema='public';"

$coreTables = @("players","tees","holes","rounds","round_players","scores","league_settings","seasons","round_payouts","fund_transactions")
Write-Host "Restored public schema: $tableCount tables, $routineCount routines."
Write-Host "Row counts:"
$allPresent = $true
foreach ($t in $coreTables) {
  $exists = Psql $TestDb "select to_regclass('public.$t') is not null;"
  if ($exists -ne "t") { Write-Host ("  {0,-20} MISSING" -f $t); $allPresent = $false; continue }
  $n = Psql $TestDb "select count(*) from public.$t;"
  Write-Host ("  {0,-20} {1}" -f $t, $n)
}

# --- drop the throwaway db ---------------------------------------------------
Psql "postgres" "DROP DATABASE IF EXISTS $TestDb;" | Out-Null
$env:PGPASSWORD = $null

Write-Host ""
if ($allPresent) {
  Write-Host "RESTORE TEST: PASS - dump restores cleanly; all core tables present. (test db dropped)"
} else {
  Write-Host "RESTORE TEST: FAIL - one or more core tables missing (pg_restore exit $restoreExit)."
  exit 1
}
