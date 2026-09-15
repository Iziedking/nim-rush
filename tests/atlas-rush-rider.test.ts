import { describe, expect, it } from 'vitest';
import { CRANK_RADIUS, LOWER_LEG_LENGTH, UPPER_LEG_LENGTH, pedalPoint, riderKnee } from '../src/atlas/render/three/rush-rider-pose';
import type { RiderPoint } from '../src/atlas/render/three/rush-rider-pose';

describe('rider pedal linkage', () => {
  it('pushes the forward pedal downward during the power stroke, not backward pedalling', () => {
    expect(pedalPoint(0, 0)[2]).toBeCloseTo(.11, 8);
    expect(pedalPoint(Math.PI / 2, 0)[1]).toBeCloseTo(.25, 8);
  });
  it('keeps both cranks opposite and both legs attached at fixed lengths through every pedal phase', () => {
    for (let a = 0; a < Math.PI * 2; a += .07) for (let side = 0; side < 2; side++) {
      const pedal = pedalPoint(a, side), opposite = pedalPoint(a, 1 - side);
      expect(Math.hypot(pedal[1] - .42, pedal[2] + .06)).toBeCloseTo(CRANK_RADIUS, 8);
      expect(pedal[1] + opposite[1]).toBeCloseTo(.84, 8);
      expect(pedal[2] + opposite[2]).toBeCloseTo(-.12, 8);
      for (const crouch of [0, -.12, .03]) {
        const hip: RiderPoint = [side ? .13 : -.13, 1.16 + crouch, -.36];
        const ankle: RiderPoint = [pedal[0], pedal[1] + .13, pedal[2] - .09];
        const knee = riderKnee(hip, ankle, side);
        expect(Math.hypot(...knee.map((v, i) => v - hip[i]!))).toBeCloseTo(UPPER_LEG_LENGTH, 6);
        expect(Math.hypot(...knee.map((v, i) => v - ankle[i]!))).toBeCloseTo(LOWER_LEG_LENGTH, 6);
      }
    }
  });
});
