/*
 * The pack.
 *
 * A rival is another rider's finished run, replayed beside you as a solid
 * bike. You can be held up by one, you can squeeze past one, and you can put a
 * shoulder into one on the way through - which is where the whole feeling of a
 * downhill race comes from. It is not multiplayer and does not pretend to be:
 * there is no netcode, nothing to desync, and nothing to wait for.
 *
 * ONE-WAY, AND HONESTLY SO
 *
 * Contact moves you and never them. Their run was ridden before yours existed,
 * so there is no version of this where they swerve - and faking a reaction
 * would make the replay a lie and break the verification that makes the board
 * worth anything. So the game is overtaking traffic, not fighting it.
 *
 * WHY A SAMPLED PATH AND NOT A TRACE
 *
 * A rival could be replayed by re-simulating their inputs, and that costs
 * almost nothing - 2.9us a tick. But it would mean carrying a full input trace
 * for every rival: 2294 frames, about 147 KB each. The positions alone, at
 * 5 Hz, are 8.2 KB - eighteen times smaller - and a position is all this needs,
 * because a rival's line is fixed and nothing about it has to be recomputed.
 *
 * WHY DETERMINISM MATTERS HERE
 *
 * A solid rival changes your physics. If the server re-simulated your ranked
 * run against a different set of rivals - or none - it would compute a
 * different score and refuse an honest run. So the rival set is pinned to the
 * ticket the server issued, and both sides ride the same pack.
 */

/** One sample every six ticks: 5 Hz against a 30 Hz simulation. */
export const BLITZ_RIVAL_SAMPLE_TICKS = 6;

/** How close, along the road, counts as sharing the same piece of trail. */
const CONTACT_HALF_LENGTH = 1.15;
/** And across it. Two sets of bars, near enough. */
const CONTACT_HALF_WIDTH = 0.52;

export interface BlitzRivalPath {
  readonly runId: string;
  readonly username: string;
  /** Metres down the course at each sample. Monotonic. */
  readonly distance: readonly number[];
  /** Lane offset at each sample, in metres from the centre line. */
  readonly lane: readonly number[];
}

export interface BlitzRivalPosition {
  readonly distanceMeters: number;
  readonly laneOffset: number;
}

/**
 * Where a rival is at a given tick.
 *
 * Null once their run ended: a rider who has already finished is off the
 * course, not parked across it. Leaving them in would put an immovable bike on
 * the finish straight of every later run.
 */
export function blitzRivalAt(path: BlitzRivalPath, tick: number): BlitzRivalPosition | null {
  const samples = path.distance.length;
  if (samples === 0 || tick < 0) return null;
  const position = tick / BLITZ_RIVAL_SAMPLE_TICKS;
  const index = Math.floor(position);
  if (index >= samples - 1) {
    // Past the last sample. Hold the final position only if they are still on
    // the course; otherwise they are gone.
    return index === samples - 1
      ? { distanceMeters: path.distance[samples - 1]!, laneOffset: path.lane[samples - 1]! }
      : null;
  }
  // Linear between samples. At 5 Hz and racing speed a rival moves about six
  // metres a sample, so straight interpolation is smooth enough to ride
  // against and cheap enough to do for a whole pack every tick.
  const blend = position - index;
  return {
    distanceMeters: path.distance[index]! + (path.distance[index + 1]! - path.distance[index]!) * blend,
    laneOffset: path.lane[index]! + (path.lane[index + 1]! - path.lane[index]!) * blend,
  };
}

/** True when these two bikes are occupying the same piece of road. */
export function blitzRivalContact(
  rider: BlitzRivalPosition,
  rival: BlitzRivalPosition,
): boolean {
  return Math.abs(rider.distanceMeters - rival.distanceMeters) < CONTACT_HALF_LENGTH * 2
    && Math.abs(rider.laneOffset - rival.laneOffset) < CONTACT_HALF_WIDTH * 2;
}

