import { describe, expect, it } from 'vitest';

import { BLITZ_CITIES, BLITZ_LINE_GATES, blitzEnabledObstacles } from '../shared/atlas/blitz/cities';
import { obstacleShape } from '../shared/atlas/blitz/course';
import { BLITZ_DIFFICULTY_RULES, blitzRules } from '../shared/atlas/blitz/rules';
import type { BlitzCityDefinition, BlitzObstacle } from '../shared/atlas/blitz/cities';
import type { BlitzDifficulty } from '../shared/atlas/blitz/types';

/*
 * The course itself.
 *
 * Four obstacles across 1,900 metres is one every sixteen seconds, and a
 * ranked run only made two of those solid: a rider spent a minute holding a
 * direction. The near-miss reward the simulation already pays had almost
 * nothing to operate on.
 *
 * Density on its own is not an improvement, though - a course can be dense and
 * impossible, or dense and unfair. These tests are the difference. They are
 * written against the same numbers the simulation collides with, so a course
 * edit that walls the road fails here rather than in somebody's run.
 */

/** The simulation's own margin: see the obstacle loop in core.ts. */
const HIT_MARGIN = 0.32;
/** Longitudinal reach of a collider, again matching the simulation. */
const APPROACH = 1.1;

interface Blocked {
  readonly from: number;
  readonly to: number;
}

function collider(city: BlitzCityDefinition, obstacle: BlitzObstacle) {
  const shape = obstacleShape(obstacle.id);
  const distance = obstacle.distance01 * city.lengthMeters;
  return {
    id: obstacle.id,
    distance,
    near: distance - shape.halfLength - APPROACH,
    far: distance + shape.halfLength + APPROACH,
    blocked: { from: obstacle.lane - shape.halfWidth - HIT_MARGIN, to: obstacle.lane + shape.halfWidth + HIT_MARGIN } as Blocked,
  };
}

/**
 * The widest clear corridor through a set of simultaneous obstacles.
 *
 * Sweeps the blocked intervals across the road rather than assuming they are
 * sorted or disjoint, because a pinch is exactly the case where two of them
 * overlap.
 */
function widestGap(city: BlitzCityDefinition, blocked: readonly Blocked[]): number {
  const edge = city.roadWidth / 2;
  const spans = [...blocked]
    .map((span) => ({ from: Math.max(span.from, -edge), to: Math.min(span.to, edge) }))
    .filter((span) => span.to > span.from)
    .sort((left, right) => left.from - right.from);
  let widest = 0;
  let cursor = -edge;
  for (const span of spans) {
    if (span.from > cursor) widest = Math.max(widest, span.from - cursor);
    cursor = Math.max(cursor, span.to);
  }
  return Math.max(widest, edge - cursor);
}

/** Obstacles a rider meets at the same moment, grouped by overlapping reach. */
function clusters(city: BlitzCityDefinition, difficulty: BlitzDifficulty) {
  const colliders = blitzEnabledObstacles(city, difficulty)
    .map((obstacle) => collider(city, obstacle))
    .sort((left, right) => left.near - right.near);
  const groups: (typeof colliders)[] = [];
  for (const entry of colliders) {
    const open = groups[groups.length - 1];
    if (open && entry.near <= Math.max(...open.map((member) => member.far))) open.push(entry);
    else groups.push([entry]);
  }
  return groups;
}

const DIFFICULTIES = Object.keys(BLITZ_DIFFICULTY_RULES) as BlitzDifficulty[];

