export type BlitzCityId = 'lagos' | 'london' | 'dubai';
export type BlitzChoice = 'left' | 'right';
export type BlitzDifficulty = 'rookie' | 'pro';
export type BlitzRunPhase = 'countdown' | 'running' | 'finished' | 'timeout';
export type BlitzSurface = 'pavement' | 'dirt' | 'gravel' | 'wood' | 'grass';
export type BlitzMissionKind = 'line' | 'control' | 'risk';
export type BlitzMissionStatus = 'pending' | 'active' | 'complete' | 'failed';

export type BlitzPhysicsEvent =
  | { readonly type: 'launch'; readonly tick: number; readonly intensity: number; readonly surface: BlitzSurface }
  | { readonly type: 'landing'; readonly tick: number; readonly intensity: number; readonly surface: BlitzSurface }
  | { readonly type: 'impact'; readonly tick: number; readonly intensity: number; readonly surface: BlitzSurface }
  | { readonly type: 'skid'; readonly tick: number; readonly intensity: number; readonly surface: BlitzSurface }
  | { readonly type: 'surface-change'; readonly tick: number; readonly intensity: number; readonly surface: BlitzSurface }
  | { readonly type: 'boost-start'; readonly tick: number; readonly intensity: number; readonly surface: BlitzSurface }
  | { readonly type: 'boost-end'; readonly tick: number; readonly intensity: number; readonly surface: BlitzSurface }
  | { readonly type: 'pickup'; readonly tick: number; readonly intensity: number; readonly surface: BlitzSurface; readonly pickup: 'nitro' | 'gearbox' };

export interface BlitzInput {
  readonly steer: number;
  readonly drift: boolean;
  readonly boost: boolean;
  /**
   * Down on the bars, out of the wind.
   *
   * The bike used to hold its own speed whatever the rider did, which made the
   * whole run automatic: steering was the only thing that mattered and a rider
   * who touched nothing else arrived at the same time as one who worked. Tuck
   * makes speed and costs steering; sitting up does the opposite. A rider who
   * never tucks coasts, and coasting is slow enough to lose.
   */
  readonly tuck?: boolean;
  readonly brake?: boolean;
  readonly relayChoice?: BlitzChoice;
}

/**
 * Where a contract's window sits on the course.
 *
 * Windows used to be fixed fractions per kind, chosen without reference to what
 * is actually built into the road. That is how AIR JUDGE ended up asking for a
 * jump between 0.46 and 0.62 of a course whose only jumps are at 0.18 and 0.75
 * - a contract that could not be completed on any city, ever, and still took
 * 220 points off every run for failing. Anchoring to real features means a
 * window cannot be authored somewhere the thing it asks for does not exist.
 */
export type BlitzMissionAnchor =
  | { readonly kind: 'gates' }
  | { readonly kind: 'jump' }
  | { readonly kind: 'fraction'; readonly start: number; readonly end: number };

export interface BlitzMissionDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: BlitzMissionKind;
  readonly verb: string;
  readonly description: string;
  readonly target: number;
  readonly bonus: number;
  /** Where on the course this contract opens. Defaults to the gate span. */
  readonly anchor?: BlitzMissionAnchor;
  /** Legacy relay fields are optional so old saved traces fail closed. */
  readonly prompt?: string;
  readonly left?: string;
  readonly right?: string;
  readonly correctChoice?: BlitzChoice;
  readonly explanation?: string;
}

export interface BlitzMissionState extends BlitzMissionDefinition {
  readonly gateDistance: number;
  readonly windowEndDistance: number;
  readonly progress: number;
  readonly status: BlitzMissionStatus;
  readonly startedAtTick: number | null;
  readonly contactsAtStart: number | null;
  /** Supplies banked when the window opened, so a contract counts its own. */
  readonly suppliesAtStart?: number | null;
  /** Unbroken ticks of tuck, for the contract that asks for a held posture. */
  readonly tuckTicks?: number;
  readonly failureReason: string | null;
  readonly resolved?: boolean;
  readonly selectedChoice?: BlitzChoice | null;
  readonly correct?: boolean | null;
}

