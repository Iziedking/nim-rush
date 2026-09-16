import { BLITZ_LINE_GATES, blitzCity, blitzEnabledObstacles } from './cities';
import { missionWindow, selectBlitzMissions } from './missions';
import { blitzRules, type BlitzDifficultyRules } from './rules';
import { blitzSurface } from './surfaces';
import { courseGroundLift, courseTerrainHeight, nearbyCourseColliders, sampleCourse } from './course';
import type { BlitzCityId, BlitzDifficulty, BlitzInput, BlitzMissionState, BlitzPhysicsEvent, BlitzRoutePose, BlitzRunState, BlitzScoreBreakdown, BlitzSurface } from './types';

export const BLITZ_TICK_RATE = 30;
export const BLITZ_LIMIT_SECONDS = 90;
const COUNTDOWN_TICKS = BLITZ_TICK_RATE * 3;
// The gates a rider can see. One list, shared with the renderer, because a
// rider threading the gate in front of them must be the rider being scored.
const LINE_GATE_FRACTIONS = BLITZ_LINE_GATES;
const BOOST_MAX = 60;
const BOOST_DRAIN = 0.55;
const BOOST_IDLE_REGEN = 0.1;
const BOOST_DRIFT_REGEN = 0.45;
const BOOST_ENGAGE_ENERGY = 9;

