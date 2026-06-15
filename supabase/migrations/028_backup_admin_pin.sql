-- Backup Admin PIN — expiring, self-serve substitute admin credential.
--
-- Adds two tables so the primary admin can mint a temporary 4-digit PIN with an
-- expiry (1/3/7 days) from Admin Settings, hand it to a substitute, and have it
-- auto-expire / be revoked. The PIN is stored as a PEPPERED scrypt hash (the
-- pepper is the server-only ADMIN_COOKIE_SECRET, NOT in the DB) — never
-- plaintext. Login verify + middleware re-check + audit all use the normal anon
-- client.
--
-- RLS POSTURE (deliberate): both tables get the SAME `ENABLE ROW LEVEL SECURITY
-- + "Allow all"` policy as every other table in this repo. The anon client must
-- read/write them for mint/verify/audit/revoke to work without a service-role
-- key or RPC. The stored hash is therefore anon-readable; the pepper (a secret
-- the anon reader does not hold) is what keeps a low-entropy 4-digit hash from
-- being brute-forced offline, and the expiry window is the primary control.
-- Proper lockdown (service-role-only / SECURITY DEFINER) is parked for a future
-- holistic RLS hardening pass — see ROADMAP.
--
-- Backup assessment: ADDITIVE (two NEW tables, no existing table/column/data
-- touched) and REVERSIBLE. Per the 022/027 precedent, no backup strictly
-- required; schema.sql is regenerated + committed post-apply.
--
-- Migration 028.
--
-- Rollback:
--   BEGIN;
--   DROP TABLE IF EXISTS public.admin_backup_audit;
--   DROP TABLE IF EXISTS public.admin_backup_pin;
--   COMMIT;

BEGIN;

-- 1. admin_backup_pin — single active credential at a time (the app supersedes
--    the prior active row on mint). History rows are retained (revoked_at set).
CREATE TABLE public.admin_backup_pin (
  id         bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  pin_hash   text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX admin_backup_pin_active_idx
  ON public.admin_backup_pin (expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.admin_backup_pin ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on admin_backup_pin"
  ON public.admin_backup_pin USING (true) WITH CHECK (true);

-- 2. admin_backup_audit — one row per successful backup login (R5).
CREATE TABLE public.admin_backup_audit (
  id            bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  credential_id bigint REFERENCES public.admin_backup_pin(id) ON DELETE SET NULL,
  logged_in_at  timestamptz NOT NULL DEFAULT now(),
  ip            text,
  user_agent    text
);
CREATE INDEX admin_backup_audit_cred_idx
  ON public.admin_backup_audit (credential_id);

ALTER TABLE public.admin_backup_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on admin_backup_audit"
  ON public.admin_backup_audit USING (true) WITH CHECK (true);

COMMIT;
