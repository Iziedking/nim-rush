import { BLITZ_LIMIT_SECONDS } from '../../../shared/atlas/blitz/core';
import type { BlitzRunState } from '../../../shared/atlas/blitz/types';

/*
 * The voice over the run.
 *
 * A downhill race is loud with commentary, and the reason is not decoration:
 * at this speed a rider is looking at the road, not at the HUD. A line telling
 * them the tank is dry or a contract just cleared is information they cannot
 * get any other way without taking their eyes off the ridge.
 *
 * Two rules keep it from becoming noise. A line is only spoken when something
 * actually changed between two ticks, and only one line can be in the air at a
 * time - anything that arrives during another line's cooldown is dropped
 * rather than queued, because a stale callout is worse than silence. Higher
 * urgency wins within a tick, so a crash is never buried under praise.
 *
 * The lines are deliberately short. Speech takes real time and the run is
 * ninety seconds.
 */

export interface BlitzCallout {
  readonly id: string;
  readonly text: string;
  /** Higher wins when two things happen on the same tick. */
  readonly urgency: number;
  /** How long this line silences the channel, in milliseconds. */
  readonly holdMs: number;
}

/** Nothing else may speak for this long after an ordinary line. */
const DEFAULT_HOLD_MS = 2_200;

/*
 * The ones a rider needs, not everything that happens. Boost, drift and
 * pickups already have their own sound, so they are only spoken when they
 * carry information a rider could not otherwise have - the last gearbox, a
 * dry tank - rather than every time.
 */
export function blitzCallout(previous: BlitzRunState | null, next: BlitzRunState): BlitzCallout | null {
  if (!previous) return null;
  const candidates: BlitzCallout[] = [];
  const say = (id: string, text: string, urgency: number, holdMs = DEFAULT_HOLD_MS) => candidates.push({ id, text, urgency, holdMs });

  // Trouble first. These are the only lines allowed to interrupt a run's flow.
  if (next.collisions > previous.collisions) {
    const line = next.collisions === 1 ? 'Contact.' : next.collisions >= 4 ? 'Keep it upright!' : 'That is two.';
    say('contact', line, 100, 1_600);
  }
  if (next.phase === 'timeout' && previous.phase !== 'timeout') say('timeout', 'Out of time.', 95, 4_000);

  // The finish, and what it was worth.
  if (next.phase === 'finished' && previous.phase !== 'finished') {
    const clean = next.collisions === 0;
    say('finish', clean ? 'Finish! Not a mark on it.' : 'Finish!', 90, 4_000);
  }

  /*
   * The clock. Spoken once, at ten seconds, because a rider deep in a descent
   * has no idea how long they have been riding.
   */
  const remaining = BLITZ_LIMIT_SECONDS - next.elapsedMs / 1_000;
  const wasRemaining = BLITZ_LIMIT_SECONDS - previous.elapsedMs / 1_000;
  if (next.phase === 'running' && wasRemaining > 10 && remaining <= 10) say('ten', 'Ten seconds!', 80, 2_000);

  // Supplies running out. A rider cannot see an empty tank at this speed.
  if (previous.driftCharges > 0 && next.driftCharges === 0) say('gearless', 'Last gear gone.', 60);
  if (previous.boostEnergy > 0 && next.boostEnergy === 0) say('dry', 'Tank is dry.', 58);

  // Work done well.
  const done = (state: BlitzRunState) => state.missions.filter((mission) => mission.status === 'complete').length;
  if (done(next) > done(previous)) {
    say('contract', done(next) === 3 ? 'All three contracts. Clean.' : 'Contract clear.', 70);
  }
  if (next.nearMisses >= previous.nearMisses + 2) say('threaded', 'Threaded it!', 40, 3_000);
  if (next.lastEvent?.type === 'landing' && previous.lastEvent?.type !== 'landing' && next.lastEvent.intensity < 0.45) {
    say('landing', 'Landed it.', 35, 3_000);
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((left, right) => (right.urgency > left.urgency ? right : left));
}

/**
 * The channel.
 *
 * Holds the cooldown so the caller does not have to, and refuses a line rather
 * than queueing it: by the time a queued callout was spoken the rider would be
 * somewhere else on the hill and it would be a lie.
 */
export class BlitzVoice {
  private silentUntil = 0;
  private lastId: string | null = null;

  constructor(private readonly speak: (text: string) => void, private readonly now: () => number = () => Date.now()) {}

  offer(callout: BlitzCallout | null): boolean {
    if (!callout) return false;
    const at = this.now();
    // The same line twice in a row is a stutter, not emphasis.
    if (at < this.silentUntil || callout.id === this.lastId) return false;
    this.silentUntil = at + callout.holdMs;
    this.lastId = callout.id;
    try { this.speak(callout.text); } catch { /* Voice is optional and never blocks play. */ }
    return true;
  }

  /** A new run starts with a clear channel and no memory of the last one. */
  reset(): void {
    this.silentUntil = 0;
    this.lastId = null;
  }
}