export function createBlitzRun(input: { cityId: BlitzCityId; seed: string; difficulty?: BlitzDifficulty }): BlitzRunState {
  const difficulty = input.difficulty ?? 'rookie';
  const rules = blitzRules(difficulty);
  const city = blitzCity(input.cityId);
  const missions: BlitzMissionState[] = selectBlitzMissions(input.seed, difficulty).map((mission) => {
    const window = missionWindow(mission.kind, rules.riskWindowStart, rules.riskWindowEnd);
    return {
      ...mission,
      gateDistance: city.lengthMeters * window.start,
      windowEndDistance: city.lengthMeters * window.end,
      progress: 0,
      status: 'pending',
      startedAtTick: null,
      contactsAtStart: null,
      failureReason: null,
      resolved: false,
      selectedChoice: null,
      correct: null,
    };
  });
  return withScore({
    version: 1,
    rulesetVersion: rules.rulesetVersion,
    difficulty,
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
    lineScore: 0,
    controlScore: 0,
    airtimeScore: 0,
    missionScore: 0,
    driftScore: 0,
    timeBonus: 0,
    collisionPenalty: 0,
    missedGatePenalty: 0,
    offRoadPenalty: 0,
    collisions: 0,
    nearMisses: 0,
    missions,
    activeMission: null,
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
  const rules = blitzRules(state.difficulty);
  const elapsedTicks = state.elapsedTicks + 1;
  const elapsedMs = Math.round(elapsedTicks * 1_000 / BLITZ_TICK_RATE);
  const driftActive = input.drift && Math.abs(input.steer) >= 0.2 && state.speedMps >= 8;
  const brakeActive = input.brake === true;
  const routeSurface = surfaceAt(city, state.distanceMeters);
  const surface = Math.abs(state.laneOffset) > city.roadWidth * 0.5 ? 'grass' : routeSurface;
  const surfaceProfile = blitzSurface(surface);
  const boostActive = surface !== 'grass' && input.boost
    && (state.boostActive ? state.boostEnergy > 0.25 : state.boostEnergy >= BOOST_ENGAGE_ENERGY);
  const lateralAcceleration = input.steer * (driftActive ? 13 : 8) * surfaceProfile.grip;
  let lateralVelocityMps = clamp(state.lateralVelocityMps + lateralAcceleration / BLITZ_TICK_RATE, -12, 12);
  lateralVelocityMps *= driftActive ? 0.988 : Math.pow(surfaceProfile.grip, 0.35) * 0.94;
  let laneOffset = clamp(state.laneOffset + lateralVelocityMps / BLITZ_TICK_RATE, -city.roadWidth * 0.72, city.roadWidth * 0.72);
  const offRoad = Math.abs(laneOffset) > city.roadWidth * 0.5;
  const shoulderDepth = Math.max(0, Math.abs(laneOffset) - city.roadWidth * 0.5);
  const grassProfile = blitzSurface('grass');
  const targetSpeed = brakeActive ? 0 : offRoad
    ? city.baseSpeedMps * grassProfile.resistance / (1 + shoulderDepth * 0.18)
    : city.baseSpeedMps * surfaceProfile.resistance + (boostActive ? 8.5 : 0) - (driftActive ? 1.1 : 0);
  let speedMps = approach(state.speedMps, targetSpeed, state.speedMps < targetSpeed ? 0.68 : brakeActive ? 1.02 * surfaceProfile.braking : 0.55);
  if (offRoad && !brakeActive && !state.airborne) {
    const here = sampleCourse(city.id, state.distanceMeters);
    const ahead = sampleCourse(city.id, state.distanceMeters + 1);
    const grade = ahead.y + courseGroundLift(city.id, state.distanceMeters + 1, laneOffset)
      - here.y - courseGroundLift(city.id, state.distanceMeters, laneOffset);
    const acceleration = clamp((targetSpeed - state.speedMps) * 0.85 - 9.81 * clamp(grade, -0.5, 0.5), -7, 3.5);
    speedMps = Math.max(0, state.speedMps + acceleration / BLITZ_TICK_RATE);
  }
  if (state.airborne && !brakeActive) speedMps = state.speedMps;
  let boostEnergy = clamp(state.boostEnergy + (driftActive ? BOOST_DRIFT_REGEN : BOOST_IDLE_REGEN) - (boostActive ? BOOST_DRAIN : 0), 0, BOOST_MAX);
  let distanceMeters = Math.min(city.lengthMeters, state.distanceMeters + speedMps / BLITZ_TICK_RATE);
  let distanceScore = Math.floor(distanceMeters * 10);
  let lineScore = state.lineScore;
  let controlScore = state.controlScore;
  let airtimeScore = state.airtimeScore;
  let missionScore = state.missionScore;
  let driftScore = state.driftScore + (driftActive ? Math.max(1, Math.round(Math.abs(input.steer) * speedMps * 0.16)) : 0);
  let collisionPenalty = state.collisionPenalty;
  let missedGatePenalty = state.missedGatePenalty;
  let offRoadPenalty = state.offRoadPenalty;
  let collisions = state.collisions;
  let nearMisses = state.nearMisses;
  let lastImpactTick = state.lastImpactTick;
  const processedObstacleIds = [...state.processedObstacleIds];
  const processedFeatureIds = [...state.processedFeatureIds];
  let missions = state.missions.map((mission) => ({ ...mission }));
  let heightMeters = state.heightMeters;
  let verticalVelocityMps = state.verticalVelocityMps;
  let airborne = state.airborne;
  let lastEvent: BlitzPhysicsEvent | null = state.surface === surface ? null : { type: 'surface-change', tick: state.tick + 1, intensity: 0.5, surface };

  if (airborne) {
    const terrainRise = sampleCourse(city.id, distanceMeters).y - sampleCourse(city.id, state.distanceMeters).y;
    heightMeters += verticalVelocityMps / BLITZ_TICK_RATE - terrainRise;
    verticalVelocityMps -= 10.8 / BLITZ_TICK_RATE;
    const groundLift = courseGroundLift(city.id, distanceMeters, laneOffset);
    if (heightMeters <= groundLift) {
      const landingIntensity = clamp(Math.abs(verticalVelocityMps) / 8, 0.2, 1);
      heightMeters = groundLift;
      verticalVelocityMps = 0;
      airborne = false;
      lastEvent = { type: 'landing', tick: state.tick + 1, intensity: landingIntensity, surface };
    }
  }

  for (const feature of city.terrainFeatures) {
    const featureDistance = city.lengthMeters * feature.distance01;
    if (processedFeatureIds.includes(feature.id) || state.distanceMeters >= featureDistance || distanceMeters < featureDistance) continue;
    processedFeatureIds.push(feature.id);
    if (feature.kind === 'jump' && !airborne && Math.abs(laneOffset) <= city.roadWidth * 0.38) {
      airborne = true;
      heightMeters = 0.76;
      verticalVelocityMps = feature.impulseMps + Math.max(0, speedMps - city.baseSpeedMps) * 0.08;
      lastEvent = { type: 'launch', tick: state.tick + 1, intensity: clamp(verticalVelocityMps / 7, 0.4, 1), surface: feature.surface };
    } else if (feature.kind === 'rough') {
      speedMps *= 0.86;
      missedGatePenalty += 110;
      lastEvent = { type: 'impact', tick: state.tick + 1, intensity: 0.35, surface: feature.surface };
    }
  }

  if (offRoad && elapsedTicks - lastImpactTick >= BLITZ_TICK_RATE) {
    offRoadPenalty += 90;
    lastImpactTick = elapsedTicks;
  }

  const enabledObstacleIds = new Set(blitzEnabledObstacles(city, rules.difficulty).map((obstacle) => obstacle.id));
  for (const obstacle of nearbyCourseColliders(city.id, state.distanceMeters)) {
    if (!obstacle.roadside && !enabledObstacleIds.has(obstacle.id)) continue;
    const nearFace = obstacle.distance - obstacle.halfLength - 1.1;
    const farFace = obstacle.distance + obstacle.halfLength + 1.1;
    if (state.distanceMeters > farFace || distanceMeters < nearFace) continue;
    const wheelY = sampleCourse(city.id, distanceMeters).y + heightMeters;
    const obstacleTop = courseTerrainHeight(city.id, obstacle.distance, obstacle.lane) + obstacle.height;
    if (airborne && wheelY > obstacleTop + 0.08) continue;
    const hitWidth = obstacle.halfWidth + 0.32;
    const previousLateral = state.laneOffset - obstacle.lane;
    const currentLateral = laneOffset - obstacle.lane;
    const clearance = Math.abs(laneOffset - obstacle.lane);
    const crossesSide = previousLateral * currentLateral < 0;
    if (clearance < hitWidth || crossesSide) {
      // A centered rider with no steer input must not receive an implicit
      // rightward correction. Keep escape direction player- or momentum-led.
      const directionAway = Math.sign(previousLateral) || Math.sign(input.steer) || Math.sign(lateralVelocityMps);
      if (state.distanceMeters <= nearFace + 0.002) distanceMeters = Math.max(state.distanceMeters, nearFace - 0.001);
      else if (directionAway !== 0) laneOffset = obstacle.lane + directionAway * (hitWidth + 0.002);
      if (!processedObstacleIds.includes(obstacle.id)) {
        processedObstacleIds.push(obstacle.id);
        collisions += 1;
        collisionPenalty += 420;
        // Impact removes charge as well as speed, so a collision cannot be
        // hidden behind the score penalty alone.
        boostEnergy = Math.max(0, boostEnergy - 15);
        if (directionAway !== 0) lateralVelocityMps = directionAway * 6;
        lastImpactTick = elapsedTicks;
        lastEvent = { type: 'impact', tick: state.tick + 1, intensity: 1, surface };
      }
      speedMps *= 0.35;
      lastImpactTick = elapsedTicks;
      lastEvent = { type: 'impact', tick: state.tick + 1, intensity: 1, surface };
    } else if (!obstacle.roadside && distanceMeters >= obstacle.distance && !processedObstacleIds.includes(obstacle.id) && clearance < hitWidth + 0.9) {
      processedObstacleIds.push(obstacle.id);
      nearMisses += 1;
    }
  }
  distanceScore += nearMisses * 180;
  for (const fraction of LINE_GATE_FRACTIONS) {
    const gateId = `line-gate-${fraction}`;
    const gateDistance = city.lengthMeters * fraction;
    if (processedFeatureIds.includes(gateId) || state.distanceMeters >= gateDistance || distanceMeters < gateDistance) continue;
    processedFeatureIds.push(gateId);
    if (!airborne && Math.abs(laneOffset) <= city.roadWidth * rules.lineTolerance && collisions === state.collisions) lineScore += 180;
    else missedGatePenalty += 180;
  }
  if (!airborne) heightMeters = courseGroundLift(city.id, distanceMeters, laneOffset);

  const finished = distanceMeters >= city.lengthMeters;
  const timedOut = !finished && elapsedTicks >= BLITZ_LIMIT_SECONDS * BLITZ_TICK_RATE;
  const missionResult = updateMissions({ city, rules, state, missions, distanceMeters, elapsedTicks, input, surface, airborne, collisions, finished, lastEvent });
  missions = missionResult.missions;
  missionScore += missionResult.missionScore;
  controlScore += missionResult.controlScore;
  airtimeScore += missionResult.airtimeScore;
  missedGatePenalty += missionResult.missedGatePenalty;
  const timeBonus = finished ? Math.max(0, Math.floor((BLITZ_LIMIT_SECONDS * BLITZ_TICK_RATE - elapsedTicks) / BLITZ_TICK_RATE) * 100) : 0;
  if (!lastEvent && driftActive && Math.abs(lateralVelocityMps) >= surfaceProfile.skidThreshold) lastEvent = { type: 'skid', tick: state.tick + 1, intensity: clamp(Math.abs(lateralVelocityMps) / 10, 0.35, 1), surface };
  if (!lastEvent && state.boostActive !== boostActive) lastEvent = { type: boostActive ? 'boost-start' : 'boost-end', tick: state.tick + 1, intensity: 1, surface };
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
    lineScore,
    controlScore,
    airtimeScore,
    missionScore,
    driftScore,
    timeBonus,
    collisionPenalty,
    missedGatePenalty,
    offRoadPenalty,
    collisions,
    nearMisses,
    missions,
    activeMission: missionResult.activeMission,
    activeRelay: null,
    processedObstacleIds,
    processedFeatureIds,
    lastImpactTick,
  });
}

