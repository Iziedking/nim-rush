import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * The shipped GLBs store sRGB where glTF wants linear.
 *
 * `art/.../build_scene.py` and `build_character.py` both write
 * `channel / 255.0` into `baseColorFactor`, a field the glTF spec defines as
 * linear. Every surface therefore renders lighter and flatter than the art
 * intends, which is most of why the city read as an untextured greybox.
 *
 * ThreeAtlasRenderer corrects this at ingest. These tests exist so that
 * correction cannot become wrong silently: the material names carry the
 * intended hex, so the mismatch is measurable, and if the assets are ever
 * regenerated correctly these fail and say to drop the ingest correction
 * rather than letting every surface be darkened twice.
 */
function materials(path: string): Array<{ name: string; factor: number[] }> {
  // A clear failure beats a raw ENOENT stack if this asset is ever moved.
  expect(existsSync(path), `${path} is missing; point this test at a tracked asset`).toBe(true);
  const bytes = readFileSync(path);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
  return (json.materials ?? [])
    .filter((material: { pbrMetallicRoughness?: { baseColorFactor?: number[] } }) => material.pbrMetallicRoughness?.baseColorFactor)
    .map((material: { name: string; pbrMetallicRoughness: { baseColorFactor: number[] } }) => ({
      name: material.name,
      factor: material.pbrMetallicRoughness.baseColorFactor,
    }));
}

/** The intended colour encoded in the material name, e.g. `Foo_14110e`. */
function intendedHex(name: string): number[] | null {
  const match = /_([0-9a-f]{6})$/.exec(name);
  if (!match) return null;
  const hex = match[1]!;
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

/*
 * The shipped runtime asset, not the build output.
 *
 * This pointed at dist/ first, which is a build artifact and gitignored, so it
 * passed locally and failed on a fresh CI checkout with ENOENT. public/ is
 * tracked, is byte-identical here, and is the file ThreeAtlasRenderer actually
 * loads - so it is the right thing to be asserting about in any case.
 */
const ENVIRONMENT = 'public/atlas/3d/v1/beacon-commons/environment.glb';

describe('the glTF colour space', () => {
  it('finds material names that carry their intended hex', () => {
    const named = materials(ENVIRONMENT).filter((material) => intendedHex(material.name));
    expect(named.length).toBeGreaterThan(4);
  });

  /*
   * This is the bug, stated as a measurement. baseColorFactor holds the sRGB
   * fraction exactly, rather than that fraction converted to linear.
   */
  it('stores the sRGB fraction in a field the spec defines as linear', () => {
    for (const material of materials(ENVIRONMENT)) {
      const intended = intendedHex(material.name);
      if (!intended) continue;
      for (const [channel, value] of intended.entries()) {
        expect(material.factor[channel]).toBeCloseTo(value, 3);
      }
    }
  });

  it('is wrong by enough to matter on the darkest surface', () => {
    // 14110e is authored as a near-black and renders as a mid grey until the
    // ingest correction runs. If this ever stops being true the assets were
    // regenerated and ThreeAtlasRenderer must stop correcting them.
    const dark = materials(ENVIRONMENT).find((material) => material.name.endsWith('_14110e'));
    expect(dark).toBeDefined();
    const rendered = fromLinear(dark!.factor[0]!);
    const intended = 0x14 / 255;
    expect(rendered).toBeGreaterThan(intended * 3);
  });
});

/* The correction itself: the standard sRGB electro-optical transfer function. */
function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/*
 * Its exact inverse, not the gamma-2.2 approximation.
 *
 * sRGB has a linear toe below 0.0031308, so `value ** (1 / 2.2)` is off by
 * enough to fail a round-trip on dark colours: 0x14 comes back as 0.105
 * against an authored 0.078. Dark surfaces are exactly what this correction
 * is for, so the test has to use the real curve.
 */
function fromLinear(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

describe('the ingest correction', () => {
  it('restores the authored colour rather than merely darkening it', () => {
    // Round-trips: correcting then re-encoding for display returns the author's
    // value, which is what makes this a fix and not a taste adjustment.
    for (const sample of [0x14 / 255, 0x65 / 255, 0xff / 255, 0x8f / 255]) {
      expect(fromLinear(toLinear(sample))).toBeCloseTo(sample, 6);
    }
  });

  it('leaves black and white alone', () => {
    expect(toLinear(0)).toBe(0);
    expect(toLinear(1)).toBeCloseTo(1, 6);
  });

  it('only ever darkens, never brightens', () => {
    for (let step = 0; step <= 20; step += 1) {
      const channel = step / 20;
      expect(toLinear(channel)).toBeLessThanOrEqual(channel + 1e-9);
    }
  });
});
