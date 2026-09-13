import { AnimationMixer, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import type { AnimationAction, AnimationClip, Object3D } from 'three';
import { ATLAS_WORLD_PALETTE } from '../../palette';
import { NO_OUTLINE_FLAG } from './outline';
import type { AtlasQualityTier } from '../../../../shared/atlas/city/types';
import type { AtlasCitizenActivity } from '../../../../shared/atlas/city/crowd';
import type { AtlasGaitState } from '../../../../shared/atlas/city/character-gait';
import { createAtlasGaitRig, type AtlasLocomotionSample } from './character-gait-rig';
import { findAtlasBone } from './character-bones';

export type AtlasCharacterAnimationState = 'idle' | 'walk' | 'run' | 'talk';
export type AtlasFacialCue = 'neutral' | 'focused' | 'talking' | 'pleased';

export interface AtlasCharacterAnimatorOptions {
  readonly facialPhase?: number;
}

export interface AtlasCharacterAnimator {
  readonly mixer: AnimationMixer;
  state(): AtlasCharacterAnimationState;
  update(state: AtlasCharacterAnimationState, deltaSeconds: number, speedScale?: number, facialCue?: AtlasFacialCue, locomotion?: AtlasLocomotionSample): void;
  gaitState(): AtlasGaitState | null;
  restoreGait(state: AtlasGaitState | null): void;
  stop(): void;
}

const CLIP_NAMES: Readonly<Record<AtlasCharacterAnimationState, string>> = {
  idle: 'Atlas_Idle',
  walk: 'Atlas_Walk',
  run: 'Atlas_Run',
  talk: 'Atlas_Talk',
};

const LOCOMOTION_CROSS_FADE_SECONDS = 0.22;
const IDLE_CROSS_FADE_SECONDS = 0.28;
const SOCIAL_CROSS_FADE_SECONDS = 0.24;

export function createAtlasCharacterAnimator(
  root: Object3D,
  clips: readonly AnimationClip[],
  options: AtlasCharacterAnimatorOptions = {},
): AtlasCharacterAnimator {
  const mixer = new AnimationMixer(root);
  const actions = Object.fromEntries(
    (Object.entries(CLIP_NAMES) as Array<[AtlasCharacterAnimationState, string]>).map(([state, name]) => {
      const clip = clips.find((candidate) => candidate.name === name);
      if (!clip) throw new Error(`Atlas character animation ${name} is missing.`);
      return [state, mixer.clipAction(clip)];
    }),
  ) as Record<AtlasCharacterAnimationState, AnimationAction>;
  const face = createFacialRig(root, options.facialPhase ?? 0);
  const gait = createAtlasGaitRig(root);

  let current: AtlasCharacterAnimationState = 'idle';
  actions.idle.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();

  return {
    mixer,
    state: () => current,
    gaitState: () => gait?.snapshot() ?? null,
    restoreGait: (state) => { if (state) gait?.restore(state); },
    update(nextState, deltaSeconds, speedScale = 1, facialCue = 'neutral', locomotion) {
      const safeDelta = Number.isFinite(deltaSeconds) ? Math.min(0.25, Math.max(0, deltaSeconds)) : 0;
      const safeSpeed = Number.isFinite(speedScale) ? Math.min(1.75, Math.max(0.5, speedScale)) : 1;
      const next = actions[nextState];
      next.setEffectiveTimeScale(safeSpeed);
      if (nextState !== current) {
        const previous = actions[current];
        const previousClip = previous.getClip();
        const nextClip = next.getClip();
        const previousPhase = previousClip.duration > 0 ? positiveModulo(previous.time, previousClip.duration) / previousClip.duration : 0;
        next.reset().setEffectiveTimeScale(safeSpeed).setEffectiveWeight(1).play();
        if (current !== 'idle' && nextState !== 'idle' && nextClip.duration > 0) next.time = previousPhase * nextClip.duration;
        const fadeSeconds = transitionDuration(current, nextState);
        previous.crossFadeTo(next, fadeSeconds, false);
        current = nextState;
      }
      mixer.update(safeDelta);
      if (locomotion) gait?.update(safeDelta, locomotion, nextState === 'run');
      face?.update(safeDelta, facialCue);
    },
    stop() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    },
  };
}

