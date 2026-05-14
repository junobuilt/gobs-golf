// D7 (locked): backoff schedule per item attempt count.
//   attempt 1 → 1s, 2 → 2s, 3 → 4s, 4 → 8s, 5 → 16s, 6 → 30s,
//   7 → 60s, 8+ → 120s steady-state forever.
// `attempts` is the post-failure count: a fresh item has attempts=0 and
// fires immediately on enqueue (backoff 0).
const SCHEDULE_MS = [0, 1000, 2000, 4000, 8000, 16000, 30000, 60000, 120000];
const STEADY_STATE_MS = 120_000;

export function backoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  if (attempts < SCHEDULE_MS.length) return SCHEDULE_MS[attempts];
  return STEADY_STATE_MS;
}

// D7 (locked): 6h of continuous failure marks the item terminal.
// Covers the "forgot to tap End Round" tail; failures surface on next app open.
export const STUCK_TOO_LONG_MS = 6 * 60 * 60 * 1000;
