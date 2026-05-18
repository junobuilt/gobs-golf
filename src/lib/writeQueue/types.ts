// Public types for the write queue. Kept in a leaf module so Phase C
// can import only the types it needs from the scorecard.

export interface ScorePayload {
  round_id: number;
  round_player_id: number;
  hole_number: number;
  strokes: number;
}

export interface QueueItemDisplay {
  player_name: string;
  hole_label: string;
  /**
   * Phase E: the round's played_on date in YYYY-MM-DD form so the
   * stale-failure prompt can show which round each stuck item came from
   * without re-querying Supabase. Optional for backward compatibility
   * with items enqueued before Phase E (those fall back to formatting
   * the item's enqueued_at timestamp).
   */
  round_date?: string | null;
}

/**
 * D.1: known terminal-failure causes that the UI specializes copy for.
 * `round_finalized` is the only specialized reason today (P0001 raised by
 * the scores_reject_on_complete trigger when the parent round is locked).
 * Other terminal failures stay as null.
 */
export type TerminalReason = "round_finalized" | null;

export interface QueueItem {
  id: string;
  kind: "score_upsert";
  payload: ScorePayload;
  enqueued_at: number;
  attempts: number;
  last_attempt_at: number | null;
  next_attempt_at: number;
  state: "pending" | "in_flight" | "terminal_failure";
  display: QueueItemDisplay;
  /**
   * D.1: set when the item transitioned to terminal_failure with a known
   * cause. Used by StaleFailureDialog to swap in specific copy ("Round
   * was finalized — scores can no longer be edited") instead of the
   * generic "needs to sync" framing.
   */
  terminal_reason?: TerminalReason;
}

export type WriteClassification = "retry" | "terminal";

export type WriteResult =
  | { success: true }
  | {
      success: false;
      classification: WriteClassification;
      /** Optional sub-classification carried into QueueItem.terminal_reason. */
      terminalReason?: TerminalReason;
      error?: unknown;
    };

export type WriterFn = (item: QueueItem) => Promise<WriteResult>;

export interface SentryReporter {
  captureMessage(msg: string, ctx?: Record<string, unknown>): void;
  captureException(err: unknown, ctx?: Record<string, unknown>): void;
}
