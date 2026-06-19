-- Migration 030 — per-round buy-in snapshot (F2.5).
--
-- Buy-in had lived ONLY in league_settings.buy_in_amount (a single global
-- string, default "10"), read at render time. That meant every historical
-- round's money was derived from the CURRENT global — change the setting and
-- all past rounds silently recompute. This adds a per-round column so each
-- round preserves the buy-in that was in effect when it was created.
--
-- Every GOBS round to date has been a $10 buy-in (confirmed with the owner),
-- so NOT NULL DEFAULT 10 atomically backfills every existing row to its correct
-- value — no separate UPDATE needed and no uncertain rounds.
--
-- Additive + reversible. The read path (deriveRoundMoney via loadWinnings.ts)
-- switches to reading rounds.buy_in per round; ensureRoundShell stamps the
-- current global buy-in onto new rounds at creation.

BEGIN;

ALTER TABLE public.rounds
  ADD COLUMN buy_in numeric NOT NULL DEFAULT 10;

-- Rollback: ALTER TABLE public.rounds DROP COLUMN buy_in;

COMMIT;
