import { blitzCity } from './cities';
import { selectBlitzMissions } from './missions';
import { blitzSurface } from './surfaces';
import type { BlitzCityId, BlitzInput, BlitzMissionState, BlitzPhysicsEvent, BlitzRoutePose, BlitzRunState, BlitzSurface } from './types';

export const BLITZ_TICK_RATE = 30;
export const BLITZ_LIMIT_SECONDS = 90;
const COUNTDOWN_TICKS = BLITZ_TICK_RATE * 3;
// Eight seconds gives a touch player time to read the Nimiq decision and
// choose a route while the bike keeps moving at full pace.
const RELAY_WINDOW_TICKS = BLITZ_TICK_RATE * 8;
const GATE_FRACTIONS = [0.24, 0.51, 0.77] as const;
/*
 * The boost economy, per tick at 30 ticks a second.
 *
 * Net drain while boosting is 0.45 a tick, so a full tank is about four and a
 * half seconds of boost and the 28 a run starts with is about two. Riding
 * refills it in twenty seconds; drifting refills it in four and a half. That
 * gap is the point: drift already carries risk, and this is what pays for it.
 */
const BOOST_MAX = 60;
const BOOST_DRAIN = 0.55;
const BOOST_IDLE_REGEN = 0.1;
const BOOST_DRIFT_REGEN = 0.45;
/** Charge needed to *start* a boost, so it cannot stutter on at empty. */
const BOOST_ENGAGE_ENERGY = 9;

export function createBlitzRun(input: { cityId: BlitzCityId; seed: string }): BlitzRunState {
  const city = blitzCity(input.cityId);
  const missions: BlitzMissionState[] = selectBlitzMissions(input.seed).map((mission, index) => ({
    ...mission,
    gateDistance: city.lengthMeters * GATE_FRACTIONS[index]!,
    resolved: false,
    selectedChoice: null,
    correct: null,
  }));
  return withScore({
    version: 1,
    cityId: input.cityId,
    seed: input.seed,
    phase: 'countdown',
    tick: 0,
    countdownTicks: COUNTDOWN_TICKS,
    elapsedTicks: 0,
    elapsedMs: 0,
    distanceMeters: 0,
    speedMps: 0,
    laneOffset: 0,
    lateralVelocityMps: 0,
    heightMeters: 0,
    verticalVelocityMps: 0,
    airborne: false,
    surface: 'pavement',
    lastEvent: null,
    boostEnergy: 28,
    boostActive: false,
    driftActive: false,
    distanceScore: 0,
    driftScore: 0,
    relayScore: 0,
    timeBonus: 0,
    penaltyScore: 0,
    score: 0,
    collisions: 0,
    nearMisses: 0,
    missions,
    activeRelay: null,
    processedObstacleIds: [],
    processedFeatureIds: [],
    lastImpactTick: -BLITZ_TICK_RATE,
  });
}