type BlitzScoreSource = Pick<BlitzRunState, 'distanceScore' | 'lineScore' | 'controlScore' | 'airtimeScore' | 'missionScore' | 'driftScore' | 'timeBonus' | 'collisionPenalty' | 'missedGatePenalty' | 'offRoadPenalty'>;

export function getBlitzScoreBreakdown(state: BlitzScoreSource): BlitzScoreBreakdown {
  const total = Math.max(0, state.distanceScore + state.lineScore + state.controlScore + state.airtimeScore + state.missionScore + state.driftScore + state.timeBonus - state.collisionPenalty - state.missedGatePenalty - state.offRoadPenalty);
  return {
    finishTime: state.timeBonus,
    racingLine: state.distanceScore + state.lineScore,
    control: state.controlScore,
    airtime: state.airtimeScore,
    missions: state.missionScore,
    drift: state.driftScore,
    collisionPenalties: state.collisionPenalty,
    missedGatePenalties: state.missedGatePenalty + state.offRoadPenalty,
    total,
  };
}

function updateMissions(input: {
  city: ReturnType<typeof blitzCity>;
  rules: BlitzDifficultyRules;
  state: BlitzRunState;
  missions: BlitzMissionState[];
  distanceMeters: number;
  elapsedTicks: number;
  input: BlitzInput;
  surface: BlitzSurface;
  airborne: boolean;
  collisions: number;
  finished: boolean;
  lastEvent: BlitzPhysicsEvent | null;
}): { missions: BlitzMissionState[]; activeMission: BlitzRunState['activeMission']; missionScore: number; controlScore: number; airtimeScore: number; missedGatePenalty: number } {
  let missionScore = 0;
  let controlScore = 0;
  let airtimeScore = 0;
  let missedGatePenalty = 0;
  const missions = input.missions.map((mission) => {
    let next = mission;
    if (next.status === 'pending' && input.distanceMeters >= next.gateDistance) {
      next = { ...next, status: 'active', startedAtTick: input.elapsedTicks, contactsAtStart: input.collisions };
    }
    if (next.status !== 'active') return next;
    const cleanLine = !input.airborne && input.surface !== 'grass'
      && Math.abs(input.state.laneOffset) <= input.city.roadWidth * input.rules.lineTolerance
      && input.collisions === (next.contactsAtStart ?? input.collisions);
    if (next.id === 'line-master') {
      const checkpoint = next.gateDistance + (next.windowEndDistance - next.gateDistance) / next.target * (next.progress + 1);
      if (input.distanceMeters >= checkpoint) {
        if (cleanLine) next = { ...next, progress: next.progress + 1 };
        else next = { ...next, status: 'failed', failureReason: 'The racing line was lost.' };
      }
    } else if (next.id === 'surface-discipline') {
      if (input.surface === 'grass' || input.collisions > (next.contactsAtStart ?? input.collisions)) next = { ...next, status: 'failed', failureReason: 'The surface was left uncontrolled.' };
      else if (input.distanceMeters >= next.windowEndDistance) next = { ...next, progress: 1, status: 'complete' };
    } else if (next.id === 'brake-late-exit-clean') {
      if (input.distanceMeters <= next.windowEndDistance && input.input.brake && input.state.speedMps <= input.rules.controlSpeedCapMps) next = { ...next, progress: 1 };
      else if (input.distanceMeters > next.windowEndDistance) {
        if (next.progress >= 1 && input.state.speedMps >= input.rules.controlExitSpeedMps) next = { ...next, progress: 2, status: 'complete' };
        else next = { ...next, status: 'failed', failureReason: 'The brake point or exit speed was missed.' };
      }
    } else if (next.id === 'air-judge') {
      if (input.lastEvent?.type === 'launch') next = { ...next, progress: 1 };
      if (input.lastEvent?.type === 'landing') {
        if (next.progress >= 1 && input.lastEvent.intensity <= 0.75) next = { ...next, progress: 2, status: 'complete' };
        else next = { ...next, status: 'failed', failureReason: 'The landing was too heavy.' };
      } else if (input.distanceMeters > next.windowEndDistance && next.progress < 2) next = { ...next, status: 'failed', failureReason: 'The jump was not completed.' };
    } else if (next.id === 'risk-route') {
      if (input.distanceMeters <= next.windowEndDistance && input.surface === 'grass') next = { ...next, progress: 1 };
      else if (input.distanceMeters > next.windowEndDistance) {
        if (next.progress >= 1 && input.surface !== 'grass' && input.collisions === (next.contactsAtStart ?? input.collisions)) next = { ...next, progress: 2, status: 'complete' };
        else next = { ...next, status: 'failed', failureReason: 'The risk line was not recovered cleanly.' };
      }
    } else if (next.id === 'perfect-descent' && input.finished) {
      const otherComplete = input.missions.filter((candidate) => candidate.id !== next.id).every((candidate) => candidate.status === 'complete');
      next = input.collisions === 0 && otherComplete ? { ...next, progress: 1, status: 'complete' } : { ...next, status: 'failed', failureReason: 'A clean descent still had unfinished work.' };
    }
    if (next.progress >= next.target && next.status === 'active') next = { ...next, status: 'complete' };
    if (next.status === 'complete' && mission.status !== 'complete') missionScore += next.bonus;
    if (next.id === 'brake-late-exit-clean' && next.progress > mission.progress) controlScore += 280;
    if (next.id === 'air-judge' && next.status === 'complete' && mission.status !== 'complete') airtimeScore += 350;
    if (next.status === 'failed' && mission.status !== 'failed') missedGatePenalty += 220;
    return next;
  });
  const activeIndex = missions.findIndex((mission) => mission.status === 'active');
  const activeMission = activeIndex < 0 ? null : {
    missionIndex: activeIndex,
    expiresAtTick: input.elapsedTicks + Math.max(1, Math.round((missions[activeIndex]!.windowEndDistance - input.distanceMeters) / Math.max(input.state.speedMps, 1) * BLITZ_TICK_RATE)),
  };
  return { missions, activeMission, missionScore, controlScore, airtimeScore, missedGatePenalty };
}

