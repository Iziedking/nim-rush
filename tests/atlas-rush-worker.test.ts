import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBlitzMaintenance } from '../server/atlas/blitz-worker';

/*
 * The maintenance worker.
 *
 * Two promises were being made and never kept: the result screen says a pool is
 * "paid at the close of the day" while nothing closed a day, and the blitz
 * service keeps a qualification outbox that nothing ever drained. Both failed
 * silently, which is the worst way for a money path to fail.
 *
 * What is tested here is the part that bites in production: a tick that
 * overlaps itself, and a tick that throws inside a timer.
 */
function maintenance(overrides: Partial<Parameters<typeof createBlitzMaintenance>[0]> = {}) {
  return createBlitzMaintenance({
    intervalMs: 60_000,
    close: async () => ({ closed: [], skipped: [] }),
    drainQualifications: async () => ({ processed: 0, failed: 0, pending: 0 }),
    log: () => {},
    ...overrides,
  });
}

describe('the maintenance worker', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('does nothing until it is started', async () => {
    let ticks = 0;
    maintenance({ close: async () => { ticks += 1; return { closed: [], skipped: [] }; } });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(ticks).toBe(0);
  });

  it('closes days and drains the outbox on every tick', async () => {
    let closes = 0;
    let drains = 0;
    const worker = maintenance({
      close: async () => { closes += 1; return { closed: [], skipped: [] }; },
      drainQualifications: async () => { drains += 1; return { processed: 0, failed: 0, pending: 0 }; },
    });
    worker.start();
    await vi.advanceTimersByTimeAsync(180_000);
    worker.stop();
    expect(closes).toBeGreaterThanOrEqual(3);
    expect(drains).toBe(closes);
  });

  /*
   * A close that takes longer than the interval must not stack. Two closes
   * running at once would both read the ledger before either wrote to it, and
   * the "already settled" check that makes a re-close safe would see nothing.
   */
  it('never runs two ticks at once', async () => {
    let running = 0;
    let overlaps = 0;
    const worker = maintenance({
      intervalMs: 10,
      close: async () => {
        running += 1;
        if (running > 1) overlaps += 1;
        await new Promise((resolve) => setTimeout(resolve, 500));
        running -= 1;
        return { closed: [], skipped: [] };
      },
    });
    worker.start();
    await vi.advanceTimersByTimeAsync(3_000);
    worker.stop();
    expect(overlaps).toBe(0);
  });

  /*
   * An unhandled rejection inside a timer takes the process down. A treasury
   * that cannot be read must cost one tick, not the server.
   */
  it('survives a tick that throws, and tries again next time', async () => {
    let attempts = 0;
    const logged: string[] = [];
    const worker = maintenance({
      intervalMs: 1_000,
      close: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('treasury unreachable');
        return { closed: [], skipped: [] };
      },
      log: (message) => { logged.push(message); },
    });
    worker.start();
    await vi.advanceTimersByTimeAsync(3_500);
    worker.stop();
    expect(attempts).toBeGreaterThan(1);
    expect(logged.some((line) => line.includes('treasury unreachable'))).toBe(true);
  });

  it('keeps draining the outbox even when the close fails', async () => {
    let drains = 0;
    const worker = maintenance({
      intervalMs: 1_000,
      close: async () => { throw new Error('board down'); },
      drainQualifications: async () => { drains += 1; return { processed: 0, failed: 0, pending: 0 }; },
    });
    worker.start();
    await vi.advanceTimersByTimeAsync(2_500);
    worker.stop();
    expect(drains).toBeGreaterThan(0);
  });

  it('stops cleanly and leaves no timer behind', async () => {
    const worker = maintenance();
    worker.start();
    worker.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is safe to start twice and stop twice', async () => {
    let closes = 0;
    const worker = maintenance({ intervalMs: 1_000, close: async () => { closes += 1; return { closed: [], skipped: [] }; } });
    worker.start();
    worker.start();
    await vi.advanceTimersByTimeAsync(2_500);
    worker.stop();
    worker.stop();
    // Started twice must not mean two timers ticking against one ledger.
    expect(closes).toBeLessThanOrEqual(3);
  });

  it('refuses an interval too short to be a maintenance cadence', () => {
    expect(() => maintenance({ intervalMs: 0 })).toThrow(/interval/i);
    expect(() => maintenance({ intervalMs: -1 })).toThrow(/interval/i);
  });

  it('reports what it did, so an operator can see it working', async () => {
    const logged: string[] = [];
    const worker = maintenance({
      intervalMs: 1_000,
      close: async () => ({ closed: [{ challengeId: 'c', cityId: 'lagos' as const, created: 2, alreadyPresent: 0, conflicts: 0 }], skipped: [] }),
      log: (message) => { logged.push(message); },
    });
    worker.start();
    await vi.advanceTimersByTimeAsync(1_500);
    worker.stop();
    expect(logged.some((line) => line.includes('2'))).toBe(true);
  });
});
