import { describe, expect, it } from 'vitest';
import { BLITZ_CITIES, blitzCity } from '../shared/atlas/blitz/cities';
import { sampleCourse, obstacleShape, courseGroundLift, roadsideRocks } from '../shared/atlas/blitz/course';
import { createBlitzRun, stepBlitzRun } from '../shared/atlas/blitz/core';
import { hashBlitzTrace, validateBlitzTrace } from '../shared/atlas/blitz/replay';
import type { BlitzRunState } from '../shared/atlas/blitz/types';

const idle = { steer: 0, drift: false, boost: false };

describe('physical course geometry and replay', () => {
  it('supports the bicycle on the visible uphill shoulder rather than the centreline', () => {
    expect(courseGroundLift('lagos', 1200, -5)).toBeGreaterThan(.4);
    const state = { ...createBlitzRun({ cityId: 'lagos', seed: 'shoulder' }), phase: 'running' as const,
      distanceMeters: 1200, speedMps: 14, laneOffset: -5 };
    const next = stepBlitzRun(state, idle);
    expect(next.heightMeters).toBeGreaterThan(.4);
  });

  it.each([-1, 1])('keeps shoulder %s rideable with drag, working brakes and trail recovery', (side) => {
    let state: BlitzRunState = { ...createBlitzRun({ cityId: 'lagos', seed: 'grass' }), phase: 'running',
      distanceMeters: 1100, speedMps: 27, laneOffset: side * 4.5 };
    const first = stepBlitzRun(state, idle);
    expect(first.speedMps).toBeGreaterThan(26.5);
    for (let tick = 0; tick < 120; tick++) state = stepBlitzRun(state, { ...idle, boost: true });
    expect(state.surface).toBe('grass');
    expect(state.speedMps).toBeGreaterThan(4);
    expect(state.speedMps).toBeLessThan(16);
    const rollingAt = state.distanceMeters;
    for (let tick = 0; tick < 15; tick++) state = stepBlitzRun(state, idle);
    expect(state.distanceMeters - rollingAt).toBeGreaterThan(2);
    for (let tick = 0; tick < 90; tick++) state = stepBlitzRun(state, { ...idle, brake: true });
    expect(state.speedMps).toBe(0);
    for (let tick = 0; tick < 30; tick++) state = stepBlitzRun(state, idle);
    expect(state.speedMps).toBeGreaterThan(1);
    for (let tick = 0; tick < 150; tick++) state = stepBlitzRun(state, { ...idle, steer: Math.abs(state.laneOffset) > 2 ? -side : 0 });
    expect(Math.abs(state.laneOffset)).toBeLessThan(3.6);
    expect(state.speedMps).toBeGreaterThan(10);
  });

  it('makes the visible roadside boulders solid at their shared rendered positions', () => {
    const rock = Array.from({ length: 19 }, (_, i) => roadsideRocks(i * 100)).flat().find(r => r.lane === 6.7 && r.halfWidth > 1.85)!;
    expect(rock).toBeDefined();
    const state = { ...createBlitzRun({ cityId: 'lagos', seed: 'boulder' }), phase: 'running' as const,
      distanceMeters: rock.distance - rock.halfLength - 1.3, speedMps: 30, laneOffset: 5.15 };
    const next = stepBlitzRun(state, idle);
    expect(next.collisions).toBe(1);
    expect(next.distanceMeters).toBeLessThan(rock.distance - rock.halfLength - 1.1);
    expect(next.speedMps).toBeLessThan(11);
  });

  it('lands on an uphill shoulder, not below its visible surface', () => {
    const state = { ...createBlitzRun({ cityId: 'lagos', seed: 'shoulder-landing' }), phase: 'running' as const,
      distanceMeters: 1200, speedMps: 14, laneOffset: -5, airborne: true,
      heightMeters: courseGroundLift('lagos', 1200, -5) + .02, verticalVelocityMps: -4 };
    const next = stepBlitzRun(state, idle);
    expect(next.airborne).toBe(false);
    expect(next.heightMeters).toBeCloseTo(courseGroundLift('lagos', next.distanceMeters, next.laneOffset), 8);
  });
  it('moves one world metre per recorded metre without stopping at route joins', () => {
    for (const city of BLITZ_CITIES) for (let d = 3; d < city.lengthMeters - 3; d += 2.7) {
      const a = sampleCourse(city.id, d), b = sampleCourse(city.id, d + 1);
      expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeGreaterThan(.995);
      expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeLessThan(1.005);
      const headingChange = Math.atan2(Math.sin(b.headingRadians - a.headingRadians), Math.cos(b.headingRadians - a.headingRadians));
      expect(Math.abs(headingChange)).toBeLessThan(.08);
    }
  });

  it('stops the front wheel at a solid obstacle and separates without repeated score penalties', () => {
    const city = blitzCity('lagos'), obstacle = city.obstacles[0]!;
    const shape = obstacleShape(obstacle.id), d = obstacle.distance01 * city.lengthMeters;
    let state = { ...createBlitzRun({ cityId: 'lagos', seed: 'contact' }), phase: 'running' as const,
      distanceMeters: d - shape.halfLength - 1.3, speedMps: 38, laneOffset: obstacle.lane };
    const first = stepBlitzRun(state, { ...idle, boost: true });
    expect(first.distanceMeters).toBeLessThanOrEqual(d - shape.halfLength - 1.1);
    expect(first.collisions).toBe(1);
    expect(first.lastEvent?.type).toBe('impact');
    expect(first.speedMps).toBeLessThan(15);
    let next = first;
    for (let tick = 0; tick < 60; tick++) next = stepBlitzRun(next, { ...idle, steer: -1 });
    expect(next.collisions).toBe(1);
    expect(next.distanceMeters).toBeGreaterThan(d + shape.halfLength + 1.1);
  });

  it('does not choose a rightward escape when a centered rider gives no steering input', () => {
    const city = blitzCity('lagos'), obstacle = city.obstacles[0]!;
    const shape = obstacleShape(obstacle.id), d = obstacle.distance01 * city.lengthMeters;
    const state = { ...createBlitzRun({ cityId: 'lagos', seed: 'neutral-contact' }), phase: 'running' as const,
      distanceMeters: d - shape.halfLength - 1.3, speedMps: 38, laneOffset: obstacle.lane };

    const next = stepBlitzRun(state, idle);

    expect(next.collisions).toBe(1);
    expect(next.lateralVelocityMps).toBe(0);
    expect(next.laneOffset).toBe(obstacle.lane);
  });

  it('resolves lateral entry against the obstacle side even after its centre was passed', () => {
    const city = blitzCity('lagos'), obstacle = city.obstacles[0]!;
    const shape = obstacleShape(obstacle.id);
    const state = { ...createBlitzRun({ cityId: 'lagos', seed: 'side' }), phase: 'running' as const,
      distanceMeters: obstacle.distance01 * city.lengthMeters + .2, speedMps: 4,
      laneOffset: obstacle.lane + shape.halfWidth + .4, lateralVelocityMps: -10 };
    const next = stepBlitzRun(state, idle);
    expect(Math.abs(next.laneOffset - obstacle.lane)).toBeGreaterThanOrEqual(shape.halfWidth + .32);
    expect(next.collisions).toBe(1);
  });

  it('clears an obstacle only when the wheels are above its top', () => {
    const city = blitzCity('lagos'), obstacle = city.obstacles[0]!;
    const shape = obstacleShape(obstacle.id);
    const state = { ...createBlitzRun({ cityId: 'lagos', seed: 'air-clearance' }), phase: 'running' as const,
      distanceMeters: obstacle.distance01 * city.lengthMeters - shape.halfLength - 1.3, speedMps: 30,
      laneOffset: obstacle.lane, airborne: true, heightMeters: 2, verticalVelocityMps: 0 };
    expect(stepBlitzRun(state, idle).collisions).toBe(0);
    expect(stepBlitzRun({ ...state, heightMeters: .2 }, idle).collisions).toBe(1);
  });

  it('hashes braking and rejects malformed brake controls', async () => {
    const coast = [{ tick: 0, input: idle }], brake = [{ tick: 0, input: { ...idle, brake: true } }];
    expect(await hashBlitzTrace(coast)).not.toBe(await hashBlitzTrace(brake));
    expect(() => validateBlitzTrace([{ tick: 0, input: { ...idle, brake: 'yes' as unknown as boolean } }])).toThrow();
  });
});