export function stepBlitzRun(state: BlitzRunState, rawInput: BlitzInput): BlitzRunState {
  const input = validateInput(rawInput);
  if (state.phase === 'finished' || state.phase === 'timeout') return state;
  if (state.phase === 'countdown') {
    const countdownTicks = Math.max(0, state.countdownTicks - 1);
    return { ...state, tick: state.tick + 1, countdownTicks, phase: countdownTicks === 0 ? 'running' : 'countdown' };
  }

  const city = blitzCity(state.cityId);
  const elapsedTicks = state.elapsedTicks + 1;
  const elapsedMs = Math.round(elapsedTicks * 1_000 / BLITZ_TICK_RATE);
  const steer = input.steer;
  const driftActive = input.drift && Math.abs(steer) >= 0.2 && state.speedMps >= 8;
  const brakeActive = input.brake === true;
  const routeSurface = surfaceAt(city, state.distanceMeters);
  const surface = Math.abs(state.laneOffset) > city.roadWidth * 0.5 ? 'dirt' : routeSurface;
  const surfaceProfile = blitzSurface(surface);
  /*
   * Boost needs a real charge to start, and only needs a spark to continue.
   *
   * The single threshold made boost stutter: at empty, idle regen crossed 0.25
   * every few ticks, so holding the button flicked boost on for one tick, off
   * for four, on for one - a visible judder and a speed line that never
   * settled. Requiring a proper charge to engage, then letting it run to zero,
   * makes a boost an event with a beginning and an end.
  */
  const boostActive = input.boost && (state.boostActive ? state.boostEnergy > 0.25 : state.boostEnergy >= BOOST_ENGAGE_ENERGY);
  const lateralAcceleration = steer * (driftActive ? 13 : 8) * surfaceProfile.grip;
  let lateralVelocityMps = clamp(state.lateralVelocityMps + lateralAcceleration / BLITZ_TICK_RATE, -12, 12);
  lateralVelocityMps *= driftActive ? 0.988 : Math.pow(surfaceProfile.grip, 0.35) * 0.94;
  const laneOffset = clamp(state.laneOffset + lateralVelocityMps / BLITZ_TICK_RATE, -city.roadWidth * 0.72, city.roadWidth * 0.72);
  const offRoad = Math.abs(laneOffset) > city.roadWidth * 0.5;
  const targetSpeed = offRoad ? 14 : city.baseSpeedMps * surfaceProfile.resistance + (boostActive ? 8.5 : 0) - (driftActive ? 1.1 : 0) - (brakeActive ? 8 : 0);
  // A bike should hook up immediately after GO. Keep the authoritative target
  // speed unchanged, but make the launch response feel responsive on touch.
  let speedMps = approach(state.speedMps, targetSpeed, state.speedMps < targetSpeed ? 0.68 : brakeActive ? 1.02 * surfaceProfile.braking : 0.55);
  /*
   * The old economy drained 1.05 a tick against a 28 charge: 31.5 a second, so
   * a boost lasted 1.06 seconds and then never returned, because idle regen of
   * 0.045 a tick needs ten minutes to refill. A 90 second run therefore sat at
   * exactly base speed almost from end to end, and a racing game reads as fast
   * because its speed *changes*. Boost is now about two and a half seconds,
   * refills in roughly six while riding, and refills far faster if you drift
   * for it - which makes drifting worth the risk it already carries.
   */
  let boostEnergy = clamp(state.boostEnergy + (driftActive ? BOOST_DRIFT_REGEN : BOOST_IDLE_REGEN) - (boostActive ? BOOST_DRAIN : 0), 0, BOOST_MAX);
  const distanceMeters = Math.min(city.lengthMeters, state.distanceMeters + speedMps / BLITZ_TICK_RATE);
  let distanceScore = Math.floor(distanceMeters * 10);
  let driftScore = state.driftScore + (driftActive ? Math.max(1, Math.round(Math.abs(steer) * speedMps * 0.16)) : 0);
  let relayScore = state.relayScore;
  let penaltyScore = state.penaltyScore;
  let collisions = state.collisions;
  let nearMisses = state.nearMisses;
  let lastImpactTick = state.lastImpactTick;
  const processedObstacleIds = [...state.processedObstacleIds];
  const processedFeatureIds = [...state.processedFeatureIds];
  let missions = state.missions.map((mission) => ({ ...mission }));
  let activeRelay = state.activeRelay ? { ...state.activeRelay } : null;
  let heightMeters = state.heightMeters;
  let verticalVelocityMps = state.verticalVelocityMps;
  let airborne = state.airborne;
  let lastEvent: BlitzPhysicsEvent | null = state.surface === surface ? null : { type: 'surface-change', tick: state.tick + 1, intensity: 0.5, surface };

  if (airborne) {
    heightMeters += verticalVelocityMps / BLITZ_TICK_RATE;
    verticalVelocityMps -= 10.8 / BLITZ_TICK_RATE;
    if (heightMeters <= 0) {
      const landingIntensity = clamp(Math.abs(verticalVelocityMps) / 8, 0.2, 1);
      heightMeters = 0;
      verticalVelocityMps = 0;
      airborne = false;
      lastEvent = { type: 'landing', tick: state.tick + 1, intensity: landingIntensity, surface };
    }
  }

  for (const feature of city.terrainFeatures) {
    const featureDistance = city.lengthMeters * feature.distance01;
    if (processedFeatureIds.includes(feature.id) || state.distanceMeters >= featureDistance || distanceMeters < featureDistance) continue;
    processedFeatureIds.push(feature.id);
    if (feature.kind === 'jump' && !airborne) {
      airborne = true;
      heightMeters = 0.06;
      verticalVelocityMps = feature.impulseMps + Math.max(0, speedMps - city.baseSpeedMps) * 0.08;
      lastEvent = { type: 'launch', tick: state.tick + 1, intensity: clamp(verticalVelocityMps / 7, 0.4, 1), surface: feature.surface };
    } else if (feature.kind === 'rough') {
      speedMps *= 0.86;
      penaltyScore += 110;
      lastEvent = { type: 'impact', tick: state.tick + 1, intensity: 0.35, surface: feature.surface };
    }
  }

  if (offRoad && elapsedTicks - lastImpactTick >= BLITZ_TICK_RATE) {
    penaltyScore += 90;
    lastImpactTick = elapsedTicks;
  }

  for (const obstacle of city.obstacles) {
    const obstacleDistance = city.lengthMeters * obstacle.distance01;
    if (processedObstacleIds.includes(obstacle.id) || state.distanceMeters >= obstacleDistance || distanceMeters < obstacleDistance) continue;
    processedObstacleIds.push(obstacle.id);
    const clearance = Math.abs(laneOffset - obstacle.lane);
    if (clearance < 0.82) {
      collisions += 1;
      penaltyScore += 420;
      speedMps *= 0.56;
      boostEnergy = Math.max(0, boostEnergy - 15);
      lastImpactTick = elapsedTicks;
      lastEvent = { type: 'impact', tick: state.tick + 1, intensity: 1, surface };
    } else if (clearance < 1.7) {
      nearMisses += 1;
      distanceScore += 180;
    }
  }

  if (!activeRelay) {
    const missionIndex = missions.findIndex((mission) => !mission.resolved && distanceMeters >= mission.gateDistance);
    if (missionIndex >= 0) activeRelay = { missionIndex, expiresAtTick: elapsedTicks + RELAY_WINDOW_TICKS };
  }
  if (activeRelay && input.relayChoice) {
    const mission = missions[activeRelay.missionIndex]!;
    const correct = input.relayChoice === mission.correctChoice;
    missions[activeRelay.missionIndex] = { ...mission, resolved: true, selectedChoice: input.relayChoice, correct };
    if (correct) {
      relayScore += 1_200;
      boostEnergy = Math.min(BOOST_MAX, boostEnergy + 24);
    } else {
      penaltyScore += 300;
      speedMps *= 0.78;
    }
    activeRelay = null;
  } else if (activeRelay && elapsedTicks >= activeRelay.expiresAtTick) {
    const mission = missions[activeRelay.missionIndex]!;
    missions[activeRelay.missionIndex] = { ...mission, resolved: true, selectedChoice: null, correct: false };
    penaltyScore += 360;
    speedMps *= 0.72;
    activeRelay = null;
  }

  const finished = distanceMeters >= city.lengthMeters;
  const timedOut = !finished && elapsedTicks >= BLITZ_LIMIT_SECONDS * BLITZ_TICK_RATE;
  const timeBonus = finished ? Math.max(0, Math.floor((BLITZ_LIMIT_SECONDS * BLITZ_TICK_RATE - elapsedTicks) / BLITZ_TICK_RATE) * 100) : 0;
  if (driftActive && Math.abs(lateralVelocityMps) >= surfaceProfile.skidThreshold) {
    lastEvent = { type: 'skid', tick: state.tick + 1, intensity: clamp(Math.abs(lateralVelocityMps) / 10, 0.35, 1), surface };
  }
  if (state.boostActive !== boostActive) {
    lastEvent = { type: boostActive ? 'boost-start' : 'boost-end', tick: state.tick + 1, intensity: 1, surface };
  }
  return withScore({
    ...state,
    phase: finished ? 'finished' : timedOut ? 'timeout' : 'running',
    tick: state.tick + 1,
    elapsedTicks,
    elapsedMs,
    distanceMeters,
    speedMps,
    laneOffset,
    lateralVelocityMps,
    heightMeters,
    verticalVelocityMps,
    airborne,
    surface,
    lastEvent,
    boostEnergy,
    boostActive,
    driftActive,
    distanceScore,
    driftScore,
    relayScore,
    timeBonus,
    penaltyScore,
    collisions,
    nearMisses,
    missions,
    activeRelay,
    processedObstacleIds,
    processedFeatureIds,
    lastImpactTick,
  });
}

