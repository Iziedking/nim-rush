import type { BlitzSurface } from './types';

export interface BlitzSurfaceProfile {
  readonly id: BlitzSurface;
  readonly grip: number;
  readonly resistance: number;
  readonly braking: number;
  readonly skidThreshold: number;
}

export const BLITZ_SURFACE_PROFILES: Readonly<Record<BlitzSurface, BlitzSurfaceProfile>> = {
  pavement: { id: 'pavement', grip: 1, resistance: 1, braking: 1, skidThreshold: 5.4 },
  dirt: { id: 'dirt', grip: 0.82, resistance: 0.9, braking: 0.86, skidThreshold: 4.5 },
  gravel: { id: 'gravel', grip: 0.58, resistance: 0.76, braking: 0.72, skidThreshold: 3.4 },
  wood: { id: 'wood', grip: 0.7, resistance: 0.96, braking: 0.78, skidThreshold: 4.1 },
};

export function blitzSurface(id: BlitzSurface): BlitzSurfaceProfile {
  return BLITZ_SURFACE_PROFILES[id];
}
