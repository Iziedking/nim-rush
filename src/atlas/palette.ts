/*
 * Every colour in the Atlas world, defined once.
 *
 * Before this file the same values were written out in four places:
 * three/palette.ts, three-renderer.ts, pixi-renderer.ts and renderer.ts. That
 * is how the palette drifted the first time, and it is why recolouring the
 * world used to mean finding fifty literals by hand.
 *
 * The eight keys under "material names" are GLB material names, declared by
 * art/atlas/characters/atlas-walker-v1/character-spec.json and emitted into
 * every character GLB. prepareRuntimeMaterials and the crowd wardrobe below
 * look materials up by those names, so renaming one desyncs the runtime from
 * the shipped art. Add keys freely; rename none. atlas-palette.test.ts asserts
 * the eight against the spec file.
 *
 * Two of them had already drifted when this module was written: the old map
 * carried skin as 0xd9a27f and skinShadow as 0xb97758 against the spec's
 * 0xc98c68 and 0xa7684f, and it named 0x292725 "charcoal" when the art calls it
 * "workwear" — a name no GLB material could ever match. Neither was visible
 * because the map they lived in had no consumers at all.
 */
export const ATLAS_WORLD_PALETTE = Object.freeze({
  // Material names, mirrored from character-spec.json.
  skin: 0xc98c68,
  skinShadow: 0xa7684f,
  ink: 0x14110e,
  workwear: 0x292725,
  cream: 0xf4ede0,
  orange: 0xff5a1f,
  seafoam: 0x8fb3a8,
  leather: 0x65513b,

  // Environment surfaces.
  paper: 0xdfe6f5,
  water: 0x4cc9f0,
  plant: 0x06d6a0,

  // Atmosphere.
  /*
   * The top of the sky.
   *
   * The gradient used to run `water` -> `sky` -> `haze`, and `water` and `sky`
   * are the same 0x4cc9f0, so its top 55% was one flat colour: a slab of
   * identical blue filling the upper half of every outdoor shot. A zenith that
   * is actually darker than the horizon is what makes a sky read as depth
   * rather than as a backdrop.
   */
  skyZenith: 0x1668a8,
  sky: 0x4cc9f0,
  haze: 0xa8dcf0,
  ambientLight: 0xf2f8ff,
  sunLight: 0xfff3d6,

  /*
   * "Not emitting", for materials whose emissive is switched on and off.
   *
   * A token rather than a bare 0x000000 in the renderer, because
   * atlas-palette.test.ts holds the renderers to carrying no colour of their
   * own and it is right to: an unlit lantern is a state of the palette, not a
   * literal someone typed.
   */
  emissiveOff: 0x000000,

  // Restoration signals and lantern stations.
  restorationEmitter: 0xff477e,
  guidanceEmitter: 0xffd166,
  lanternUnlit: 0x6b7398,
  lanternLit: 0xffd166,
  lanternComplete: 0x06d6a0,
  lanternMast: 0x4a5280,
  lanternMastComplete: 0x06d6a0,
  lanternPedestal: 0x5b6490,
  stationWarm: 0xff9f1c,
  stationDim: 0x4a5280,
  stationGold: 0xffd166,

  // The two paths, worn by the player's ground ring so the crowd cannot be
  // mistaken for them. Neither is the guide's pink, which the copy points at.
  explorerPath: 0xffd166,
  builderPath: 0xa78bfa,
});

export type AtlasWorldColour = keyof typeof ATLAS_WORLD_PALETTE;

export function worldColourCss(name: AtlasWorldColour): string {
  return `#${ATLAS_WORLD_PALETTE[name].toString(16).padStart(6, '0')}`;
}

/*
 * Crowd wardrobe.
 *
 * Each variant overrides GLB material colours by name, which is why the keys
 * here are material names and not free-form labels: prepareRuntimeMaterials
 * matches them against the material it is tinting. A key that is not a material
 * name is silently ignored, so these are asserted against the spec too.
 */
export const ATLAS_CITIZEN_WARDROBE = Object.freeze([
  Object.freeze({ orange: '#2f7890', workwear: '#d4d9cf', seafoam: '#e08a38', ink: '#2c2530' }),
  Object.freeze({ orange: '#bd5b32', workwear: '#3f5364', seafoam: '#d8bd73', ink: '#30252a' }),
  Object.freeze({ orange: '#477c62', workwear: '#a8b6a8', seafoam: '#cf7840', ink: '#26333a' }),
  Object.freeze({ orange: '#d18b37', workwear: '#5b6674', seafoam: '#78a7a1', ink: '#282631' }),
]);