export interface BlitzActiveRelay {
  readonly missionIndex: number;
  readonly expiresAtTick: number;
}

export interface BlitzActiveMission {
  readonly missionIndex: number;
  readonly expiresAtTick: number;
}

export interface BlitzScoreBreakdown {
  readonly finishTime: number;
  readonly racingLine: number;
  readonly control: number;
  readonly airtime: number;
  readonly missions: number;
  readonly drift: number;
  readonly collisionPenalties: number;
  readonly missedGatePenalties: number;
  readonly total: number;
}

export interface BlitzRunState {
  readonly version: 1;
  readonly rulesetVersion: string;
  readonly difficulty: BlitzDifficulty;
  readonly cityId: BlitzCityId;
  readonly seed: string;
  readonly phase: BlitzRunPhase;
  readonly tick: number;
  readonly countdownTicks: number;
  readonly elapsedTicks: number;
  readonly elapsedMs: number;
  readonly distanceMeters: number;
  readonly speedMps: number;
  readonly laneOffset: number;
  readonly lateralVelocityMps: number;
  readonly heightMeters: number;
  readonly verticalVelocityMps: number;
  readonly airborne: boolean;
  readonly surface: BlitzSurface;
  readonly lastEvent: BlitzPhysicsEvent | null;
  readonly boostEnergy: number;
  readonly boostActive: boolean;
  readonly driftActive: boolean;
  /*
   * Supplies.
   *
   * Boost and drift are carried now, not granted. The capacities come from the
   * rider's loadout at the moment the run was created and never change during
   * it, so a run is a closed system: what a rider finishes with is what they
   * picked up off the road.
   */
  readonly boostCapacity: number;
  readonly driftCharges: number;
  readonly driftCapacity: number;
  /** How long one gearbox holds a slide open. Fixed for the run. */
  readonly driftWindowTicks: number;
  /** Ticks left in the slide this gearbox bought. Zero when not sliding. */
  readonly driftTicksLeft: number;
  /**
   * The drift button has been held since the last slide ran out.
   *
   * Without this, holding the button would spend every gearbox back to back
   * the instant each window closed. A slide has to be asked for.
   */
  readonly driftLatched: boolean;
  readonly pickupReach: number;
  readonly collectedPickupIds: readonly string[];
  /*
   * The pack, and what happened in it.
   *
   * Held on the run because a solid rival changes the physics: the same run
   * ridden against a different pack is a different run, so the set has to
   * travel with the state that verification rebuilds.
   */
  readonly rivalContacts: number;
  readonly overtakes: number;
  /** Rivals you put out, and the ones no longer on the hill because of it. */
  readonly takedowns: number;
  readonly downedRivals: readonly string[];
  readonly nitroTaken: number;
  readonly gearboxTaken: number;
  readonly distanceScore: number;
  readonly lineScore: number;
  readonly controlScore: number;
  readonly airtimeScore: number;
  readonly missionScore: number;
  readonly driftScore: number;
  readonly relayScore: number;
  readonly timeBonus: number;
  readonly collisionPenalty: number;
  readonly missedGatePenalty: number;
  readonly offRoadPenalty: number;
  readonly penaltyScore: number;
  readonly score: number;
  readonly scoreBreakdown: BlitzScoreBreakdown;
  readonly collisions: number;
  readonly nearMisses: number;
  readonly missions: readonly BlitzMissionState[];
  readonly activeMission: BlitzActiveMission | null;
  readonly activeRelay: BlitzActiveRelay | null;
  readonly processedObstacleIds: readonly string[];
  readonly processedFeatureIds: readonly string[];
  readonly lastImpactTick: number;
}

export interface BlitzTraceFrame {
  readonly tick: number;
  readonly input: BlitzInput;
}

export interface BlitzRoutePose {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly headingRadians: number;
  readonly bend: number;
  readonly slope: number;
  readonly surface: BlitzSurface;
}
