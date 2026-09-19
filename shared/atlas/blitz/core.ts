import { BLITZ_LINE_GATES, blitzCity, blitzLiveObstacles } from './cities';
import { blitzRunCollectables } from './trail';
import { blitzRuleFeatures } from './ruleset';
import { BLITZ_SECTORS, blitzSectorIndex } from './sectors';
import { BLITZ_BASE_LOADOUT, type BlitzLoadout } from './rider';
import { blitzRivalAt, blitzRivalContact, type BlitzRivalPath } from './rivals';
import { blitzMissionWindow, selectBlitzMissions } from './missions';
import { blitzRules, type BlitzDifficultyRules } from './rules';
import { blitzSurface } from './surfaces';
import { courseGroundLift, courseTerrainHeight, nearbyCourseColliders, sampleCourse } from './course';
import type { BlitzCityId, BlitzDifficulty, BlitzInput, BlitzMissionState, BlitzPhysicsEvent, BlitzRoutePose, BlitzRunState, BlitzScoreBreakdown, BlitzSurface } from './types';

export const BLITZ_TICK_RATE = 30;
/*
 * What separates a shoulder from a scrape.
 *
 * Both thresholds have to be met at the moment of contact: the bars turned
 * into them, and enough speed behind it to matter. Anything less is a rider
 * who drifted into somebody, and that is a mistake rather than a move.
 */
const TAKEDOWN_STEER = 0.55;
const TAKEDOWN_SPEED_MPS = 14;
export const TAKEDOWN_POINTS = 1_500;
/** Six seconds, which is what HOLD THE TUCK asks for. */
const TUCK_HOLD_TICKS = BLITZ_TICK_RATE * 6;
/*
 * What a full gradient is worth in speed.
 *
 * Tuned so an average Lagos pitch (about 6%) is worth roughly 3.5 m/s and the
 * steep drops are worth appreciably more - enough that a rider notices the
 * ground tilting under them, and short of enough to carry a run on its own.
 */
const GRADE_SPEED_MPS = 60;
/*
 * How hard a corner throws a bike that is going too fast for it.
 *
 * Tuned so a rider who holds a tuck through the tight sections runs wide and a
 * rider who brakes or steers into them does not - which is the whole trade the
 * course is there to offer.
 */
const CORNER_PUSH = 26;
export const BLITZ_LIMIT_SECONDS = 120;
const COUNTDOWN_TICKS = BLITZ_TICK_RATE * 3;
// The gates a rider can see. One list, shared with the renderer, because a
// rider threading the gate in front of them must be the rider being scored.
const LINE_GATE_FRACTIONS = BLITZ_LINE_GATES;
/*
 * Riding position.
 *
 * The three numbers that turn a run from automatic into ridden. Neutral is
 * deliberately below the speed the course was built around: a rider who never
 * tucks will be close to the time limit, which is the point - the bike no
 * longer rides itself.
 */
const POSTURE_SPEED = { tucked: 1.16, neutral: 0.86 } as const;
/*
 * And what it is under the V13 rules, where a descent has to be ridden.
 *
 * Measured on the shipped game: a rider who never touched a control reached
 * the bottom of Lagos in 97 seconds, and a rider who steered the whole way but
 * never tucked scored within 5% of one who rode properly. Posture was in the
 * game but it was not worth anything, so the hill did the work.
 *
 * Sitting up now coasts at a speed that runs out of clock, and the tuck is
 * what turns the hill into speed. The numbers are tuned, not guessed: see the
 * targets in tests/atlas-rush-skill.test.ts.
 */
const POSTURE_SPEED_RIDDEN = { tucked: 1.32, neutral: 0.5 } as const;
/*
 * How much of the gradient a rider who is sitting up gets to keep.
 *
 * A bike does roll downhill on its own - that is what a downhill is - so
 * gravity is never switched off. But the rider who is folded onto the bars is
 * the one who converts the hill into speed, which is why a real descent is
 * ridden tucked and sat up only to turn.
 */
const GRADE_UPRIGHT_SHARE = 0.35;
/*
 * And the cost. Tucked, the bike goes where it was already going; sat up with
 * the brakes on, it turns. Braking into a corner and tucking out of it is
 * faster than holding one position through both, which is the whole skill.
 */
