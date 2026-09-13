import { CanvasTexture, LinearFilter, SRGBColorSpace, type Texture } from 'three';
import { ATLAS_WORLD_PALETTE, worldColourCss, type AtlasWorldColour } from '../../palette';

export interface AtlasSkyStop {
  readonly offset: number;
  readonly colour: number;
}

export type AtlasCanvasFactory = (width: number, height: number) => HTMLCanvasElement | null;

/*
 * Zenith, mid sky, horizon haze.
 *
 * The first stop used to be `water`, which is the same value as `sky`, so the
 * top 55% of the gradient was a single flat colour and the sky contributed no
 * depth to any outdoor shot. Three distinct values, darkest at the top.
 */
const STOP_KEYS: readonly { readonly offset: number; readonly key: AtlasWorldColour }[] = [
  { offset: 0, key: 'skyZenith' },
  { offset: 0.55, key: 'sky' },
  { offset: 1, key: 'haze' },
];

export function atlasSkyGradientStops(): readonly AtlasSkyStop[] {
  return STOP_KEYS.map(({ offset, key }) => ({ offset, colour: ATLAS_WORLD_PALETTE[key] }));
}

export function atlasHorizonColour(): number {
  return ATLAS_WORLD_PALETTE[STOP_KEYS[STOP_KEYS.length - 1]!.key];
}

/*
 * A 2x256 gradient strip, stretched across the background.
 *
 * Cheaper than a sky sphere and it cannot be walked through. The canvas is
 * injected so this is testable in a node environment, and so a WebView that
 * refuses a 2D context degrades to the solid clear colour instead of throwing
 * on the way to first paint.
 */
export function createAtlasSkyTexture(createCanvas: AtlasCanvasFactory): Texture | null {
  const canvas = createCanvas(2, 256);
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return null;
  const gradient = context.createLinearGradient(0, 0, 0, 256);
  for (const { offset, key } of STOP_KEYS) gradient.addColorStop(offset, worldColourCss(key));
  context.fillStyle = gradient;
  context.fillRect(0, 0, 2, 256);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}
