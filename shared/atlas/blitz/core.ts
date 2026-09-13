import { blitzCity } from './cities';
import { selectBlitzMissions } from './missions';
import type { BlitzCityId, BlitzInput, BlitzMissionState, BlitzRoutePose, BlitzRunState } from './types';

export const BLITZ_TICK_RATE = 30;
export const BLITZ_LIMIT_SECONDS = 90;
const COUNTDOWN_TICKS = BLITZ_TICK_RATE * 3;
const RELAY_WINDOW_TICKS = BLITZ_TICK_RATE * 4;
const GATE_FRACTIONS = [0.24, 0.51, 0.77] as const;

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
  const boostActive = input.boost && state.boostEnergy > 0.25;
  const laneStep = steer * (driftActive ? 0.17 : 0.105);
  const laneOffset = clamp((state.laneOffset + laneStep) * (Math.abs(steer) < 0.04 ? 0.997 : 1), -city.roadWidth * 0.72, city.roadWidth * 0.72);
  const offRoad = Math.abs(laneOffset) > city.roadWidth * 0.5;
  const targetSpeed = offRoad ? 14 : city.baseSpeedMps + (boostActive ? 8.5 : 0) - (driftActive ? 1.1 : 0);
  let speedMps = approach(state.speedMps, targetSpeed, state.speedMps < targetSpeed ? 0.38 : 0.55);
  let boostEnergy = clamp(state.boostEnergy + (driftActive ? 0.38 : 0.045) - (boostActive ? 1.05 : 0), 0, 100);
  const distanceMeters = Math.min(city.lengthMeters, state.distanceMeters + speedMps / BLITZ_TICK_RATE);
  let distanceScore = Math.floor(distanceMeters * 10);
  let driftScore = state.driftScore + (driftActive ? Math.max(1, Math.round(Math.abs(steer) * speedMps * 0.16)) : 0);
  let relayScore = state.relayScore;
  let penaltyScore = state.penaltyScore;
  let collisions = state.collisions;
  let nearMisses = state.nearMisses;
  let lastImpactTick = state.lastImpactTick;
  const processedObstacleIds = [...state.processedObstacleIds];
  let missions = state.missions.map((mission) => ({ ...mission }));
  let activeRelay = state.activeRelay ? { ...state.activeRelay } : null;

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
      boostEnergy = Math.min(100, boostEnergy + 24);
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
  return withScore({
    ...state,
    phase: finished ? 'finished' : timedOut ? 'timeout' : 'running',
    tick: state.tick + 1,
    elapsedTicks,
    elapsedMs,
    distanceMeters,
    speedMps,
    laneOffset,
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
  return { x: x + normalX * laneOffset, z: z + normalZ * laneOffset, headingRadians, bend };
}

function withScore(state: Omit<BlitzRunState, 'score'> & { score?: number }): BlitzRunState {
  return { ...state, score: Math.max(0, state.distanceScore + state.driftScore + state.relayScore + state.timeBonus - state.penaltyScore) };
}

function validateInput(input: BlitzInput): BlitzInput {
  if (!Number.isFinite(input.steer) || input.steer < -1 || input.steer > 1 || typeof input.drift !== 'boolean' || typeof input.boost !== 'boolean' || input.relayChoice !== undefined && input.relayChoice !== 'left' && input.relayChoice !== 'right') throw new Error('Beacon Blitz input is invalid.');
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