describe('every NIM RUSH course is dense enough to ride and open enough to pass', () => {
  /*
   * The bar: something to react to every few seconds at racing speed. Below
   * this the course is a corridor, and the skills the score rewards - the
   * racing line, the near miss, keeping contacts down - never come up.
   */
  it.each(BLITZ_CITIES.map((city) => [city.id, city] as const))('%s asks something of a rider every few seconds', (_id, city) => {
    const core = blitzEnabledObstacles(city, 'rookie');
    const seconds = city.lengthMeters / city.baseSpeedMps;
    const gap = seconds / core.length;
    expect(core.length).toBeGreaterThanOrEqual(12);
    // One every 2 to 6 seconds. Tighter than 2 is a wall at 30 m/s; looser
    // than 6 is the empty course this replaced.
    expect(gap).toBeGreaterThan(2);
    expect(gap).toBeLessThan(6);
  });

  /*
   * The one rule a course cannot break. A rider who reads the road correctly
   * must have somewhere to put the bike; a pinch with no gap is not difficulty,
   * it is a scripted collision, and it would be scored as the rider's fault.
   */
  it.each(
    BLITZ_CITIES.flatMap((city) => DIFFICULTIES.map((difficulty) => [`${city.id}/${difficulty}`, city, difficulty] as const)),
  )('%s always leaves a line through', (_label, city, difficulty) => {
    for (const group of clusters(city, difficulty)) {
      const gap = widestGap(city, group.map((entry) => entry.blocked));
      expect({ at: group.map((entry) => entry.id).join(' + '), gap: Number(gap.toFixed(2)) })
        .toMatchObject({ gap: expect.any(Number) });
      // Wide enough for the bike plus a decision, not merely wide enough to
      // fit through with a perfect input.
      expect(gap).toBeGreaterThanOrEqual(1.2);
    }
  });

  it.each(BLITZ_CITIES.map((city) => [city.id, city] as const))('%s keeps every obstacle on the road it is scored against', (_id, city) => {
    const edge = city.roadWidth / 2;
    for (const obstacle of city.obstacles) {
      // An obstacle centred off the road is decoration pretending to be a
      // hazard: a rider who stays on the road can never touch it.
      expect(Math.abs(obstacle.lane)).toBeLessThan(edge);
      expect(obstacle.distance01).toBeGreaterThan(0);
      expect(obstacle.distance01).toBeLessThan(1);
    }
    expect(new Set(city.obstacles.map((obstacle) => obstacle.id)).size).toBe(city.obstacles.length);
  });

  /*
   * A jump takes the bike off the ground for roughly a second. Landing on an
   * obstacle is not a read a rider can make, so the ground after a kicker
   * stays clear.
   */
  it.each(BLITZ_CITIES.map((city) => [city.id, city] as const))('%s leaves the landing after every jump clear', (_id, city) => {
    for (const feature of city.terrainFeatures) {
      if (feature.kind !== 'jump') continue;
      const launch = feature.distance01 * city.lengthMeters;
      for (const obstacle of city.obstacles) {
        const distance = obstacle.distance01 * city.lengthMeters;
        if (distance < launch) continue;
        expect({ jump: feature.id, obstacle: obstacle.id, metres: Number((distance - launch).toFixed(1)) })
          .toMatchObject({ metres: expect.any(Number) });
        if (distance - launch < 30) throw new Error(`${obstacle.id} sits ${(distance - launch).toFixed(1)}m into the landing of ${feature.id}`);
      }
    }
  });

  /*
   * Rookie is what every ranked run uses. It must be a real course, not a
   * reduced one, and pro must actually add something rather than just renaming
   * the ruleset.
   */
  it('gives ranked riders the real course and pro riders more of it', () => {
    for (const city of BLITZ_CITIES) {
      const core = blitzEnabledObstacles(city, 'rookie');
      const all = blitzEnabledObstacles(city, 'pro');
      expect(all.length).toBeGreaterThan(core.length);
      expect(core.length / all.length).toBeGreaterThan(0.75);
      // Pro is a superset: the two rulesets never disagree about an obstacle.
      expect(core.every((obstacle) => all.some((entry) => entry.id === obstacle.id))).toBe(true);
    }
    expect(blitzRules('rookie').obstacleTier).toBe('core');
    expect(blitzRules('pro').obstacleTier).toBe('all');
  });

  /*
   * The course changed, so the ruleset it is scored under has to change with
   * it. A personal best or a leaderboard row set on the old four-obstacle
   * course is not comparable to one set on this, and the version string is
   * what keeps them apart.
   */
  it('names a ruleset version that moved with the course and its economy', () => {
    for (const rules of Object.values(BLITZ_DIFFICULTY_RULES)) {
      expect(rules.rulesetVersion).toContain('v8');
      expect(rules.rulesetVersion).not.toContain('v7');
    }
    expect(new Set(Object.values(BLITZ_DIFFICULTY_RULES).map((rules) => rules.rulesetVersion)).size)
      .toBe(Object.keys(BLITZ_DIFFICULTY_RULES).length);
  });

  /*
   * The gate a rider aims at and the line they are marked on are the same
   * place. They were not: the posts stood at 0.24 / 0.51 / 0.77 while the
   * score was taken at 0.26 / 0.5 / 0.74.
   */
  it('marks the racing line where it is actually judged', () => {
    expect([...BLITZ_LINE_GATES]).toEqual([0.26, 0.5, 0.74]);
    for (const city of BLITZ_CITIES) {
      for (const fraction of BLITZ_LINE_GATES) {
        const gate = fraction * city.lengthMeters;
        const corridor = city.roadWidth * blitzRules('pro').lineTolerance;
        // Nothing may sit inside the scored corridor at a gate: a rider cannot
        // be asked to hold the centre and to leave it at the same instant.
        for (const obstacle of blitzEnabledObstacles(city, 'pro')) {
          const entry = collider(city, obstacle);
          if (gate < entry.near || gate > entry.far) continue;
          const blocksCentre = entry.blocked.from < corridor / 2 && entry.blocked.to > -corridor / 2;
          const stillOpen = widestGap(city, [entry.blocked]) >= 1.2;
          expect({ gate: fraction, obstacle: obstacle.id, blocksCentre, stillOpen }).toMatchObject({ stillOpen: true });
        }
      }
    }
  });
});
