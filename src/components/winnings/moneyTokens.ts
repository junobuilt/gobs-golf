// Shared design tokens for the admin Money area (By Player, By Round, season
// strip). Replaces the per-file raw-hex `C` objects so the three screens stay
// visually coherent. Values match the existing winnings palette so nothing
// drifts; pos/neg are verified AA-contrast on the warm row backgrounds.
//
// Contrast (WCAG AA ≥ 4.5:1 for text):
//   pos #166534 on #f5f4f0 ≈ 6.5:1 ✓   on #ffffff ≈ 6.9:1 ✓
//   neg #b91c1c on #f5f4f0 ≈ 5.9:1 ✓   on #ffffff ≈ 6.3:1 ✓

export const MONEY = {
  navyDeep: "#042C53",
  navy: "#0c3057",
  pageWarm: "#f2f1ed",
  bgWarm: "#f5f4f0",
  card: "#ffffff",
  border: "#e2e0db",
  textPri: "#1a1a1a",
  textSec: "#6b6b6b",
  textMuted: "#9a9a9a",
  pos: "#166534", // money won — green
  neg: "#b91c1c", // money lost — red
  gold: "#d4a017",
  accent: "#c2410c",
  amberBg: "#fef3c7",
  amberText: "#92400e",
  amberBorder: "#f0c869",
} as const;

/** "+$24" / "−$10" / "$0" with the correct sign glyph (true minus). */
export function signedMoney(n: number): string {
  if (n > 0) return `+$${n}`;
  if (n < 0) return `−$${Math.abs(n)}`;
  return "$0";
}

/** Token colour for a signed money value on a warm/white surface. */
export function moneyColor(n: number): string {
  if (n > 0) return MONEY.pos;
  if (n < 0) return MONEY.neg;
  return MONEY.textMuted;
}
