/**
 * Phase D — clipboard formatting for the "Copy details" affordance on the
 * second-attempt reconciliation dialog. Plain text, one row per stuck
 * write, with a header so the user can paste into a text message to the
 * admin and have it be readable.
 */

export interface StuckItemForClipboard {
  hole_label: string;
  player_name: string;
  strokes: number;
}

export function formatStuckItemsForClipboard(
  items: StuckItemForClipboard[],
  roundId: number | string,
  playedOn?: string | null,
): string {
  const headerLines = [
    "GOBS Golf — failed sync",
    playedOn ? `Round ${roundId} — ${playedOn}` : `Round ${roundId}`,
  ];
  const rows = items.map(
    item => `${item.hole_label}, ${item.player_name}: ${item.strokes} strokes`,
  );
  return [...headerLines, "", ...rows].join("\n");
}