/*
 * The 2D canvas fallback's illustration palette.
 *
 * Separate from ATLAS_WORLD_PALETTE on purpose. That map's material keys are
 * GLB material names and changing one changes the shipped art; these are
 * drawing colours for a flat illustration of the same world and answer to
 * nothing but that renderer. Same file, so the palette is still in one place.
 */
export const ATLAS_FALLBACK_PALETTE = Object.freeze({
  line: '#f7f9ff',
  ground: '#101430',
  groundDim: '#1a2044',
  groundBuilder: '#1e2a52',
  groundRaised: '#20264c',
  sandLight: '#2a3160',
  sandWarm: '#333a6e',
  sandDeep: '#3b4276',
  active: '#ff477e',
  activeDim: '#d81e5b',
  relayScanned: '#ffd166',
  beaconGold: '#ffb703',
  muted: '#a6b0d6',
  settled: '#06d6a0',
  rescued: '#4ade80',
  selection: '#4cc9f0',
  warn: '#ff9f1c',
  builderPath: '#a78bfa',
  foliageLight: '#5eead4',
  foliageMid: '#06d6a0',
  waterLight: '#7dd3fc',
  waterDeep: '#4cc9f0',
  routeQuiet: '#5b6490',
  stone: '#6b7398',
  slate: '#4a5280',
  skinWarm: '#c98c68',
  clay: '#f472b6',
  timber: '#8b5cf6',
  timberDark: '#4c1d95',
  shadow: '#060818',
});

export type AtlasFallbackColour = keyof typeof ATLAS_FALLBACK_PALETTE;

/*
 * The stylesheet's colour tokens, mirrored.
 *
 * CSS cannot import TypeScript, so atlas.css declares these itself and
 * atlas-palette.test.ts asserts the two agree. The mirror exists so a recolour
 * is one reviewed change in one file rather than a hunt through a 47 KB
 * stylesheet, and so anything needing a UI colour in TypeScript reads it from
 * here instead of hardcoding a second copy.
 *
 * Keys omit the leading '--'. Non-colour tokens such as --atlas-line stay out;
 * this map is the palette, not the whole of :root.
 */
export const ATLAS_UI_TOKENS = Object.freeze({
  'atlas-paper': 'rgba(16, 20, 44, .82)',
  'atlas-raised': 'rgba(32, 38, 76, .78)',
  'atlas-ink': '#f7f9ff',
  'atlas-muted': '#a6b0d6',
  'atlas-label': '#b9c2ea',
  'atlas-label-dim': '#8f9ac4',
  'atlas-signal': '#ff477e',
  'atlas-signal-deep': '#d81e5b',
  'atlas-warn': '#ff9f1c',
  'atlas-verified': '#06d6a0',
  'atlas-selected': '#4cc9f0',
  'atlas-explorer': '#ffd166',
  'atlas-builder': '#a78bfa',
  'atlas-inert': '#4a5280',
  'atlas-on-accent': '#101430',
  'atlas-city-ground': '#1a2044',
  'atlas-map-quiet': '#5b6490',
  'atlas-map-panel': 'rgba(32, 38, 76, .78)',
  'atlas-pace-walk': '#06d6a0',
  'atlas-pace-run': '#ffd166',
  'atlas-ready': '#4cc9f0',
  'atlas-hud-dim': '#a6b0d6',
  'atlas-mission-surface': 'rgb(var(--atlas-paper-rgb) / .9)',
  'atlas-mission-line': 'rgb(var(--atlas-ink-rgb) / .18)',
  'atlas-mission-shadow': 'rgb(var(--atlas-shadow-rgb) / .5)',
  'atlas-paper-rgb': '16 20 44',
  'atlas-ink-rgb': '247 249 255',
  'atlas-signal-rgb': '255 71 126',
  'atlas-explorer-rgb': '255 209 102',
  'atlas-shadow-rgb': '6 8 24',
  'atlas-raised-rgb': '32 38 76',
  'atlas-map-panel-rgb': '32 38 76',
  /* Real money on the live chain, and the channel forms the reaction layer
     composes its flashes from. See src/atlas/juice.ts. */
  'atlas-treasury': '#ffd166',
  'atlas-selected-rgb': '76 201 240',
  'atlas-verified-rgb': '6 214 160',
  'atlas-treasury-rgb': '255 209 102',
});

export type AtlasUiToken = keyof typeof ATLAS_UI_TOKENS;
