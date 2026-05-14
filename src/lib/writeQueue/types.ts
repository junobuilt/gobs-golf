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
