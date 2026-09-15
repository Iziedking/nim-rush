import { describe, expect, it } from 'vitest';
import { Raycaster, Vector3, Mesh } from 'three';
import { createRushCourse } from '../src/atlas/render/three/rush-course';
import { RushBike } from '../src/atlas/render/three/rush-bike';
import { courseTerrainHeight, sampleCourse } from '../shared/atlas/blitz/course';
import { createBlitzRun } from '../shared/atlas/blitz/core';

describe('rendered terrain contact', () => {
  it('agrees with actual terrain triangles across both grassy shoulders', () => {
    const course = createRushCourse('lagos'); course.updateMatrixWorld(true);
    const ground = course.children.filter(c => typeof c.userData.start === 'number').map(c => c.children[0]!);
    const ray = new Raycaster();
    for (const distance of [120, 455, 900, 1200, 1610]) for (const lane of [-5.15, -4.1, 0, 4.1, 5.15]) {
      const p = sampleCourse('lagos', distance, lane), y = courseTerrainHeight('lagos', distance, lane);
      ray.set(new Vector3(p.x, y + 20, p.z), new Vector3(0, -1, 0));
      const hit = ray.intersectObjects(ground, false)[0];
      expect(hit).toBeDefined();
      expect(Math.abs(hit!.point.y - y)).toBeLessThan(.02);
    }
    course.traverse(o => { if (o instanceof Mesh) o.geometry.dispose(); });
  });

  it('keeps shoe meshes and connected limbs visible on a banked shoulder', () => {
    const bike = new RushBike();
    const state = { ...createBlitzRun({ cityId: 'lagos', seed: 'rider-contact' }), phase: 'running' as const,
      distanceMeters: 1200, laneOffset: -5, speedMps: 4, surface: 'grass' as const };
    for (let i = 0; i < 60; i++) bike.update(state, -.3, 1 / 60);
    expect(bike.root.position.y).toBeGreaterThan(courseTerrainHeight('lagos', 1200, -5));
    expect(bike.root.getObjectByName('rider-shoe-0')?.children.length).toBe(1);
    expect(bike.root.getObjectByName('cycling-shoe-upper-sole-laces-heel-cuff')).toBeDefined();
    expect(bike.root.getObjectByName('rider-shoe-1')?.visible).toBe(true);
    bike.root.traverse(o => { if (o instanceof Mesh) o.geometry.dispose(); });
  });
});
