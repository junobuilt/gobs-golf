// @vitest-environment jsdom
/**
 * WriteQueue behavioral tests covering the testing-surface section of
 * docs/option-3-write-queue-design.md. Uses fake timers for backoff
 * verification and a vi.fn writer so we can script outcomes per call.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WriteQueue } from "@/lib/writeQueue/WriteQueue";
import { createStorage } from "@/lib/writeQueue/storage";
import { backoffMs } from "@/lib/writeQueue/backoff";
import type { QueueItem, ScorePayload, WriteResult } from "@/lib/writeQueue/types";

function payload(rp: number, hole: number, strokes: number): ScorePayload {
  return { round_id: 1, round_player_id: rp, hole_number: hole, strokes };
}
const display = { player_name: "P", hole_label: "Hole" };

function makeQueue(opts: {
  writer?: (item: QueueItem) => Promise<WriteResult>;
  now?: () => number;
  hailMaryStaggerMs?: number;
  backstopIntervalMs?: number;
}) {
  return new WriteQueue({
    writer: opts.writer ?? (async () => ({ success: true })),
    storage: createStorage(),
    now: opts.now,
    hailMaryStaggerMs: opts.hailMaryStaggerMs ?? 0, // tests don't need stagger by default
    backstopIntervalMs: opts.backstopIntervalMs ?? 30_000,
  });
}

async function flush() {
  // Run microtask queue to completion. Fake-timer tests advance timers
  // explicitly; this just lets pending then-handlers settle.
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WriteQueue — happy path", () => {
  it("enqueue → drain fires immediately → writer called → item removed", async () => {
    const writer = vi.fn(async () => ({ success: true as const }));
    const q = makeQueue({ writer });
    q.enqueue(payload(101, 1, 4), display);
    await flush();
    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer).toHaveBeenCalledWith(
      expect.objectContaining({ payload: payload(101, 1, 4) }),
    );
    expect(q.getItems()).toHaveLength(0);
  });

  it("persists items to storage so a fresh queue sees them on construct", async () => {
    let resolve!: (r: WriteResult) => void;
    const writer = vi.fn(
      () => new Promise<WriteResult>(r => { resolve = r; }),
    );
    const q1 = makeQueue({ writer });
    q1.enqueue(payload(101, 5, 4), display);
    await flush();
    // Still in_flight — write pending.
    expect(q1.getItems()).toHaveLength(1);
    expect(q1.getItems()[0].state).toBe("in_flight");

    // Simulate tab eviction: drop q1, build a new queue against the same
    // localStorage. Old in_flight items should be resurrected as pending.
    const writer2 = vi.fn(async () => ({ success: true as const }));
    const q2 = makeQueue({ writer: writer2 });
    expect(q2.getItems()).toHaveLength(1);
    expect(q2.getItems()[0].state).toBe("pending");
    expect(q2.getItems()[0].payload).toEqual(payload(101, 5, 4));

    // Resolving the original promise is harmless (q1 will tidy itself).
    resolve({ success: true });
  });
});

describe("WriteQueue — collapsing (D4, D5)", () => {
  it("collapses two pending enqueues with the same key into one", async () => {
    let resolve!: (r: WriteResult) => void;
    const pending = new Promise<WriteResult>(r => { resolve = r; });
    let firstCalled = false;
    const writer = vi.fn(async () => {
      if (!firstCalled) {
        firstCalled = true;
        return pending; // first call hangs so we can enqueue before it resolves
      }
      return { success: true as const };
    });
    const q = makeQueue({ writer });

    q.enqueue(payload(101, 1, 4), display);
    await flush(); // first write is now in_flight

    // Second enqueue while first is in_flight → must NOT collapse (D5).
    q.enqueue(payload(101, 1, 5), display);
    await flush();
    expect(q.getItems()).toHaveLength(2);
    expect(q.getItems().filter(i => i.state === "in_flight")).toHaveLength(1);
    expect(q.getItems().filter(i => i.state === "pending")).toHaveLength(1);

    // Third enqueue collapses against the pending (D4 — same key, pending).
    q.enqueue(payload(101, 1, 6), display);
    await flush();
    expect(q.getItems()).toHaveLength(2);
    expect(q.getItems().find(i => i.state === "pending")!.payload.strokes).toBe(6);

    // Resolve first write; queue should pick up the pending one next.
    resolve({ success: true });
    await flush();
    expect(q.getItems()).toHaveLength(0);
    // Writer was called: in_flight (4), then collapsed pending (6) — 2 total.
    expect(writer).toHaveBeenCalledTimes(2);
    expect(writer).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ strokes: 6 }) }),
    );
  });

  it("collapse resets attempts and next_attempt_at", async () => {
    const writer = vi.fn(async () => ({ success: false as const, classification: "retry" as const }));
    let nowMs = 1_000_000;
    const q = makeQueue({ writer, now: () => nowMs });

    q.enqueue(payload(101, 1, 4), display);
    await flush();
    // After one failure attempts=1, next_attempt_at = now + 1000.
    const item = q.getItems()[0];
    expect(item.state).toBe("pending");
    expect(item.attempts).toBe(1);
    expect(item.next_attempt_at).toBe(nowMs + 1000);

    // Collapse: user expressed fresh intent → attempts reset, fire now.
    nowMs += 500;
    q.enqueue(payload(101, 1, 5), display);
    const afterCollapse = q.getItems().find(i => i.state !== "in_flight");
    // After enqueue the drain attempt fires synchronously and sets state to
    // in_flight; check that the writer was called with the new payload.
    await flush();
    expect(writer).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ strokes: 5 }) }),
    );
    expect(afterCollapse).toBeUndefined(); // it transitioned to in_flight
  });
});

describe("WriteQueue — retry + terminal", () => {
  it("retries with the locked backoff schedule and steady-state cap", async () => {
    vi.useFakeTimers();
    const writer = vi.fn(async () => ({ success: false as const, classification: "retry" as const }));
    let nowMs = 0;
    const q = makeQueue({ writer, now: () => nowMs });

    // attempts=0 → fire now
    q.enqueue(payload(101, 1, 4), display);
    await vi.runOnlyPendingTimersAsync();
    await flush();
    let item = q.getItems()[0];
    expect(writer).toHaveBeenCalledTimes(1);
    expect(item.attempts).toBe(1);
    expect(item.next_attempt_at).toBe(nowMs + backoffMs(1)); // 1000

    // Walk through attempts 2..8 verifying the schedule.
    for (let n = 1; n <= 8; n++) {
      const expected = backoffMs(n);
      nowMs += expected; // jump just to the next_attempt_at
      // Manually trigger a drain — backstop timer is mocked
      await q.drain();
      item = q.getItems()[0];
      expect(item.attempts).toBe(n + 1);
      expect(item.next_attempt_at).toBe(nowMs + backoffMs(n + 1));
    }
    // After 9 failures we're in steady state — backoff is 120s thereafter.
    expect(backoffMs(item.attempts)).toBe(120_000);
  });

  it("classifies a write as terminal immediately on failWrite=terminal", async () => {
    const writer = vi.fn(async () => ({
      success: false as const,
      classification: "terminal" as const,
      error: { code: "23503" },
    }));
    const sentry = { captureMessage: vi.fn(), captureException: vi.fn() };
    const q = new WriteQueue({
      writer,
      storage: createStorage(),
      sentry,
      hailMaryStaggerMs: 0,
    });
    q.enqueue(payload(101, 1, 4), display);
    await flush();
    expect(q.getItems()).toHaveLength(1);
    expect(q.getItems()[0].state).toBe("terminal_failure");
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      "writeQueue.terminal_failure",
      expect.objectContaining({ reason: "classified_terminal" }),
    );
  });

  it("marks item terminal after 6 hours of continuous failure", async () => {
    const writer = vi.fn(async () => ({ success: false as const, classification: "retry" as const }));
    const sentry = { captureMessage: vi.fn(), captureException: vi.fn() };
    let nowMs = 0;
    const q = new WriteQueue({
      writer,
      storage: createStorage(),
      sentry,
      now: () => nowMs,
      hailMaryStaggerMs: 0,
    });

    q.enqueue(payload(101, 1, 4), display);
    await flush();
    expect(q.getItems()[0].state).toBe("pending");

    // Jump >6h and trigger another drain.
    nowMs += 6 * 60 * 60 * 1000 + 1;
    await q.drain();
    expect(q.getItems()[0].state).toBe("terminal_failure");
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      "writeQueue.terminal_failure",
      expect.objectContaining({ reason: "stuck_too_long" }),
    );
  });

  it("retryTerminal resets attempts and re-drains", async () => {
    let succeedNext = false;
    const writer = vi.fn(async () => {
      if (succeedNext) return { success: true as const };
      return { success: false as const, classification: "terminal" as const };
    });
    const q = makeQueue({ writer });
    q.enqueue(payload(101, 1, 4), display);
    await flush();
    expect(q.getItems()[0].state).toBe("terminal_failure");

    succeedNext = true;
    await q.retryTerminal();
    expect(q.getItems()).toHaveLength(0);
  });
});

describe("WriteQueue — drain triggers", () => {
  it("skips drain when navigator.onLine is false; resumes on online event", async () => {
    const writer = vi.fn(async () => ({ success: true as const }));
    const q = makeQueue({ writer });
    q.start();
    try {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
      q.enqueue(payload(101, 1, 4), display);
      await flush();
      // Offline: writer should NOT have been called.
      expect(writer).not.toHaveBeenCalled();
      expect(q.getItems()).toHaveLength(1);

      // Come back online → fire the 'online' event → drain.
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
      window.dispatchEvent(new Event("online"));
      await flush();
      expect(writer).toHaveBeenCalledTimes(1);
      expect(q.getItems()).toHaveLength(0);
    } finally {
      q.stop();
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    }
  });

  it("pageshow event triggers a drain", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const writer = vi.fn(async () => ({ success: true as const }));
    const q = makeQueue({ writer });
    q.start();
    try {
      q.enqueue(payload(101, 1, 4), display);
      await flush();
      expect(writer).not.toHaveBeenCalled();

      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
      window.dispatchEvent(new Event("pageshow"));
      await flush();
      expect(writer).toHaveBeenCalledTimes(1);
    } finally {
      q.stop();
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    }
  });

  it("visibilitychange to visible triggers a drain", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const writer = vi.fn(async () => ({ success: true as const }));
    const q = makeQueue({ writer });
    q.start();
    try {
      q.enqueue(payload(101, 1, 4), display);
      await flush();
      expect(writer).not.toHaveBeenCalled();

      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      await flush();
      expect(writer).toHaveBeenCalledTimes(1);
    } finally {
      q.stop();
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    }
  });
});

describe("WriteQueue — hail-mary drain (D9)", () => {
  it("processes pending items regardless of their next_attempt_at", async () => {
    const writer = vi.fn(async () => ({ success: true as const }));
    let nowMs = 1_000_000;
    const q = new WriteQueue({
      writer,
      storage: createStorage(),
      now: () => nowMs,
      hailMaryStaggerMs: 0,
    });
    // Enqueue, fail once → next_attempt_at = now + 1000.
    let firstFailed = false;
    const failingWriter = vi.fn(async () => {
      if (!firstFailed) {
        firstFailed = true;
        return { success: false as const, classification: "retry" as const };
      }
      return { success: true as const };
    });
    const q2 = new WriteQueue({
      writer: failingWriter,
      storage: createStorage(),
      now: () => nowMs,
      hailMaryStaggerMs: 0,
    });
    q2.enqueue(payload(101, 1, 4), display);
    await flush();
    const item = q2.getItems()[0];
    expect(item.state).toBe("pending");
    expect(item.next_attempt_at).toBeGreaterThan(nowMs);

    // Normal drain at current time would skip (still in backoff).
    await q2.drain();
    expect(failingWriter).toHaveBeenCalledTimes(1);

    // Hail-mary drain fires regardless of backoff.
    await q2.drain({ ignoreBackoff: true });
    expect(failingWriter).toHaveBeenCalledTimes(2);
    expect(q2.getItems()).toHaveLength(0);
  });

  it("staggers hail-mary writes by hailMaryStaggerMs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    // Pre-populate storage with 3 items already in backoff so the hail-mary
    // drain has work to do (otherwise enqueue's normal drain races ahead and
    // processes them tight-looped with no stagger).
    const pre: QueueItem[] = [101, 102, 103].map((rp, i) => ({
      id: `id-${rp}`,
      kind: "score_upsert" as const,
      payload: payload(rp, 1, 4),
      enqueued_at: 1_000_000,
      attempts: 1,
      last_attempt_at: 1_000_000,
      next_attempt_at: 9_999_999_999, // far future — normal drain would skip
      state: "pending" as const,
      display,
    }));
    globalThis.localStorage.setItem("gobs:write-queue:v1", JSON.stringify(pre));

    const calls: number[] = [];
    const writer = vi.fn(async () => {
      calls.push(Date.now());
      return { success: true as const };
    });
    const q = new WriteQueue({
      writer,
      storage: createStorage(),
      hailMaryStaggerMs: 100,
      now: Date.now,
    });
    const drainPromise = q.drain({ ignoreBackoff: true });
    // Advance through staggers (3 writes, 100ms between each)
    await vi.advanceTimersByTimeAsync(350);
    await drainPromise;
    expect(writer).toHaveBeenCalledTimes(3);
    expect(calls).toHaveLength(3);
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i] - calls[i - 1]).toBeGreaterThanOrEqual(100);
    }
  });
});

describe("WriteQueue — forget + isPersistent", () => {
  it("forget() removes items and emits Sentry event per item", async () => {
    const writer = vi.fn(async () => ({ success: false as const, classification: "terminal" as const }));
    const sentry = { captureMessage: vi.fn(), captureException: vi.fn() };
    const q = new WriteQueue({
      writer,
      storage: createStorage(),
      sentry,
      hailMaryStaggerMs: 0,
    });
    q.enqueue(payload(101, 1, 4), display);
    await flush();
    const id = q.getItems()[0].id;
    sentry.captureMessage.mockClear();
    q.forget([id]);
    expect(q.getItems()).toHaveLength(0);
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      "writeQueue.forget",
      expect.objectContaining({ item_id: id }),
    );
  });

  it("reports isPersistent=false when localStorage is unavailable", () => {
    const throwing: Storage = {
      ...globalThis.localStorage,
      setItem: () => {
        throw Object.assign(new Error("denied"), { name: "SecurityError" });
      },
    } as Storage;
    const q = new WriteQueue({
      writer: async () => ({ success: true }),
      storage: createStorage({ storage: throwing }),
    });
    expect(q.isPersistent()).toBe(false);
  });
});

describe("WriteQueue — subscribe", () => {
  it("notifies listeners on each mutation", async () => {
    const writer = vi.fn(async () => ({ success: true as const }));
    const q = makeQueue({ writer });
    const listener = vi.fn();
    q.subscribe(listener);
    q.enqueue(payload(101, 1, 4), display);
    await flush();
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2); // enqueue + in_flight + removed
  });

  it("unsubscribe stops further notifications", async () => {
    const writer = vi.fn(async () => ({ success: true as const }));
    const q = makeQueue({ writer });
    const listener = vi.fn();
    const off = q.subscribe(listener);
    off();
    q.enqueue(payload(101, 1, 4), display);
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });
});