export function atlasCitizenAnimationState(
  active: boolean,
  requestedPace: 'walk' | 'run',
  activity?: AtlasCitizenActivity,
): AtlasCharacterAnimationState {
  if (!active) return activity === 'talking' || activity === 'trading' ? 'talk' : 'idle';
  return requestedPace;
}

export function atlasCitizenFacialCue(activity: AtlasCitizenActivity): AtlasFacialCue {
  if (activity === 'talking' || activity === 'trading') return 'talking';
  if (activity === 'celebrating') return 'pleased';
  if (activity === 'repairing' || activity === 'planning' || activity === 'carrying' || activity === 'jogging') return 'focused';
  return 'neutral';
}

export function atlasCharacterHeadingBlend(current: number, target: number, deltaSeconds: number, moving: boolean): { heading: number; turnRate: number } {
  const safeDelta = Number.isFinite(deltaSeconds) ? Math.min(0.25, Math.max(0, deltaSeconds)) : 0;
  const response = moving ? 14 : 8;
  const amount = 1 - Math.exp(-response * safeDelta);
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  const heading = current + difference * amount;
  const appliedTurn = Math.atan2(Math.sin(heading - current), Math.cos(heading - current));
  return { heading, turnRate: safeDelta > 0 ? appliedTurn / safeDelta : 0 };
}

/*
 * Which body a citizen is drawn with, as a band rather than a line.
 *
 * This used to be a bare `distance <= 12`. Each citizen owns two rigs and only
 * the visible one is animated, so the hidden one is frozen wherever it was last
 * seen. With a hard threshold, a citizen hovering at 12 m — and the player is
 * almost always moving, so several always are — flipped between the two every
 * frame, showing a character in one stride pose and then another. A playtester
 * reported it as "this double feel while humans walk".
 *
 * The exit distance is further out than the entry distance, so crossing once
 * does not cross back on the next frame. Pair this with carrying the animation
 * phase across a switch, which the renderer does: hysteresis makes switches
 * rare, the phase carry makes the rare ones invisible.
 */
const DETAIL_HYSTERESIS_METRES = 2.5;

export function atlasCitizenDetailLevel(
  quality: AtlasQualityTier,
  active: boolean,
  distanceFromPlayer: number,
  previous?: 'near' | 'distant',
): 'near' | 'distant' {
  if (quality === 'low') return distanceFromPlayer <= (previous === 'near' ? 8.5 : 6) ? 'near' : 'distant';
  if (active) return 'near';
  const nearDistance = quality === 'high' ? 20 : 12;
  const threshold = previous === 'near' ? nearDistance + DETAIL_HYSTERESIS_METRES : nearDistance;
  return distanceFromPlayer <= threshold ? 'near' : 'distant';
}

interface AtlasFacialRig {
  update(deltaSeconds: number, cue: AtlasFacialCue): void;
}

/*
 * Eye and mouth geometry, attached to the bones that already exist for it.
 *
 * The characters shipped with no face. Both builders place eye.L, eye.R,
 * eyelid.L, eyelid.R and mouth as *bones only* - joints in the skin with no
 * mesh - and build_character.py says why: "The renderer drives the mouth and
 * eyes itself through createFacialRig". The renderer, meanwhile, assumed the
 * art supplied the geometry and only animated the joints. Each side expected
 * the other, so every character in the game has a blank face while a complete
 * blink-glance-and-speak rig drives nothing anybody can see.
 *
 * Building it here rather than in Blender keeps the fix off the asset
 * pipeline: no regeneration, no manifest hashes to chase. The meshes are
 * children of the bones, so the existing update() already animates them - a
 * blink is the eye bone's scale.y, and the mouth opens on its own scale.
 *
 * Unlit on purpose. At the tuned camera a head is about 25 px, and a shaded
 * dark dot at that size turns to mud; cartoon faces read because they are flat.
 */
const FACE_EYE_RADIUS = 0.019;
/* Wider than it is tall, and wider than an eye: at 25 px a mouth only reads as
 * a mouth if it is clearly the widest mark on the face. The first pass used a
 * near-round 0.024 and disappeared into the jaw shadow. */
const FACE_MOUTH_RADIUS = 0.030;

