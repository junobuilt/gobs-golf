// Option 3 / Phase B: durable, retrying, collapsing write queue for
// score upserts. See docs/option-3-write-queue-design.md for the locked
// decisions D1–D14 and rationale.
//
// This module is dependency-free of Supabase and Sentry — the writer
// function and the Sentry reporter are injected by Phase C wiring code.
// Browser globals (window, document, localStorage, navigator) are
// touched only inside instance methods so this module is safe to import
// during SSR; nothing runs until you instantiate.

import type {
  QueueItem,
  QueueItemDisplay,
  ScorePayload,
  SentryReporter,
  WriterFn,
} from "./types";
import { backoffMs, STUCK_TOO_LONG_MS } from "./backoff";
import { createStorage, type QueueStorage } from "./storage";

export interface WriteQueueOptions {
  /** Performs the actual remote write. Phase C wires this to Supabase upsert. */
  writer: WriterFn;
  /** Storage adapter. Defaults to localStorage with in-memory fallback. */
  storage?: QueueStorage;
  /** Sentry reporter for terminal failures, evictions, and crashes (D14). */
  sentry?: SentryReporter;
  /** Clock injection for tests. */
  now?: () => number;
  /** Backstop drain interval. D10. Default 30s. */
  backstopIntervalMs?: number;
  /** Stagger between hail-mary writes. D9 step 2. Default 100ms. */
  hailMaryStaggerMs?: number;
  /** Disable navigator.onLine respect — used by hail-mary path internally. */
  ignoreOnlineState?: boolean;
}

const NOOP_SENTRY: SentryReporter = {
  captureMessage: () => {},
  captureException: () => {},
};

type Listener = () => void;

export class WriteQueue {
  private items: QueueItem[] = [];
  private storage: QueueStorage;
  private writer: WriterFn;
  private sentry: SentryReporter;
  private now: () => number;
  private backstopIntervalMs: number;
  private hailMaryStaggerMs: number;
  private draining = false;
  /** A second drain request that arrived mid-pass; when set, we'll loop again. */
  private rerunHailMary = false;
  private listeners = new Set<Listener>();
  private backstopId: ReturnType<typeof setInterval> | null = null;
  private boundHandlers: {
    online?: () => void;
    visibility?: () => void;
    pageshow?: () => void;
    pagehide?: () => void;
  } = {};
  private largeQueueWarned = false;

  constructor(opts: WriteQueueOptions) {
    this.writer = opts.writer;
    this.sentry = opts.sentry ?? NOOP_SENTRY;
    this.now = opts.now ?? Date.now;
    this.backstopIntervalMs = opts.backstopIntervalMs ?? 30_000;
    this.hailMaryStaggerMs = opts.hailMaryStaggerMs ?? 100;
    this.storage =
      opts.storage ??
      createStorage({
        onEvict: (item, reason) => {
          this.sentry.captureMessage("writeQueue.evicted", {
            reason,
            item_id: item.id,
            payload: item.payload,
            state: item.state,
            attempts: item.attempts,
          });
        },
      });
    this.items = this.storage.load();
    // Items left in_flight from a previous session were cut short by tab
    // eviction. Resurrect them as pending so they retry on next drain.
    for (const item of this.items) {
      if (item.state === "in_flight") {
        item.state = "pending";
        item.next_attempt_at = this.now();
      }
    }
  }

