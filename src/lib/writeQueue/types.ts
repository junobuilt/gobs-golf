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
}

export type WriteClassification = "retry" | "terminal";

export type WriteResult =
  | { success: true }
  | { success: false; classification: WriteClassification; error?: unknown };

export type WriterFn = (item: QueueItem) => Promise<WriteResult>;

export interface SentryReporter {
  captureMessage(msg: string, ctx?: Record<string, unknown>): void;
  captureException(err: unknown, ctx?: Record<string, unknown>): void;
}
