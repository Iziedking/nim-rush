export type BlitzRoadPoint = readonly [number, number];

export interface BlitzRoadJoin {
  readonly left: BlitzRoadPoint;
  readonly right: BlitzRoadPoint;
}

export interface BlitzRoadRibbon {
  readonly positions: readonly number[];
  readonly indices: readonly number[];
  readonly joins: readonly BlitzRoadJoin[];
}

export function buildBlitzRoadRibbon(route: readonly BlitzRoadPoint[], width: number): BlitzRoadRibbon {
  if (route.length < 3) throw new Error('A Blitz road needs at least three route points.');
  if (!Number.isFinite(width) || width <= 0) throw new Error('A Blitz road width must be positive.');

  const halfWidth = width / 2;
  const joins = route.map((point, index): BlitzRoadJoin => {
    const previous = route[(index - 1 + route.length) % route.length]!;
    const next = route[(index + 1) % route.length]!;
    const incoming = normalize(point[0] - previous[0], point[1] - previous[1]);
    const outgoing = normalize(next[0] - point[0], next[1] - point[1]);
    const previousNormal: BlitzRoadPoint = [-incoming[1], incoming[0]];
    const nextNormal: BlitzRoadPoint = [-outgoing[1], outgoing[0]];
    const miter = normalize(previousNormal[0] + nextNormal[0], previousNormal[1] + nextNormal[1]);
    const alignment = Math.max(0.34, Math.abs(miter[0] * nextNormal[0] + miter[1] * nextNormal[1]));
    const extension = Math.min(halfWidth * 1.6, halfWidth / alignment);
    return {
      left: [point[0] + miter[0] * extension, point[1] + miter[1] * extension],
      right: [point[0] - miter[0] * extension, point[1] - miter[1] * extension],
    };
  });

  const positions = joins.flatMap((join) => [join.left[0], 0, join.left[1], join.right[0], 0, join.right[1]]);
  const indices: number[] = [];
  for (let index = 0; index < joins.length; index += 1) {
    const next = (index + 1) % joins.length;
    const left = index * 2;
    const right = left + 1;
    const nextLeft = next * 2;
    const nextRight = nextLeft + 1;
    indices.push(left, nextLeft, right, right, nextLeft, nextRight);
  }
  return { positions, indices, joins };
}

function normalize(x: number, y: number): BlitzRoadPoint {
  const length = Math.hypot(x, y);
  if (length < 0.0001) throw new Error('A Blitz route cannot contain repeated adjacent points.');
  return [x / length, y / length];
}

