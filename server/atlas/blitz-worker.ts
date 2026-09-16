import type { BlitzDailyCloseReport } from './blitz-daily-close';

/*
 * The one piece of unattended work NIM RUSH does.
 *
 * Two promises were being made and never kept. The result screen tells a rider
 * a pool is "paid at the close of the day" while nothing ever closed a day, and
 * the blitz service keeps a qualification outbox that nothing ever drained. Both
 * failed silently, which is the worst way for a money path to fail: everything
 * looks healthy and nobody is ever paid.
 *
 * It still cannot move value. A close raises draft obligations; approving and
 * submitting a transfer stay supervised human actions.
 */

export interface BlitzQualificationDrainResult {
  readonly processed: number;
  readonly failed: number;
  readonly pending: number;
}

export interface BlitzMaintenance {
  start(): void;
  stop(): void;
  /** Run one tick now. Exposed so an operator or a test can force a pass. */
  tick(): Promise<void>;
}

/** Below a minute this is not maintenance, it is a busy loop against a ledger. */
const MINIMUM_INTERVAL_MS = 60_000;

export function createBlitzMaintenance(options: {
  readonly intervalMs: number;
  readonly close: () => Promise<BlitzDailyCloseReport>;
  readonly drainQualifications: () => Promise<BlitzQualificationDrainResult>;
  readonly log?: (message: string) => void;
}): BlitzMaintenance {
  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
    throw new Error('Beacon Blitz maintenance interval must be a positive number of milliseconds.');
  }
  const intervalMs = Math.max(options.intervalMs, options.intervalMs < MINIMUM_INTERVAL_MS ? options.intervalMs : MINIMUM_INTERVAL_MS);
  const log = options.log ?? ((message: string) => { console.log(message); });

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  /*
   * One tick at a time.
   *
   * A close that outlives its interval must not stack: two closes running at
   * once would both read the ledger before either wrote to it, and the
   * "already settled" check that makes a re-close safe would see nothing.
   */
  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      /*
       * Each half is guarded separately. An unreadable treasury must cost the
       * close, not the outbox, and neither may escape into a timer callback:
       * an unhandled rejection there takes the whole process down.
       */
      try {
        const report = await options.close();
        for (const entry of report.closed) {
          if (entry.created > 0 || entry.conflicts > 0) {
            log(`[blitz] closed ${entry.challengeId}: ${entry.created} raised, ${entry.alreadyPresent} already present, ${entry.conflicts} conflicts`);
          }
        }
        for (const entry of report.skipped) {
          // Only the states that need a human are worth a line. "still open"
          // and "already closed" are the normal case on every tick.
          if (entry.reason === 'pool_unavailable' || entry.reason === 'board_unavailable' || entry.reason === 'plan_refused') {
            log(`[blitz] close skipped ${entry.challengeId}: ${entry.reason}${entry.detail ? ` (${entry.detail})` : ''}`);
          }
        }
      } catch (error) {
        log(`[blitz] daily close failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      }

      try {
        const drained = await options.drainQualifications();
        if (drained.processed > 0 || drained.failed > 0) {
          log(`[blitz] qualifications: ${drained.processed} processed, ${drained.failed} failed, ${drained.pending} pending`);
        }
      } catch (error) {
        log(`[blitz] qualification drain failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    } finally {
      running = false;
    }
  }

  return {
    start() {
      // Starting twice must not mean two timers ticking against one ledger.
      if (timer) return;
      timer = setInterval(() => { void tick(); }, intervalMs);
      // Maintenance must never be the reason a process refuses to exit.
      timer.unref?.();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    tick,
  };
}