function attachFacePart(bone: Object3D, radius: number, squashY: number, squashZ: number, stretchX = 1): void {
  // Idempotent: a re-bound animator must not stack a second pair of eyes.
  if (bone.children.some((child) => child.userData.atlasFacePart === true)) return;
  const mesh = new Mesh(
    new SphereGeometry(radius, 8, 6),
    new MeshBasicMaterial({ color: ATLAS_WORLD_PALETTE.ink }),
  );
  mesh.scale.set(stretchX, squashY, squashZ);
  mesh.userData.atlasFacePart = true;
  // An inverted hull around a 2 cm sphere is a black blob the size of the head.
  mesh.userData[NO_OUTLINE_FLAG] = true;
  mesh.renderOrder = 1;
  bone.add(mesh);
}

function createFacialRig(root: Object3D, requestedPhase: number): AtlasFacialRig | null {
  const leftEye = findAtlasBone(root, 'eye.L');
  const rightEye = findAtlasBone(root, 'eye.R');
  const leftEyelid = findAtlasBone(root, 'eyelid.L');
  const rightEyelid = findAtlasBone(root, 'eyelid.R');
  const mouth = root.getObjectByName('mouth');
  if (!leftEye && !rightEye && !mouth) return null;

  for (const eye of [leftEye, rightEye]) if (eye) attachFacePart(eye, FACE_EYE_RADIUS, 1, 0.6);
  if (mouth) attachFacePart(mouth, FACE_MOUTH_RADIUS, 0.34, 0.42, 1.35);

  const phase = positiveModulo(Number.isFinite(requestedPhase) ? requestedPhase : 0, 1);
  const eyeBase = [leftEye, rightEye].map((eye) => eye ? { eye, scaleY: eye.scale.y, rotationY: eye.rotation.y } : null);
  const eyelidBase = [leftEyelid, rightEyelid].map((eyelid) => eyelid ? { eyelid, y: eyelid.position.y } : null);
  const mouthBase = mouth ? { scaleX: mouth.scale.x, scaleY: mouth.scale.y, rotationZ: mouth.rotation.z } : null;
  let elapsedSeconds = phase * 2.7;

  return {
    update(deltaSeconds, cue) {
      elapsedSeconds += deltaSeconds;
      const blink = blinkClosure(elapsedSeconds, phase);
      const focus = cue === 'focused' ? 0.9 : 1;
      const glance = Math.sin(elapsedSeconds * 0.73 + phase * Math.PI * 2) * 0.075;
      for (const state of eyeBase) {
        if (!state) continue;
        state.eye.scale.y = state.scaleY * Math.max(0.08, (1 - blink * 0.92) * focus);
        state.eye.rotation.y = state.rotationY + glance;
      }
      for (const state of eyelidBase) {
        if (state) state.eyelid.position.y = state.y - blink * 0.014;
      }
      if (!mouth || !mouthBase) return;
      const speech = 0.5 + Math.sin(elapsedSeconds * 10.2 + phase * 5.3) * 0.5;
      const opening = cue === 'talking' ? 0.36 + speech * 0.58 : cue === 'pleased' ? 0.26 : 0.16;
      mouth.scale.x = mouthBase.scaleX * (cue === 'pleased' ? 1.18 : cue === 'talking' ? 0.96 + speech * 0.08 : 1);
      mouth.scale.y = mouthBase.scaleY * opening;
      mouth.rotation.z = mouthBase.rotationZ + (cue === 'pleased' ? -0.045 : Math.sin(elapsedSeconds * 1.2 + phase) * 0.012);
    },
  };
}

function blinkClosure(elapsedSeconds: number, phase: number): number {
  const period = 3.35 + phase * 1.25;
  const blinkDuration = 0.2;
  const cycle = positiveModulo(elapsedSeconds, period);
  const blinkStart = period - blinkDuration;
  if (cycle < blinkStart) return 0;
  return Math.sin(((cycle - blinkStart) / blinkDuration) * Math.PI);
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function transitionDuration(current: AtlasCharacterAnimationState, next: AtlasCharacterAnimationState): number {
  if (current === 'talk' || next === 'talk') return SOCIAL_CROSS_FADE_SECONDS;
  if (current === 'idle' || next === 'idle') return IDLE_CROSS_FADE_SECONDS;
  return LOCOMOTION_CROSS_FADE_SECONDS;
}