export function sampleBlitzRoute(cityId: BlitzCityId, distanceMeters: number, laneOffset = 0): BlitzRoutePose {
  const city = blitzCity(cityId);
  const points = city.route;
  const loop = clamp(distanceMeters / city.lengthMeters, 0, 0.999999) * points.length;
  const index = Math.floor(loop);
  const amount = loop - index;
  const previous = points[(index - 1 + points.length) % points.length]!;
  const start = points[index]!;
  const end = points[(index + 1) % points.length]!;
  const after = points[(index + 2) % points.length]!;
  const x = lerp(start[0], end[0], smooth(amount));
  const z = lerp(start[1], end[1], smooth(amount));
  const tangentX = end[0] - start[0];
  const tangentZ = end[1] - start[1];
  const tangentLength = Math.max(0.001, Math.hypot(tangentX, tangentZ));
  const normalX = -tangentZ / tangentLength;
  const normalZ = tangentX / tangentLength;
  const headingRadians = Math.atan2(tangentX, tangentZ);
  const incoming = Math.atan2(start[0] - previous[0], start[1] - previous[1]);
  const outgoing = Math.atan2(after[0] - end[0], after[1] - end[1]);
  const bend = Math.atan2(Math.sin(outgoing - incoming), Math.cos(outgoing - incoming));
  const heightStart = city.routeElevation[index] ?? 0;
  const heightEnd = city.routeElevation[(index + 1) % city.routeElevation.length] ?? heightStart;
  const terrainY = lerp(heightStart, heightEnd, smooth(amount));
  const previousHeight = city.routeElevation[(index - 1 + city.routeElevation.length) % city.routeElevation.length] ?? heightStart;
  const nextHeight = city.routeElevation[(index + 1) % city.routeElevation.length] ?? heightEnd;
  const slope = (nextHeight - previousHeight) / Math.max(0.001, tangentLength * 2);
  return { x: x + normalX * laneOffset, z: z + normalZ * laneOffset, y: terrainY, headingRadians, bend, slope, surface: surfaceAt(city, distanceMeters) };
}

function surfaceAt(city: ReturnType<typeof blitzCity>, distanceMeters: number): BlitzSurface {
  const fraction = clamp(distanceMeters / city.lengthMeters, 0, 0.999999);
  const segment = city.surfaceSegments.find((candidate) => fraction >= candidate.start01 && fraction < candidate.end01);
  return segment?.surface ?? 'pavement';
}

function withScore(state: Omit<BlitzRunState, 'score'> & { score?: number }): BlitzRunState {
  return { ...state, score: Math.max(0, state.distanceScore + state.driftScore + state.relayScore + state.timeBonus - state.penaltyScore) };
}

function validateInput(input: BlitzInput): BlitzInput {
  if (!Number.isFinite(input.steer) || input.steer < -1 || input.steer > 1 || typeof input.drift !== 'boolean' || typeof input.boost !== 'boolean' || input.brake !== undefined && typeof input.brake !== 'boolean' || input.relayChoice !== undefined && input.relayChoice !== 'left' && input.relayChoice !== 'right') throw new Error('Beacon Blitz input is invalid.');
  return input;
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function smooth(value: number): number {
  return value * value * (3 - 2 * value);
}