  /** Wire up browser event listeners + backstop timer. */
  start(): void {
    if (typeof window === "undefined") return;
    const onTrigger = () => void this.drain();
    this.boundHandlers.online = onTrigger;
    this.boundHandlers.pageshow = onTrigger;
    this.boundHandlers.visibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        onTrigger();
      }
    };
    this.boundHandlers.pagehide = () => {
      // D12: best-effort pre-drain. We don't await; the browser will not
      // block on this. Anything that lands in time, lands; the rest survive
      // in localStorage for the next session.
      void this.drain();
    };
    window.addEventListener("online", this.boundHandlers.online);
    window.addEventListener("pageshow", this.boundHandlers.pageshow);
    window.addEventListener("pagehide", this.boundHandlers.pagehide);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.boundHandlers.visibility);
    }
    this.backstopId = setInterval(onTrigger, this.backstopIntervalMs);
  }

  /** Tear down listeners and timers. */
  stop(): void {
    if (typeof window !== "undefined") {
      if (this.boundHandlers.online) window.removeEventListener("online", this.boundHandlers.online);
      if (this.boundHandlers.pageshow) window.removeEventListener("pageshow", this.boundHandlers.pageshow);
      if (this.boundHandlers.pagehide) window.removeEventListener("pagehide", this.boundHandlers.pagehide);
    }
    if (this.boundHandlers.visibility && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.boundHandlers.visibility);
    }
    if (this.backstopId !== null) {
      clearInterval(this.backstopId);
      this.backstopId = null;
    }
    this.boundHandlers = {};
  }

  /**
   * Enqueue a score write, collapsing against any pending item with the
   * same (round_player_id, hole_number) key. D4. In-flight items with the
   * same key are NOT collapsed — D5 appends a fresh pending instead.
   */
  enqueue(payload: ScorePayload, display: QueueItemDisplay): void {
    const key = keyOf(payload);
    const existing = this.items.find(i => keyOf(i.payload) === key && i.state === "pending");
    if (existing) {
      existing.payload = payload;
      existing.display = display;
      existing.attempts = 0;
      existing.last_attempt_at = null;
      existing.next_attempt_at = this.now();
      this.persist();
      this.emit();
      void this.drain();
      return;
    }
    this.items.push({
      id: makeId(),
      kind: "score_upsert",
      payload,
      enqueued_at: this.now(),
      attempts: 0,
      last_attempt_at: null,
      next_attempt_at: this.now(),
      state: "pending",
      display,
    });
    this.persist();
    this.emit();
    void this.drain();
  }

  /**
   * Drain pass. `ignoreBackoff=true` is the hail-mary mode (D9 step 2).
   * If called while another drain is in progress, returns immediately;
   * if the caller asked for hail-mary, a rerun is scheduled so the
   * outstanding work still gets the override.
   */
  async drain(opts: { ignoreBackoff?: boolean } = {}): Promise<void> {
    const wantIgnore = !!opts.ignoreBackoff;
    if (this.draining) {
      if (wantIgnore) this.rerunHailMary = true;
      return;
    }
    // Respect offline state unless this is hail-mary or explicitly overridden.
    if (!wantIgnore && this.isOffline()) return;

    this.draining = true;
    let ignoreBackoff = wantIgnore;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        this.rerunHailMary = false;
        await this.drainLoop(ignoreBackoff);
        if (!this.rerunHailMary) break;
        ignoreBackoff = true;
      }
    } finally {
      this.draining = false;
    }
    this.warnIfQueueLarge();
  }

  /** Snapshot of current items. Optional filter by state. */
  getItems(filter?: { state?: QueueItem["state"] }): QueueItem[] {
    if (!filter?.state) return [...this.items];
    return this.items.filter(i => i.state === filter.state);
  }

  /**
   * Force the listed items to terminal_failure. Used by the End-Round flow
   * when the 30s hail-mary window elapses or the user taps "Skip and
   * finish" — items that didn't drain in time get surfaced via the
   * reconciliation dialog (D9) and persist as terminal so Phase E's
   * app-open prompt can find them on next mount. `reason` is logged to
   * Sentry per D14.
   */
  markAsTerminal(ids: string[], reason: string): void {
    let touched = false;
    for (const id of ids) {
      const item = this.items.find(i => i.id === id);
      if (!item) continue;
      if (item.state === "terminal_failure") continue;
      item.state = "terminal_failure";
      item.last_attempt_at = this.now();
      this.sentry.captureMessage("writeQueue.terminal_failure", {
        reason,
        item_id: item.id,
        payload: item.payload,
        attempts: item.attempts,
      });
      touched = true;
    }
    if (touched) {
      this.persist();
      this.emit();
    }
  }

  /**
   * Reset specified items (or all terminal-failure items if no ids given)
   * to pending and drain. Used by the End-Round "Retry sync" affordance
   * and the app-open stale-failure prompt's "Retry" button.
   */
  async retryTerminal(ids?: string[]): Promise<void> {
    const targetIds =
      ids ?? this.items.filter(i => i.state === "terminal_failure").map(i => i.id);
    let touched = false;
    for (const id of targetIds) {
      const item = this.items.find(i => i.id === id);
      if (!item) continue;
      item.state = "pending";
      item.attempts = 0;
      item.last_attempt_at = null;
      item.next_attempt_at = this.now();
      touched = true;
    }
    if (touched) {
      this.persist();
      this.emit();
    }
    await this.drain();
  }

  /**
   * Permanently remove items. Used by the "Forget" affordance in D9 and
   * the Phase E stale-failure prompt. Each removal is logged to Sentry
   * so we know users are abandoning data. The optional `reason` lets
   * Phase E distinguish "user_forget_stale" from other future forget
   * callsites; defaults to "forget" for backward compatibility.
   */
  forget(ids: string[], reason: string = "forget"): void {
    const removed: QueueItem[] = [];
    this.items = this.items.filter(i => {
      if (ids.includes(i.id)) {
        removed.push(i);
        return false;
      }
      return true;
    });
    if (removed.length === 0) return;
    for (const item of removed) {
      this.sentry.captureMessage("writeQueue.forget", {
        reason,
        item_id: item.id,
        payload: item.payload,
        state: item.state,
        attempts: item.attempts,
      });
    }
    this.persist();
    this.emit();
  }

  /** Subscribe to queue mutations. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** False indicates the in-memory fallback is in use (localStorage unavailable). */
  isPersistent(): boolean {
    return this.storage.isPersistent();
  }

  private async drainLoop(ignoreBackoff: boolean): Promise<void> {
    // Track which items we've already attempted in this pass. Critical for
    // hail-mary mode (ignoreBackoff=true): without this, a persistently-
    // failing item would loop forever because the filter accepts it again
    // immediately after its next_attempt_at is bumped into the future. In
    // normal mode the backoff filter already prevents re-pick, but tracking
    // here keeps the loop bounded as a defense-in-depth.
    const attemptedInThisPass = new Set<string>();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const candidates = this.items
        .filter(i => i.state === "pending")
        .filter(i => ignoreBackoff || i.next_attempt_at <= this.now())
        .filter(i => !attemptedInThisPass.has(i.id))
        .sort((a, b) => a.enqueued_at - b.enqueued_at);
      const next = candidates[0];
      if (!next) return;
      attemptedInThisPass.add(next.id);

      next.state = "in_flight";
      this.persist();
      this.emit();

      let result;
      try {
        result = await this.writer(next);
      } catch (err) {
        this.sentry.captureException(err, {
          context: "writeQueue.writer_threw",
          item_id: next.id,
        });
        result = { success: false as const, classification: "retry" as const, error: err };
      }

      if (result.success) {
        this.items = this.items.filter(i => i.id !== next.id);
      } else if (result.classification === "terminal") {
        next.state = "terminal_failure";
        next.last_attempt_at = this.now();
        // D.1: carry the known sub-reason (e.g., 'round_finalized') onto
        // the item so the stale-failure dialog can swap in specific copy.
        next.terminal_reason = result.terminalReason ?? null;
        this.sentry.captureMessage("writeQueue.terminal_failure", {
          reason: "classified_terminal",
          terminal_reason: next.terminal_reason ?? "unknown",
          item_id: next.id,
          payload: next.payload,
          attempts: next.attempts,
          error: serializeError(result.error),
        });
      } else {
        next.attempts += 1;
        next.last_attempt_at = this.now();
        if (this.now() - next.enqueued_at >= STUCK_TOO_LONG_MS) {
          next.state = "terminal_failure";
          this.sentry.captureMessage("writeQueue.terminal_failure", {
            reason: "stuck_too_long",
            item_id: next.id,
            payload: next.payload,
            attempts: next.attempts,
            age_ms: this.now() - next.enqueued_at,
          });
        } else {
          next.state = "pending";
          next.next_attempt_at = this.now() + backoffMs(next.attempts);
        }
      }
      this.persist();
      this.emit();

      if (ignoreBackoff && this.hailMaryStaggerMs > 0) {
        await new Promise(r => setTimeout(r, this.hailMaryStaggerMs));
      }
    }
  }

  private isOffline(): boolean {
    if (typeof navigator === "undefined") return false;
    return navigator.onLine === false;
  }

  private persist(): void {
    try {
      this.storage.save(this.items);
    } catch (err) {
      // Non-quota storage errors shouldn't crash the loop. Surface to
      // Sentry and continue — the queue still functions in-memory.
      this.sentry.captureException(err, { context: "writeQueue.storage_save_failed" });
    }
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch (err) {
        this.sentry.captureException(err, { context: "writeQueue.listener_threw" });
      }
    }
  }

  private warnIfQueueLarge(): void {
    // D14: log once per session per threshold crossing.
    if (!this.largeQueueWarned && this.items.length >= 100) {
      this.largeQueueWarned = true;
      this.sentry.captureMessage("writeQueue.size_threshold_exceeded", {
        size: this.items.length,
      });
    }
    if (this.items.length < 100) {
      this.largeQueueWarned = false;
    }
  }
}

function keyOf(p: ScorePayload): string {
  return `${p.round_player_id}:${p.hole_number}`;
}

function makeId(): string {
  // crypto.randomUUID is available in Node 19+, modern browsers, and jsdom.
  // Fall back to a Math.random-based UUID-ish string if absent.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `uuid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function serializeError(err: unknown): unknown {
  if (!err) return undefined;
  if (err instanceof Error) return { name: err.name, message: err.message };
  return err;
}
