import { blitzCity } from './cities';
import type { BlitzCityId, BlitzRoutePose } from './types';

// Browser road construction and the Node replay verifier consume the same
// metre-based centreline. Cached sampling never depends on render timing.
interface Point { x: number; y: number; z: number; distance: number }
const courses = new Map<BlitzCityId, readonly Point[]>();

function spline(a: number, b: number, c: number, d: number, t: number): number {
  return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
}

function course(id: BlitzCityId): readonly Point[] {
  const cached = courses.get(id);
  if (cached) return cached;
  const city = blitzCity(id);
  const points: Point[] = [];
  const count = city.route.length;
  const closed = city.closed !== false;
  const at = (index: number) => closed ? (index + count) % count : Math.max(0, Math.min(count - 1, index));
  const segments = closed ? count : count - 1;
  for (let index = 0; index <= segments * 96; index++) {
    const segment = Math.min(segments - 1, Math.floor(index / 96));
    const t = index / 96 - segment;
    const indices = [at(segment - 1), at(segment), at(segment + 1), at(segment + 2)];
    const coord = (axis: 0 | 1) => spline(...indices.map(i => city.route[i]![axis]) as [number, number, number, number], t);
    points.push({ x: coord(0), z: coord(1), y: spline(...indices.map(i => city.routeElevation[i] ?? 0) as [number, number, number, number], t), distance: 0 });
  }
  // Preserve authored vertical relief while solving the horizontal scale so
  // the 3D arc length equals the competition's stated course length.
  let low = 0, high = 100;
  for (let iteration = 0; iteration < 36; iteration++) {
    const scale = (low + high) / 2;
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      length += Math.hypot((b.x - a.x) * scale, b.y - a.y, (b.z - a.z) * scale);
    }
    if (length < city.lengthMeters) low = scale;
    else high = scale;
  }
  const scale = (low + high) / 2;
  points.forEach((p, i) => {
    p.x *= scale; p.z *= scale;
    if (i > 0) {
      const previous = points[i - 1]!;
      p.distance = previous.distance + Math.hypot(p.x - previous.x, p.y - previous.y, p.z - previous.z);
    }
  });
  courses.set(id, points);
  return points;
}

export function coursePosition(id: BlitzCityId, distance: number): Point {
  const points = course(id);
  const length = points[points.length - 1]!.distance;
  const d = Math.max(0, Math.min(length, distance));
  let low = 0, high = points.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >>> 1;
    if (points[mid]!.distance < d) low = mid;
    else high = mid;
  }
  const a = points[low]!, b = points[high]!;
  const t = (d - a.distance) / Math.max(0.000001, b.distance - a.distance);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, distance: d };
}

export function sampleCourse(id: BlitzCityId, distance: number, lane = 0): BlitzRoutePose {
  const city = blitzCity(id);
  const p = coursePosition(id, distance);
  const a = coursePosition(id, distance - 0.6), b = coursePosition(id, distance + 0.6);
  const headingRadians = Math.atan2(b.x - a.x, b.z - a.z);
  const before = coursePosition(id, distance - 3), after = coursePosition(id, distance + 3);
  const incoming = Math.atan2(p.x - before.x, p.z - before.z);
  const outgoing = Math.atan2(after.x - p.x, after.z - p.z);
  const bend = Math.atan2(Math.sin(outgoing - incoming), Math.cos(outgoing - incoming));
  const fraction = Math.max(0, Math.min(0.999999, distance / city.lengthMeters));
  const surface = city.surfaceSegments.find(s => fraction >= s.start01 && fraction < s.end01)?.surface ?? 'pavement';
  return { x: p.x + Math.cos(headingRadians) * lane, z: p.z - Math.sin(headingRadians) * lane,
    y: p.y, headingRadians, bend, slope: (b.y - a.y) / Math.max(0.001, Math.hypot(b.x - a.x, b.z - a.z)), surface };
}

