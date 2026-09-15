export type BlitzCityId = 'lagos' | 'london' | 'dubai';
export type BlitzChoice = 'left' | 'right';
export type BlitzRunPhase = 'countdown' | 'running' | 'finished' | 'timeout';
export type BlitzSurface = 'pavement' | 'dirt' | 'gravel' | 'wood';

export type BlitzPhysicsEvent =
  | { readonly type: 'launch'; readonly tick: number; readonly intensity: number; readonly surface: BlitzSurface }
  | { readonly type: 'landing'; readonly tick: number; readonly intensity: number; readonly surface: BlitzSurface }
  | { readonly type: 'impact'; readonly tick: number; readonly intensity: number; readonly surface: BlitzSurface }
  | { readonly type: 'skid'; readonly tick: number; readonly intensity: number; readonly surface: BlitzSurface }
  | { readonly type: 'surface-change'; readonly tick: number; readonly intensity: number; readonly surface: BlitzSurface }
  | { readonly type: 'boost-start'; readonly tick: number; readonly intensity: number; readonly surface: BlitzSurface }
  | { readonly type: 'boost-end'; readonly tick: number; readonly intensity: number; readonly surface: BlitzSurface };

export interface BlitzInput {
  readonly steer: number;
  readonly drift: boolean;
  readonly boost: boolean;
  readonly brake?: boolean;
  readonly relayChoice?: BlitzChoice;
}

export interface BlitzMissionDefinition {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  readonly left: string;
  readonly right: string;
  readonly correctChoice: BlitzChoice;
  readonly explanation: string;
}

export interface BlitzMissionState extends BlitzMissionDefinition {
  readonly gateDistance: number;
  readonly resolved: boolean;
  readonly selectedChoice: BlitzChoice | null;
  readonly correct: boolean | null;
}

export interface BlitzActiveRelay {
  readonly missionIndex: number;
  readonly expiresAtTick: number;
}

export interface BlitzRunState {
  readonly version: 1;
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
  readonly distanceScore: number;
  readonly driftScore: number;
  readonly relayScore: number;
  readonly timeBonus: number;
  readonly penaltyScore: number;
  readonly score: number;
  readonly collisions: number;
  readonly nearMisses: number;
  readonly missions: readonly BlitzMissionState[];
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
