import { describe, expect, it } from 'vitest';

import { BLITZ_CITIES } from '../shared/atlas/blitz/cities';
import { buildBlitzRoadRibbon } from '../shared/atlas/blitz/road-ribbon';

describe('Beacon Blitz continuous road ribbon', () => {
  it('shares one joined edge pair at every route corner', () => {
    for (const city of BLITZ_CITIES) {
      const ribbon = buildBlitzRoadRibbon(city.route, city.roadWidth);
      expect(ribbon.positions).toHaveLength(city.route.length * 2 * 3);
      expect(ribbon.indices).toHaveLength(city.route.length * 6);
      expect(ribbon.joins).toHaveLength(city.route.length);
      expect(ribbon.joins.every((join) => Number.isFinite(join.left[0]) && Number.isFinite(join.right[1]))).toBe(true);
    }
  });

  it('never emits a collapsed or wildly extended corner', () => {
    for (const city of BLITZ_CITIES) {
      const ribbon = buildBlitzRoadRibbon(city.route, city.roadWidth);
      for (const join of ribbon.joins) {
        const width = Math.hypot(join.right[0] - join.left[0], join.right[1] - join.left[1]);
        expect(width).toBeGreaterThan(city.roadWidth * 0.7);
        expect(width).toBeLessThan(city.roadWidth * 1.9);
      }
    }
  });
});

