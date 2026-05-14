/**
 * Phase D + E — clipboard formatting for the "Copy details" affordance.
 *
 * Phase D's single-round variant (formatStuckItemsForClipboard) renders
 * a flat list under one round header. Phase E's stale-failure prompt may
 * surface items from multiple prior rounds at once, so its formatter
 * groups items by round_id and prints a header per group.
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

export interface StaleItemForClipboard extends StuckItemForClipboard {
  round_id: number;
  round_date?: string | null;
}

export function formatStaleItemsForClipboard(items: StaleItemForClipboard[]): string {
  if (items.length === 0) return "GOBS Golf — failed sync (last session)";
  // Preserve insertion order for deterministic output; group by round_id
  // as we walk. Items from the same round stay adjacent in the input
  // (they're enqueued in scoring order), so the simple groupBy is enough.
  const groups: Array<{ round_id: number; round_date?: string | null; rows: StuckItemForClipboard[] }> = [];
  for (const item of items) {
    let group = groups.find(g => g.round_id === item.round_id);
    if (!group) {
      group = { round_id: item.round_id, round_date: item.round_date ?? null, rows: [] };
      groups.push(group);
    }
    group.rows.push(item);
    if (!group.round_date && item.round_date) group.round_date = item.round_date;
  }
  const sections: string[] = ["GOBS Golf — failed sync (last session)"];
  for (const g of groups) {
    sections.push("");
    sections.push(g.round_date ? `Round ${g.round_id} — ${g.round_date}:` : `Round ${g.round_id}:`);
    for (const row of g.rows) {
      sections.push(`  ${row.hole_label}, ${row.player_name}: ${row.strokes} strokes`);
    }
  }
  return sections.join("\n");
}