export function courseGroundLift(id: BlitzCityId, distance: number, lane: number): number {
  const city = blitzCity(id);
  const edge = id === 'lagos' ? Math.max(0, Math.abs(lane) - city.roadWidth / 2) : 0;
  let height = edge * (lane < 0 ? .5 : -.19)
    + courseNoise(distance * .027, lane * .17) * Math.min(1, edge / 4) * Math.min(5, edge * .3);
  for (const feature of city.terrainFeatures) {
    const lip = feature.distance01 * city.lengthMeters;
    if (feature.kind === 'jump' && distance >= lip - 6 && distance < lip && Math.abs(lane) <= city.roadWidth * 0.38) {
      height = Math.max(height, (distance - lip + 6) / 6 * 0.7);
    }
  }
  return height;
}

export function courseNoise(x: number, z: number): number {
  return Math.sin(x * 1.73 + z * .41) * Math.cos(z * 1.19 - x * .27);
}

export function courseTerrainHeight(id: BlitzCityId, distance: number, lane: number): number {
  return coursePosition(id, distance).y + courseGroundLift(id, distance, lane);
}

export interface CourseCollider {
  readonly id: string;
  readonly distance: number;
  readonly lane: number;
  readonly halfWidth: number;
  readonly halfLength: number;
  readonly height: number;
  readonly roadside?: boolean;
  readonly size?: number;
}

const rockSections = new Map<number, readonly CourseCollider[]>();
export function roadsideRocks(section: number): readonly CourseCollider[] {
  const cached = rockSections.get(section);
  if (cached) return cached;
  const rocks = Array.from({ length: 24 }, (_, i) => {
    const distance = section + (i + .7) / 24 * 100;
    const lane = (i % 2 ? -1 : 1) * (6.7 + (i % 4) * 2);
    const size = .45 + Math.abs(courseNoise(distance, lane)) * 1.6;
    return { id: `ridge-roadside-rock-${section}-${i}`, distance, lane, size,
      halfWidth: size, halfLength: size * 1.2, height: size * .95, roadside: true };
  });
  rockSections.set(section, rocks);
  return rocks;
}

const colliderSections = new Map<string, readonly CourseCollider[]>();
export function nearbyCourseColliders(id: BlitzCityId, distance: number): readonly CourseCollider[] {
  const section = Math.floor(distance / 100) * 100, key = `${id}:${section}`;
  const cached = colliderSections.get(key);
  if (cached) return cached;
  const city = blitzCity(id);
  const colliders: CourseCollider[] = city.obstacles.map(obstacle => ({ id: obstacle.id,
    distance: obstacle.distance01 * city.lengthMeters, lane: obstacle.lane, ...obstacleShape(obstacle.id) }));
  if (id === 'lagos') for (let s = Math.max(0, section - 100); s <= section + 100 && s < city.lengthMeters; s += 100) colliders.push(...roadsideRocks(s));
  colliderSections.set(key, colliders);
  return colliders;
}

export function obstacleShape(id: string): { halfWidth: number; halfLength: number; height: number } {
  if (id.includes('rock')) return { halfWidth: 0.8, halfLength: 0.85, height: 1.15 };
  // A van blocks a lane without walling the road the way a double-decker does.
  if (id.includes('van')) return { halfWidth: 0.72, halfLength: 1.05, height: 1.5 };
  if (id.includes('log')) return { halfWidth: 1.1, halfLength: 0.32, height: 0.6 };
  if (id.includes('bus')) return { halfWidth: 0.7, halfLength: 1.25, height: id.includes('london') ? 2.1 : 1.3 };
  if (id.includes('barrier')) return { halfWidth: 0.9, halfLength: 0.15, height: 1.35 };
  if (id.includes('crate')) return { halfWidth: 0.6, halfLength: 0.3, height: 1.35 };
  return { halfWidth: 0.55, halfLength: 0.85, height: 1.2 };
}
