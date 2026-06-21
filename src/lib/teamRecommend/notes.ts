// "Why these teams?" copy builder (§9 of the multi-start spec).
//
// Pure: turns the engine's STRUCTURED result (spread / repeats / seeds /
// metBand) into 1-3 plain-language lines. Single source of truth for the copy —
// it READS the same final result object the team cards render from, never
// recomputes spread or repeat counts. No internal jargon ("band", "noveltyCost",
// "spread") and no player numbers. The modal imports this; it lives outside the
// React component so it is unit-testable without rendering.

import type { RecommendResult } from "./recommend";

export function buildNotes(result: RecommendResult): string[] {
  const spreadStr = result.spread.toFixed(1);
  const pointWord = result.spread === 1 ? "handicap point" : "handicap points";

  // Case C — no fully fair split possible (fallback, spread > band).
  if (!result.metBand) {
    return [
      "Couldn't keep every team inside the fair range with this group.",
      `Picked the fairest split available — within ${spreadStr} ${pointWord}.`,
    ];
  }

  // Case B — fair teams found, zero repeats.
  if (result.repeats === 0) {
    return [
      `Teams are within ${spreadStr} ${pointWord} — inside the fair range.`,
      "No one is grouped with a recent partner this week.",
    ];
  }

  // Case A — fair teams found, some repeats remain (most common).
  const draftWord = result.seeds === 1 ? "team draft" : "team drafts";
  const pairingWord = result.repeats === 1 ? "repeat pairing" : "repeat pairings";
  return [
    `Teams are within ${spreadStr} ${pointWord} — inside the fair range.`,
    `Compared ${result.seeds} ${draftWord} and kept the one with the fewest ${pairingWord} (${result.repeats}).`,
  ];
}