export function sampleBlitzRoute(cityId: BlitzCityId, distanceMeters: number, laneOffset = 0): BlitzRoutePose {
  return sampleCourse(cityId, distanceMeters, laneOffset);
}

function surfaceAt(city: ReturnType<typeof blitzCity>, distanceMeters: number): BlitzSurface {
  const fraction = clamp(distanceMeters / city.lengthMeters, 0, 0.999999);
  const segment = city.surfaceSegments.find((candidate) => fraction >= candidate.start01 && fraction < candidate.end01);
  return segment?.surface ?? 'pavement';
}

function withScore(state: Omit<BlitzRunState, 'score' | 'scoreBreakdown' | 'penaltyScore' | 'relayScore'>): BlitzRunState {
  const breakdown = getBlitzScoreBreakdown(state);
  return { ...state, penaltyScore: breakdown.collisionPenalties + breakdown.missedGatePenalties, relayScore: state.missionScore, scoreBreakdown: breakdown, score: breakdown.total };
}

function validateInput(input: BlitzInput): BlitzInput {
  if (!Number.isFinite(input.steer) || input.steer < -1 || input.steer > 1 || typeof input.drift !== 'boolean' || typeof input.boost !== 'boolean' || (input.brake !== undefined && typeof input.brake !== 'boolean') || (input.relayChoice !== undefined && input.relayChoice !== 'left' && input.relayChoice !== 'right')) throw new Error('Beacon Blitz input is invalid.');
  return input;
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