const POSTURE_GRIP = { tucked: 0.62, neutral: 1, braking: 1.3 } as const;

const BOOST_DRAIN = 0.55;
/*
 * There is no idle regen any more.
 *
 * A tank that refilled on its own made boost a button rather than a decision:
 * a rider who did nothing had the same fuel as a rider who took the harder
 * line for a bottle. Nitro now comes off the road, or out of a slide, and from
 * nowhere else.
 */
const BOOST_DRIFT_REGEN = 0.45;
/** Exported so the HUD can hide the boost key on a tank too low to use it. */
export const BOOST_ENGAGE_ENERGY = 9;
/** What one bottle is worth: about a second of boost. */
export const BLITZ_NITRO_BOTTLE = 18;
/*
 * What one NIM token off the trail is worth.
 *
 * About seventy of them down a course, so a rider who takes the line cleanly
 * earns roughly four thousand - a real share of a run without being able to
 * carry one on its own.
 */
export const BLITZ_TOKEN_POINTS = 60;
/*
 * Under the V6 rules a coin is worth less on its own and more in a run of
 * them. A clean trail - about seventy coins, most of them at x2 - comes to
 * roughly five thousand; picking coins up here and there, about fifteen
 * hundred. The trail stops paying for being near it and starts paying for
 * holding it.
 */
export const BLITZ_COMBO_TOKEN_POINTS = 40;
/** Coins in a row for each step up: x1.5 at ten, x2 at twenty. */
export const BLITZ_COMBO_STEPS: readonly { readonly streak: number; readonly multiplier: number }[] = [
  { streak: 20, multiplier: 2 },
  { streak: 10, multiplier: 1.5 },
];

/** What a coin pays at a given streak, counting that coin. */
export function blitzComboMultiplier(streak: number): number {
  return BLITZ_COMBO_STEPS.find((step) => streak >= step.streak)?.multiplier ?? 1;
}

/**
 * Start a run.
 *
 * `loadout` defaults to the base one on purpose. `replayBlitzTrace` calls this
 * with the city and the seed alone, so every ranked run is verified against the
 * base loadout whatever the client believed it was riding with - a client that
 * handed itself a bigger tank produces a trace the server disagrees with, and
 * the run is refused rather than ranked.
 */
