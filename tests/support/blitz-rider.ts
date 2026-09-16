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

  // Nothing ahead: hold the centre, which is also where the line gates score.
  let target = 0;
  if (blocked.length > 0) {
    let widest = -1;
    let cursor = -edge;
    const consider = (from: number, to: number) => {
      const width = to - from;
      // Ties go to the gap nearer the bike, so the rider does not cross the
      // road for a corridor no better than the one beside it.
      const better = width > widest + 0.01
        || (Math.abs(width - widest) <= 0.01 && Math.abs((from + to) / 2 - state.laneOffset) < Math.abs(target - state.laneOffset));
      if (width > 0 && better) { widest = Math.max(widest, width); target = (from + to) / 2; }
    };
    for (const span of blocked) {
      if (span.from > cursor) consider(cursor, span.from);
      cursor = Math.max(cursor, span.to);
    }
    consider(cursor, edge);
    // Stay a little inside the shoulder: leaving the road is its own penalty.
    target = Math.max(-edge + 0.3, Math.min(edge - 0.3, target));
  }

  const correction = (target - state.laneOffset) * 1.6;
  return Math.max(-1, Math.min(1, correction));
}

/** The rider's full input for a tick, with a boost rhythm a person could hold. */
export function blitzRiderInput(state: BlitzRunState, options: { boost?: boolean } = {}): BlitzInput {
  return {
    steer: blitzRacingLine(state),
    drift: false,
    boost: options.boost ?? state.tick % 140 < 24,
  };
}
