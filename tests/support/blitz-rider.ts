import { blitzCity, blitzEnabledObstacles } from '../../shared/atlas/blitz/cities';
import { obstacleShape } from '../../shared/atlas/blitz/course';
import type { BlitzInput, BlitzRunState } from '../../shared/atlas/blitz/types';

/*
 * A competent rider, for tests that need a run rather than a straight line.
 *
 * Every test here used to drive `steer: 0` from start to finish, which was a
 * fair model of a course with four obstacles on it and no model at all of one
 * with eighteen. Holding the centre now means being hit repeatedly, so a test
 * that asserts a city is finishable has to actually ride it.
 *
 * Deliberately simple and deterministic: look ahead, find the widest gap, aim
 * at the middle of it. It is not a good player - it does not brake, drift or
 * plan two obstacles ahead - which is what makes it a fair floor. If this
 * rider can finish a city, a person can.
 */

/** Far enough ahead to move two metres sideways at racing speed. */
const LOOKAHEAD_METRES = 34;
/** The simulation's own collision margin. See the obstacle loop in core.ts. */
const HIT_MARGIN = 0.32;
/** Narrower than this and the rider will not commit to a corridor. */
const MIN_CORRIDOR = 1.2;

export function blitzRacingLine(state: BlitzRunState): number {
  const city = blitzCity(state.cityId);
  const edge = city.roadWidth / 2;
  const blocked = blitzEnabledObstacles(city, state.difficulty)
    .map((obstacle) => {
      const shape = obstacleShape(obstacle.id);
      return { distance: obstacle.distance01 * city.lengthMeters, from: obstacle.lane - shape.halfWidth - HIT_MARGIN, to: obstacle.lane + shape.halfWidth + HIT_MARGIN };
    })
    .filter((entry) => entry.distance > state.distanceMeters - 3 && entry.distance < state.distanceMeters + LOOKAHEAD_METRES)
    .map((entry) => ({ from: Math.max(entry.from, -edge), to: Math.min(entry.to, edge) }))
    .filter((entry) => entry.to > entry.from)
    .sort((left, right) => left.from - right.from);

  // Every clear corridor between here and the lookahead.
  const gaps: { from: number; to: number }[] = [];
  let cursor = -edge;
  for (const span of blocked) {
    if (span.from > cursor) gaps.push({ from: cursor, to: span.from });
    cursor = Math.max(cursor, span.to);
  }
  if (cursor < edge) gaps.push({ from: cursor, to: edge });

  const supply = nearestSupplyLane(state, city);
  /*
   * Nothing ahead: hold the centre, which is also where the line gates score,
   * unless there is a supply worth reaching for.
   *
   * With obstacles ahead, take the corridor that has the supply in it if one
   * of them does and is wide enough to ride. That ordering is the whole point
   * of where the supplies were placed: a rider should not have to choose
   * between collecting and surviving, and if this rider ever has to, the
   * placement is wrong and the course tests will say so.
   */
  let target = supply ?? 0;
  if (gaps.length > 0) {
    const rideable = gaps.filter((gap) => gap.to - gap.from >= MIN_CORRIDOR);
    const withSupply = supply === null ? undefined : rideable.find((gap) => supply >= gap.from && supply <= gap.to);
    if (withSupply) {
      target = Math.max(withSupply.from + 0.2, Math.min(withSupply.to - 0.2, supply!));
    } else {
      const choices = rideable.length > 0 ? rideable : gaps;
      const best = choices.reduce((left, right) => {
        const width = (gap: { from: number; to: number }) => gap.to - gap.from;
        if (width(right) > width(left) + 0.01) return right;
        if (width(left) > width(right) + 0.01) return left;
        // Ties go to the corridor nearer the bike, so the rider does not
        // cross the road for a gap no better than the one beside it.
        const near = (gap: { from: number; to: number }) => Math.abs((gap.from + gap.to) / 2 - state.laneOffset);
        return near(right) < near(left) ? right : left;
      });
      target = (best.from + best.to) / 2;
    }
  }
  // Stay a little inside the shoulder: leaving the road is its own penalty.
  target = Math.max(-edge + 0.3, Math.min(edge - 0.3, target));

  const correction = (target - state.laneOffset) * 1.6;
  return Math.max(-1, Math.min(1, correction));
}

/**
 * The next supply this rider would reach for, as a lane to aim at.
 *
 * Only the nearest one, and only when it is close enough to matter. Chasing a
 * bottle forty metres away would have the rider weaving across the road for
 * the whole run, which is neither realistic nor a fair test of the course.
 */
function nearestSupplyLane(state: BlitzRunState, city: ReturnType<typeof blitzCity>): number | null {
  let best: { lane: number; distance: number } | null = null;
  for (const pickup of city.pickups) {
    if (state.collectedPickupIds.includes(pickup.id)) continue;
    const at = pickup.distance01 * city.lengthMeters;
    const gap = at - state.distanceMeters;
    if (gap < 0 || gap > LOOKAHEAD_METRES) continue;
    if (!best || gap < best.distance) best = { lane: pickup.lane, distance: gap };
  }
  return best ? best.lane : null;
}

/**
 * The rider's full input for a tick.
 *
 * Drift is spent the way a person would spend it: into a corner, when there is
 * a gearbox to spend and the bike is fast enough for the slide to do anything.
 * Boost is held whenever there is fuel, because that is what fuel is for.
 */
export function blitzRiderInput(state: BlitzRunState, options: { boost?: boolean; drift?: boolean; tuck?: boolean } = {}): BlitzInput {
  const steer = blitzRacingLine(state);
  return {
    steer,
    drift: options.drift ?? (state.driftCharges > 0 && Math.abs(steer) > 0.55 && state.speedMps >= 12),
    boost: options.boost ?? state.boostEnergy > 12,
    /*
     * Tuck when the line is straight, sit up when it is not.
     *
     * The bike coasts without this, so a rider who never tucks barely beats
     * the time limit. Tucking costs grip, which is why this one lets go of it
     * the moment the road asks for a real correction - the same call a person
     * makes, and the reason posture is a skill rather than a button to hold.
     */
    tuck: options.tuck ?? Math.abs(steer) < 0.3,
  };
}
