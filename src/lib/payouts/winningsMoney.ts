// Phase G2 (Session 4a) — pure money helpers for the Winnings tab.
//
// No imports (no supabase) so pure UI like the calculator can use these without
// dragging in the DB client. These MIRROR src/lib/payouts/persistRoundPayouts.ts
// (frozen this session) — it is the source of truth for what finalize persisted.

export const DEFAULT_BUY_IN = 10;
export const HIO_PER_PLAYER = 1;
export const BFB_PER_PLAYER = 2;

/** buy-in dollars from a league_settings value, with the app's "10" fallback. */
export function resolveBuyIn(settingValue: string | null | undefined): number {
  return settingValue != null && settingValue !== ""
    ? Number(settingValue)
    : DEFAULT_BUY_IN;
}

export type RoundMoney = {
  contributed: number;
  hio: number;
  bfb: number;
  balance: number;
};

/** Per-round money breakdown from headcount + buy-in (mirrors S2). */
export function deriveRoundMoney(headcount: number, buyIn: number): RoundMoney {
  return {
    contributed: headcount * buyIn,
    hio: headcount * HIO_PER_PLAYER,
    bfb: headcount * BFB_PER_PLAYER,
    balance: headcount * Math.max(0, buyIn - HIO_PER_PLAYER - BFB_PER_PLAYER),
  };
}