export interface BlitzRivalGap {
  readonly runId: string;
  readonly username: string;
  /** Metres ahead of the rider. Negative when the rider is ahead. */
  readonly metres: number;
  /** Seconds, at the rider's current speed. Null when stopped. */
  readonly seconds: number | null;
}

/**
 * The gap list, the way a downhill broadcast shows it.
 *
 * Sorted by who is closest, nearest first, so the name at the top is the one
 * actually being raced. Riders who have finished drop out rather than sitting
 * at the bottom of the list forever.
 */
export function blitzRivalGaps(input: {
  readonly rivals: readonly BlitzRivalPath[];
  readonly tick: number;
  readonly distanceMeters: number;
  readonly speedMps: number;
}): readonly BlitzRivalGap[] {
  const gaps: BlitzRivalGap[] = [];
  for (const rival of input.rivals) {
    const at = blitzRivalAt(rival, input.tick);
    if (!at) continue;
    const metres = at.distanceMeters - input.distanceMeters;
    gaps.push({
      runId: rival.runId,
      username: rival.username,
      metres,
      seconds: input.speedMps > 0.5 ? metres / input.speedMps : null,
    });
  }
  return gaps.sort((left, right) => Math.abs(left.metres) - Math.abs(right.metres));
}

/**
 * Turn a finished run's per-tick positions into a rival path.
 *
 * Takes the positions rather than the trace so that whoever has already
 * simulated a run - the server, on verification - can record its line without
 * simulating it twice.
 */
export function blitzRivalPathFrom(input: {
  readonly runId: string;
  readonly username: string;
  readonly positions: readonly BlitzRivalPosition[];
}): BlitzRivalPath {
  const distance: number[] = [];
  const lane: number[] = [];
  for (let index = 0; index < input.positions.length; index += BLITZ_RIVAL_SAMPLE_TICKS) {
    const position = input.positions[index]!;
    // Rounded: a centimetre of lane is below anything a rider can perceive and
    // well below what changes a collision, and it keeps the payload small.
    distance.push(Math.round(position.distanceMeters * 100) / 100);
    lane.push(Math.round(position.laneOffset * 100) / 100);
  }
  return { runId: input.runId, username: input.username, distance, lane };
}

/** A closed guard, because a rival path arrives over the wire. */
export function isBlitzRivalPath(value: unknown): value is BlitzRivalPath {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const path = value as Record<string, unknown>;
  if (typeof path.runId !== 'string' || typeof path.username !== 'string') return false;
  if (!Array.isArray(path.distance) || !Array.isArray(path.lane)) return false;
  if (path.distance.length !== path.lane.length) return false;
  // A run is at most ninety seconds, so a path cannot be longer than that.
  if (path.distance.length > 600) return false;
  return path.distance.every((value) => Number.isFinite(value))
    && path.lane.every((value) => Number.isFinite(value));
}

/**
 * Where you are in the pack, right now.
 *
 * A gap list says who is near; it does not say whether you are winning. That
 * is the number a rider actually races against, and the one Downhill puts on
 * screen from the first second to the last.
 *
 * A rival whose recorded path has already ended finished ahead of you - they
 * got down the hill and you are still on it - so they count as ahead rather
 * than dropping out of the field. Otherwise a rider would climb the order by
 * being slow, which is the opposite of a race.
 */
export function blitzFieldPosition(input: {
  readonly rivals: readonly BlitzRivalPath[];
  readonly tick: number;
  readonly distanceMeters: number;
}): { readonly place: number; readonly field: number } {
  let ahead = 0;
  for (const rival of input.rivals) {
    const at = blitzRivalAt(rival, input.tick);
    if (!at) { ahead += 1; continue; }
    if (at.distanceMeters > input.distanceMeters) ahead += 1;
  }
  return { place: ahead + 1, field: input.rivals.length + 1 };
}