export function createBlitzRun(input: { cityId: BlitzCityId; seed: string; difficulty?: BlitzDifficulty; loadout?: BlitzLoadout; rivals?: readonly BlitzRivalPath[] }): BlitzRunState {
  const difficulty = input.difficulty ?? 'rookie';
  const loadout = input.loadout ?? BLITZ_BASE_LOADOUT;
  const rules = blitzRules(difficulty);
  const city = blitzCity(input.cityId);
  const missions: BlitzMissionState[] = selectBlitzMissions(input.seed, difficulty).map((mission) => {
    const window = blitzMissionWindow(city, mission);
    return {
      ...mission,
      gateDistance: city.lengthMeters * window.start,
      windowEndDistance: city.lengthMeters * window.end,
      progress: 0,
      status: 'pending',
      startedAtTick: null,
      contactsAtStart: null,
      suppliesAtStart: null,
      tuckTicks: 0,
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
    boostEnergy: Math.min(loadout.startingBoost, loadout.boostCapacity),
    boostActive: false,
    driftActive: false,
    boostCapacity: loadout.boostCapacity,
    driftCharges: Math.min(loadout.startingDrift, loadout.driftCapacity),
    driftCapacity: loadout.driftCapacity,
    driftWindowTicks: loadout.driftWindowTicks,
    driftTicksLeft: 0,
    driftLatched: false,
    pickupReach: loadout.pickupReach,
    collectedPickupIds: [],
    nitroTaken: 0,
    gearboxTaken: 0,
    tokensTaken: 0,
    nimScore: 0,
    trailStreak: 0,
    trailBest: 0,
    sector: 0,
    rivalContacts: 0,
    overtakes: 0,
    takedowns: 0,
    downedRivals: [],
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

export function stepBlitzRun(state: BlitzRunState, rawInput: BlitzInput, rivals: readonly BlitzRivalPath[] = []): BlitzRunState {
  const input = validateInput(rawInput);
  if (state.phase === 'finished' || state.phase === 'timeout') return state;
  if (state.phase === 'countdown') {
    const countdownTicks = Math.max(0, state.countdownTicks - 1);
    return { ...state, tick: state.tick + 1, countdownTicks, phase: countdownTicks === 0 ? 'running' : 'countdown' };
  }

  const city = blitzCity(state.cityId);
  const rules = blitzRules(state.difficulty);
  const features = blitzRuleFeatures(state.seed);
  const postureSpeed = features.skillSpeed ? POSTURE_SPEED_RIDDEN : POSTURE_SPEED;
  const sector = features.sectors ? blitzSectorIndex(state.distanceMeters / city.lengthMeters) : 0;
  const pace = BLITZ_SECTORS[sector]!.pace;
  const elapsedTicks = state.elapsedTicks + 1;
  const elapsedMs = Math.round(elapsedTicks * 1_000 / BLITZ_TICK_RATE);
  /*
   * A slide costs a gearbox.
   *
   * Drift used to be free and unlimited, which made it the obvious input at
   * every corner and therefore not a choice. One gearbox buys one window; the
   * button has to be released before another can be spent, or holding it would
   * empty the frame in a second and a half.
   */
  /*
   * A slide still needs a direction - that is what makes it a cornering move
   * rather than a speed button - but 0.2 of steering was far more than a thumb
   * gives you, and a press below it did nothing at all: no slide, no charge
   * spent, no sound, and the button lit up anyway because the highlight is
   * client-side. On a phone that reads as a broken control, and it is the first
   * thing a rider tries.
   */
  const wantsDrift = input.drift && Math.abs(input.steer) >= 0.05 && state.speedMps >= 8;
  let driftCharges = state.driftCharges;
  let driftTicksLeft = 0;
  let driftLatched = state.driftLatched;
  let driftActive = false;
  if (!input.drift) {
    driftLatched = false;
  } else if (!wantsDrift) {
    // Asking for a slide too slowly, or without steering into it. The window
    // is held rather than thrown away: this is a rider mid-corner, not a
    // rider who let go.
    driftTicksLeft = state.driftTicksLeft;
    driftLatched = state.driftLatched;
  } else if (state.driftTicksLeft > 0) {
    driftTicksLeft = state.driftTicksLeft - 1;
    driftActive = true;
    if (driftTicksLeft === 0) driftLatched = true;
  } else if (!driftLatched && driftCharges > 0) {
    driftCharges -= 1;
    driftTicksLeft = Math.max(0, state.driftWindowTicks - 1);
    driftActive = true;
  } else {
    driftLatched = true;
  }
  const brakeActive = input.brake === true;
  // Braking wins: a rider cannot be hard on the brakes and tucked at once.
  const tuckActive = input.tuck === true && !brakeActive;
  const routeSurface = surfaceAt(city, state.distanceMeters);
  const surface = Math.abs(state.laneOffset) > city.roadWidth * 0.5 ? 'grass' : routeSurface;
  const surfaceProfile = blitzSurface(surface);
  const boostActive = surface !== 'grass' && input.boost
    && (state.boostActive ? state.boostEnergy > 0.25 : state.boostEnergy >= BOOST_ENGAGE_ENERGY);
  const postureGrip = tuckActive ? POSTURE_GRIP.tucked : brakeActive ? POSTURE_GRIP.braking : POSTURE_GRIP.neutral;
  // Against the city's own cruising speed, so a corner asks the same question
  // of every course rather than punishing the fast ones.
  const speedRatio = state.speedMps / city.baseSpeedMps;
  // One sample of the road under the bike, read by both the corner and the grade.
  const roadHere = sampleCourse(city.id, state.distanceMeters);
  /*
   * Speed carried into a bend has to go somewhere.
   *
   * laneOffset is measured from the centre of the road, so a rider who touched
   * nothing followed every corner perfectly and for free - the course could be
   * as twisty as it liked and never ask them for anything. That is most of why
   * the ride felt programmed: the only thing a corner could do was look like a
   * corner.
   *
   * A bend now pushes the bike toward the outside, harder the faster it is
   * going, and the rider has to hold against it or lose the line. It scales
   * with the square of speed because that is how cornering actually works, and
   * it is the reason braking before a corner is worth the speed it costs.
   */
  const corner = roadHere.bend * (speedRatio * speedRatio) * CORNER_PUSH;
  const lateralAcceleration = input.steer * (driftActive ? 13 : 8) * surfaceProfile.grip * postureGrip
    - corner / Math.max(0.35, surfaceProfile.grip * postureGrip);
  let lateralVelocityMps = clamp(state.lateralVelocityMps + lateralAcceleration / BLITZ_TICK_RATE, -12, 12);
  lateralVelocityMps *= driftActive ? 0.988 : Math.pow(surfaceProfile.grip, 0.35) * 0.94;
  let laneOffset = clamp(state.laneOffset + lateralVelocityMps / BLITZ_TICK_RATE, -city.roadWidth * 0.72, city.roadWidth * 0.72);
  const offRoad = Math.abs(laneOffset) > city.roadWidth * 0.5;
  const shoulderDepth = Math.max(0, Math.abs(laneOffset) - city.roadWidth * 0.5);
  const grassProfile = blitzSurface('grass');
  /*
   * The hill, finally doing something.
   *
   * Gravity was applied in exactly one place - the off-road branch below - so
   * on the road a 110 metre descent was scenery. The bike held one target speed
   * from the gate to the finish whatever the ground did, which is why the ride
   * read as programmed: there was nothing underneath it to manage. Two of the
   * three cities were flat anyway, by 0.1 and 0.2 metres end to end.
   *
   * Slope is negative going down. A steep pitch now pulls the bike along and a
   * shallow one gives it back, so a rider spends the steep sections deciding
   * whether they can still hold the line at that speed - which is the decision
   * a downhill is made of.
   */
  const gradeSpeed = clamp(-roadHere.slope, -0.24, 0.24) * GRADE_SPEED_MPS
    * (features.skillSpeed && !tuckActive ? GRADE_UPRIGHT_SHARE : 1);
  const targetSpeed = brakeActive ? 0 : offRoad
    ? city.baseSpeedMps * grassProfile.resistance / (1 + shoulderDepth * 0.18)
    : Math.max(4, city.baseSpeedMps * pace * surfaceProfile.resistance * (tuckActive ? postureSpeed.tucked : postureSpeed.neutral)
      + gradeSpeed + (boostActive ? 8.5 : 0) - (driftActive ? 1.1 : 0));
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
  // Sliding still feeds the tank, which is what makes a gearbox worth
  // spending: a slide is how a rider turns control into fuel.
  let boostEnergy = clamp(state.boostEnergy + (driftActive ? BOOST_DRIFT_REGEN : 0) - (boostActive ? BOOST_DRAIN : 0), 0, state.boostCapacity);
  let distanceMeters = Math.min(city.lengthMeters, state.distanceMeters + speedMps / BLITZ_TICK_RATE);
  let distanceScore = Math.floor(distanceMeters * 1);
  let lineScore = state.lineScore;
  let controlScore = state.controlScore;
  let airtimeScore = state.airtimeScore;
  let missionScore = state.missionScore;
  let driftScore = state.driftScore + (driftActive ? Math.max(1, Math.round(Math.abs(input.steer) * speedMps * 0.55)) : 0);
  let collisionPenalty = state.collisionPenalty;
  let missedGatePenalty = state.missedGatePenalty;
  let offRoadPenalty = state.offRoadPenalty;
  let collisions = state.collisions;
  let nearMisses = state.nearMisses;
  let lastImpactTick = state.lastImpactTick;
  const processedObstacleIds = [...state.processedObstacleIds];
  const processedFeatureIds = [...state.processedFeatureIds];
  const collectedPickupIds = [...state.collectedPickupIds];
  let nitroTaken = state.nitroTaken;
  let gearboxTaken = state.gearboxTaken;
  let tokensTaken = state.tokensTaken;
  let nimScore = state.nimScore;
  let trailStreak = state.trailStreak;
  let trailBest = state.trailBest;
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

  const liveObstacles = new Map(blitzLiveObstacles(city, rules.difficulty, state.seed).map((obstacle) => [obstacle.id, obstacle] as const));
  for (const collider of nearbyCourseColliders(city.id, state.distanceMeters)) {
    const live = collider.roadside ? undefined : liveObstacles.get(collider.id);
    if (!collider.roadside && !live) continue;
    // Where today's layout put it, which may be the other side of the road.
    const obstacle = live ? { ...collider, lane: live.lane } : collider;
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
        /*
         * Contacts escalate: 300 for the first, 250 more for each after it.
         *
         * A flat 420 treated one mistake and eight the same way per hit, which
         * let a rider who bounced down the whole hill keep a finish bonus and
         * a pile of near misses - weaving through the obstacle field badly
         * scored better than holding a line through it. One contact is a
         * mistake and stays cheap at 300. Eight is not eight mistakes, it is
         * a way of riding, and it now costs 9,400.
         */
        collisionPenalty += 300 + (collisions - 1) * 250;
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
  /*
   * The pack.
   *
   * A rival is a moving obstacle that cannot react, so contact moves the rider
   * and never the rival. It costs less than a rock because it is a shoulder,
   * not a boulder - and overtaking pays, because getting past traffic cleanly
   * is the thing worth being good at.
   */
  let rivalContacts = state.rivalContacts;
  let overtakes = state.overtakes;
  let takedowns = state.takedowns;
  const downedRivals = new Set(state.downedRivals);
  for (const rival of rivals) {
    // Somebody you already put out is off the hill for the rest of your run.
    if (downedRivals.has(rival.runId)) continue;
    const before = blitzRivalAt(rival, state.tick);
    const now = blitzRivalAt(rival, state.tick + 1);
    if (!now) continue;
    if (blitzRivalContact({ distanceMeters, laneOffset }, now)) {
      /*
       * A shoulder you meant, or one you did not get out of the way of.
       *
       * Drifting into somebody at half pace is a mistake and is paid for as
       * one. Committing across the trail into their flank, at speed, with the
       * bars turned into them, is an attack - and it puts them out.
       *
       * Every term here comes off the input trace and the pinned path, so the
       * server re-simulating your run arrives at the same riders being down at
       * the same ticks. A takedown is a scored, verified event, not something
       * the browser gets to assert.
       *
       * What it does not do is change their run. Theirs was ridden before
       * yours existed and their row on the board is already true. You take
       * them out of your descent, not out of their result.
       */
      const intoThem = Math.sign(now.laneOffset - laneOffset);
      const committed = intoThem !== 0 && Math.sign(input.steer) === intoThem && Math.abs(input.steer) >= TAKEDOWN_STEER;
      const away = Math.sign(laneOffset - now.laneOffset) || (input.steer >= 0 ? 1 : -1);
      if (committed && speedMps >= TAKEDOWN_SPEED_MPS) {
        downedRivals.add(rival.runId);
        takedowns += 1;
        distanceScore += TAKEDOWN_POINTS;
        // You still lose a little: you hit somebody. Far less than being hit.
        speedMps *= 0.9;
        lateralVelocityMps = away * 1.6;
        if (!lastEvent) lastEvent = { type: 'impact', tick: state.tick + 1, intensity: 0.85, surface };
      } else {
        laneOffset = now.laneOffset + away * (0.52 * 2 + 0.01);
        lateralVelocityMps = away * 4.4;
        speedMps *= 0.62;
        rivalContacts += 1;
        if (!lastEvent) lastEvent = { type: 'impact', tick: state.tick + 1, intensity: 0.5, surface };
      }
    } else if (before && state.distanceMeters <= before.distanceMeters && distanceMeters > now.distanceMeters) {
      // Crossed them. Counted on the tick the lead changes hands, so sitting
      // alongside somebody cannot farm it.
      overtakes += 1;
      distanceScore += 600;
    }
  }

  /*
   * A near miss is a garnish, not a strategy. At 450 it paid a rider who wove
   * at random through the obstacle field about 4,950 a run - more racing line
   * than a rider holding a clean line earned - because weaving past things is
   * what produces near misses, and doing it badly produces more of them. It
   * pays enough to notice and never enough to aim for.
   */
  distanceScore += nearMisses * 150;

  /*
   * Supplies taken off the road.
   *
   * Placed after the obstacle pass on purpose: a rider knocked off their line
   * by a collision misses the bottle they were reaching for, so contact costs
   * fuel as well as points. Airborne riders still collect - taking a bottle
   * off a jump is one of the better things in the game.
   */
  // Any contact breaks the trail: a streak is a line held, and a rider who hit
  // something did not hold it.
  if (collisions > state.collisions || rivalContacts > state.rivalContacts) trailStreak = 0;
  for (const pickup of blitzRunCollectables(city, rules.difficulty, state.seed)) {
    if (collectedPickupIds.includes(pickup.id)) continue;
    const at = pickup.distance01 * city.lengthMeters;
    // The tick the bike crosses it, and only that tick.
    if (state.distanceMeters > at || distanceMeters < at) continue;
    if (Math.abs(laneOffset - pickup.lane) > state.pickupReach) {
      // Ridden past. Supplies can be left; a coin left breaks the streak.
      if (pickup.kind === 'token') trailStreak = 0;
      continue;
    }
    collectedPickupIds.push(pickup.id);
    if (pickup.kind === 'token') {
      // Points, straight into the racing-line term, because following the
      // trail is holding the line.
      tokensTaken += 1;
      trailStreak += 1;
      trailBest = Math.max(trailBest, trailStreak);
      nimScore += features.trailCombo ? Math.round(BLITZ_COMBO_TOKEN_POINTS * blitzComboMultiplier(trailStreak)) : BLITZ_TOKEN_POINTS;
    } else if (pickup.kind === 'nitro') {
      boostEnergy = Math.min(state.boostCapacity, boostEnergy + BLITZ_NITRO_BOTTLE);
      nitroTaken += 1;
    } else {
      // A gearbox over the cap is lost. The cap is the point of the cap.
      driftCharges = Math.min(state.driftCapacity, driftCharges + 1);
      gearboxTaken += 1;
    }
    lastEvent = { type: 'pickup', tick: state.tick + 1, intensity: 1, surface, pickup: pickup.kind };
  }
  for (const fraction of LINE_GATE_FRACTIONS) {
    const gateId = `line-gate-${fraction}`;
    const gateDistance = city.lengthMeters * fraction;
    if (processedFeatureIds.includes(gateId) || state.distanceMeters >= gateDistance || distanceMeters < gateDistance) continue;
    processedFeatureIds.push(gateId);
    // Narrower the further down the hill, under the V6 rules.
    const gateTolerance = rules.lineTolerance * (features.sectors ? BLITZ_SECTORS[blitzSectorIndex(fraction)]!.gateTolerance : 1);
    if (!airborne && Math.abs(laneOffset) <= city.roadWidth * gateTolerance && collisions === state.collisions) lineScore += 900;
    else missedGatePenalty += 300;
  }
  if (!airborne) heightMeters = courseGroundLift(city.id, distanceMeters, laneOffset);

  const finished = distanceMeters >= city.lengthMeters;
  const timedOut = !finished && elapsedTicks >= BLITZ_LIMIT_SECONDS * BLITZ_TICK_RATE;
  const missionResult = updateMissions({ city, rules, state, missions, distanceMeters, elapsedTicks, input, surface, airborne, collisions, finished, suppliesTaken: nitroTaken + gearboxTaken, lastEvent });
  missions = missionResult.missions;
  missionScore += missionResult.missionScore;
  controlScore += missionResult.controlScore;
  airtimeScore += missionResult.airtimeScore;
  missedGatePenalty += missionResult.missedGatePenalty;
  const timeBonus = finished ? Math.max(0, Math.floor((BLITZ_LIMIT_SECONDS * BLITZ_TICK_RATE - elapsedTicks) / BLITZ_TICK_RATE) * 150) : 0;
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
    driftCharges,
    driftTicksLeft,
    driftLatched,
    collectedPickupIds,
    nitroTaken,
    gearboxTaken,
    tokensTaken,
    nimScore,
    trailStreak,
    trailBest,
    sector: features.sectors ? blitzSectorIndex(distanceMeters / city.lengthMeters) : 0,
    rivalContacts,
    takedowns,
    downedRivals: [...downedRivals],
    overtakes,
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

type BlitzScoreSource = Pick<BlitzRunState, 'distanceScore' | 'lineScore' | 'nimScore' | 'controlScore' | 'airtimeScore' | 'missionScore' | 'driftScore' | 'timeBonus' | 'collisionPenalty' | 'missedGatePenalty' | 'offRoadPenalty'>;

export function getBlitzScoreBreakdown(state: BlitzScoreSource): BlitzScoreBreakdown {
  const total = Math.max(0, state.distanceScore + state.lineScore + state.nimScore + state.controlScore + state.airtimeScore + state.missionScore + state.driftScore + state.timeBonus - state.collisionPenalty - state.missedGatePenalty - state.offRoadPenalty);
  return {
    finishTime: state.timeBonus,
    racingLine: state.distanceScore + state.lineScore,
    nimTrail: state.nimScore,
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
  suppliesTaken: number;
  lastEvent: BlitzPhysicsEvent | null;
}): { missions: BlitzMissionState[]; activeMission: BlitzRunState['activeMission']; missionScore: number; controlScore: number; airtimeScore: number; missedGatePenalty: number } {
  let missionScore = 0;
  let controlScore = 0;
  let airtimeScore = 0;
  let missedGatePenalty = 0;
  const missions = input.missions.map((mission) => {
    let next = mission;
    if (next.status === 'pending' && input.distanceMeters >= next.gateDistance) {
      next = { ...next, status: 'active', startedAtTick: input.elapsedTicks, contactsAtStart: input.collisions, suppliesAtStart: input.suppliesTaken, tuckTicks: 0 };
    }
    if (next.status !== 'active') return next;
    const cleanLine = !input.airborne && input.surface !== 'grass'
      && Math.abs(input.state.laneOffset) <= input.city.roadWidth * input.rules.lineTolerance
      && input.collisions === (next.contactsAtStart ?? input.collisions);
    if (next.id === 'line-master') {
      /*
       * Scored on the gates that are actually built and lit on the road.
       *
       * This used to divide its own window into three even checkpoints, which
       * landed at 0.36 / 0.56 / 0.76 while the gates a rider can see stand at
       * 0.26 / 0.50 / 0.74. So the contract was won or lost several car lengths
       * away from the only thing on the course that told you where to be.
       */
      for (const fraction of LINE_GATE_FRACTIONS) {
        const gate = input.city.lengthMeters * fraction;
        if (input.state.distanceMeters >= gate || input.distanceMeters < gate) continue;
        if (cleanLine) next = { ...next, progress: next.progress + 1 };
        else next = { ...next, status: 'failed', failureReason: 'A gate was taken outside the line.' };
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
    } else if (next.id === 'supply-line') {
      // Counts only what was taken after the window opened, so a rider who
      // arrived with a full tank still has to work inside it.
      const taken = input.suppliesTaken - (next.suppliesAtStart ?? input.suppliesTaken);
      next = { ...next, progress: Math.min(next.target, Math.max(0, taken)) };
      if (input.distanceMeters > next.windowEndDistance && next.progress < next.target) {
        next = { ...next, status: 'failed', failureReason: 'The window closed before four supplies were taken.' };
      }
    } else if (next.id === 'hold-the-tuck') {
      /*
       * Unbroken: letting go or hitting something resets the count to zero,
       * which is what makes six seconds an ask rather than an accumulation.
       *
       * The break is measured against the previous tick, not against the
       * contact count when the window opened. Comparing to the window would
       * mean one early contact barred the contract for the rest of its length,
       * however cleanly the rider rode afterwards - a rule that punishes a
       * mistake twice and cannot be recovered from.
       */
      const hitThisTick = input.collisions > input.state.collisions;
      const held = input.input.tuck === true && !hitThisTick ? (next.tuckTicks ?? 0) + 1 : 0;
      next = { ...next, tuckTicks: held, progress: held >= TUCK_HOLD_TICKS ? 1 : 0 };
      if (input.distanceMeters > next.windowEndDistance && next.progress < 1) {
        next = { ...next, status: 'failed', failureReason: 'Six unbroken seconds of tuck were not held.' };
      }
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
  if (!Number.isFinite(input.steer) || input.steer < -1 || input.steer > 1 || typeof input.drift !== 'boolean' || typeof input.boost !== 'boolean' || (input.brake !== undefined && typeof input.brake !== 'boolean') || (input.tuck !== undefined && typeof input.tuck !== 'boolean') || (input.relayChoice !== undefined && input.relayChoice !== 'left' && input.relayChoice !== 'right')) throw new Error('Beacon Blitz input is invalid.');
  return input;
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
