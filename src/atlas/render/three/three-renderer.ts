import { BoxGeometry, Color, CylinderGeometry, DoubleSide, PCFShadowMap, Fog, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PerspectiveCamera, PointLight, Scene, SphereGeometry, TorusGeometry, WebGLRenderer } from 'three';
import type { AtlasLivingWorldSnapshot } from '../../../../shared/atlas/living-world';
import type { AtlasQualityTier } from '../../../../shared/atlas/city/types';
import { QUALITY_PROFILES } from '../../../../shared/atlas/city/quality';
import { ATLAS_CITIZEN_WARDROBE, ATLAS_WORLD_PALETTE, worldColourCss } from '../../palette';
import type { AtlasCitizenPresentation } from '../../../../shared/atlas/city/crowd';
import { BEACON_COMMONS_CROWD } from '../../../../shared/atlas/city/crowd';
import { atlasCitizenAppearance, type AtlasCitizenAppearanceProfile } from '../../../../shared/atlas/city/character-appearance';
import { ATLAS_PLAYER_PERSONAL_SPACE_METERS, projectAtlasCitizenMotion, resolveAtlasCitizenSpacing, routeAtlasCitizenPath, type AtlasCitizenMotionProjection } from '../../../../shared/atlas/city/citizen-motion';
import type { AtlasCityPlayerState } from '../../../../shared/atlas/city/player';
import { parseAtlasCityScene, type AtlasCitySceneV1 } from '../../../../shared/atlas/city/types';
import type { AtlasCityInteractionPresentation, AtlasRendererOptions, AtlasRendererStats, AtlasSceneRenderer } from '../contracts';
import { detectThreeCapability } from './capability';
import { ATLAS_CAMERA_FIELD_OF_VIEW_DEGREES, AtlasCameraRig } from './camera-rig';
import { createHarborSupplies } from './harbor-supplies';
import { createAtlasLighting, type AtlasLighting } from './lighting';
import { atlasHorizonColour, createAtlasSkyTexture } from './sky';
import { toAtlasToonMaterial } from './toon';
import { createBlobShadow, shadowPlanForTier } from './shadows';
import { attachAtlasOutline, outlinesEnabledForTier, NO_OUTLINE_FLAG } from './outline';
import {
  atlasCitizenAnimationState,
  atlasCharacterHeadingBlend,
  atlasCitizenDetailLevel,
  atlasCitizenFacialCue,
  createAtlasCharacterAnimator,
  type AtlasCharacterAnimator,
} from './character-animation';
import { AtlasGltfResourceCache } from './gltf-loader';
import type { AtlasGltfHandle } from './gltf-loader';
import {
  applyAtlasCitizenIdentity,
  createAtlasPlayerRoleAppearance,
  type AtlasCitizenIdentity,
  type AtlasPlayerRoleAppearance,
} from './character-appearance';

// Keep the authored character proportions intact while giving the city more breathing room on mobile.
const PLAYER_WORLD_SCALE = 0.72;
const NPC_WORLD_SCALE = 0.68;
// Heavier than the default: a character is what the eye tracks, and a hairline
// rim disappears against a busy street at phone size.
const CHARACTER_OUTLINE_THICKNESS = 0.055;

interface AtlasNpcSlot {
  readonly id: string;
  readonly lod1Root: Group;
  readonly lod2Root: Group;
  readonly lod1Animator: AtlasCharacterAnimator;
  readonly lod2Animator: AtlasCharacterAnimator;
  readonly lod1Identity: AtlasCitizenIdentity;
  readonly spawn: readonly [number, number, number];
  readonly lastPosition: { x: number; z: number };
  readonly displayPosition: { x: number; z: number };
  /* Which rig is currently drawn, so the switch can be given hysteresis and the
     animation phase can be carried across it. */
  detailLevel: 'near' | 'distant';
}

/**
 * Put a glTF base colour back into the colour space it was authored in.
 *
 * Both art builders write `channel / 255.0` into `baseColorFactor`, a field
 * the glTF spec defines as **linear**. That puts the sRGB fraction where the
 * linear value belongs, so every surface in the game renders far lighter and
 * flatter than the art intends. The material names carry the intended hex, so
 * the damage is measurable: `BeaconCommons_14110e` is authored as a near-black
 * and arrives as `#504a44`, a mid grey. `ff5a1f`, a vivid orange, arrives as
 * `#ff9f62`, a pale salmon. That single error is most of why the city read as
 * an untextured greybox rather than as a place.
 *
 * The correction happens here, at the ingest boundary, rather than in the
 * builders. Fixing the builders without regenerating every GLB would be worse
 * than leaving them: the shipped assets would still hold sRGB, this correction
 * would still fire, and newly built assets would be darkened twice.
 * `atlas-colour-space.test.ts` asserts the shipped assets still need this, so
 * whoever does regenerate them is told to remove this step rather than
 * discovering the double-darkening by eye.
 */
function atlasCorrectGltfColourSpace(color: Color): void {
  const toLinear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  color.setRGB(toLinear(color.r), toLinear(color.g), toLinear(color.b));
}

export class ThreeAtlasRenderer implements AtlasSceneRenderer {
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private loadedDistrict: string | null = null;
  private qualityTier: AtlasQualityTier = 'balanced';
  private maxPixelRatio = 2;
  private cameraRig: AtlasCameraRig | null = null;
  private lighting: AtlasLighting | null = null;
  private readonly blobShadows: Mesh[] = [];
  private gltfCache: AtlasGltfResourceCache | null = null;
  private assetManager: AtlasRendererOptions['assetManager'] | null = null;
  private readonly districtHandles = new Map<string, AtlasGltfHandle[]>();
  private readonly districtSignalLights = new Map<string, Array<{ light: PointLight; baseIntensity: number }>>();
  private districtScene: AtlasCitySceneV1 | null = null;
  private routedPaths = new Map<string, AtlasCitySceneV1['paths'][number]>();
  private playerRoot: Object3D | null = null;
  private playerRing: Mesh | null = null;
  private playerRole: 'explorer' | 'builder' = 'explorer';
  private playerRoleAppearance: AtlasPlayerRoleAppearance | null = null;
  private playerAnimator: AtlasCharacterAnimator | null = null;
  private relayRoot: Group | null = null;
  private relayParent: Object3D | null = null;
  private stationVisuals: Array<{ root: Group; light: Mesh; ring: Mesh; mast: Mesh; beam: Mesh }> = [];
  private missionMarker: Group | null = null;
  private missionMarkerAnchorId: string | null = null;
  private harborActivityVisuals: {
    root: Group;
    marketSignal: Mesh;
    ferryHull: Mesh;
    ferryLight: Mesh;
    towerHalo: Mesh;
  } | null = null;
  private npcSlots: AtlasNpcSlot[] = [];
  private lastAnimationTick: number | null = null;
  private reducedMotion = false;
  private onPlayerFootstep: (() => void) | undefined;
  private lastPlayerSpeed = 0;
  private playerVisualHeading: number | null = null;

  async initialize(host: HTMLElement, options: AtlasRendererOptions): Promise<void> {
    this.reducedMotion = options.reducedMotion;
    this.onPlayerFootstep = options.onPlayerFootstep;
    if (this.renderer) throw new Error('Three Atlas renderer is already initialized.');
    const canvas = document.createElement('canvas');
    const capability = detectThreeCapability(canvas);
    if (!capability.supported) throw new Error(`Three Atlas renderer unavailable: ${capability.reason}.`);

    const renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.maxPixelRatio = clampResolution(options.maxPixelRatio ?? options.resolution ?? 2);
    renderer.setSize(clampDimension(host.clientWidth), clampDimension(host.clientHeight), false);
    renderer.setClearColor(new Color(ATLAS_WORLD_PALETTE.sky), 1);
    renderer.shadowMap.type = PCFShadowMap;

    const scene = new Scene();
    const sky = createAtlasSkyTexture((width, height) => {
      const element = document.createElement('canvas');
      element.width = width;
      element.height = height;
      return element;
    });
    scene.background = sky ?? new Color(ATLAS_WORLD_PALETTE.sky);
    scene.fog = new Fog(atlasHorizonColour(), 24, 62);
    const lighting = createAtlasLighting();
    scene.add(lighting.hemisphere);
    scene.add(lighting.sun);
    scene.add(lighting.rim);

    const camera = new PerspectiveCamera(ATLAS_CAMERA_FIELD_OF_VIEW_DEGREES, aspect(host.clientWidth, host.clientHeight), 0.1, 200);
    const cameraRig = new AtlasCameraRig(camera, { avatarHeightMeters: 1.76 * PLAYER_WORLD_SCALE });
    host.append(canvas);
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.cameraRig = cameraRig;
    this.lighting = lighting;
    this.assetManager = options.assetManager ?? null;
    this.gltfCache = options.assetManager ? new AtlasGltfResourceCache({ assetManager: options.assetManager }) : null;
    this.setQuality(options.qualityTier ?? 'balanced');
  }

  async loadDistrict(districtId: string): Promise<void> {
    this.requireRenderer();
    if (this.districtHandles.has(districtId)) {
      this.loadedDistrict = districtId;
      return;
    }
    if (this.gltfCache && this.scene) {
      const acquired: AtlasGltfHandle[] = [];
      try {
        const scenePath = `/atlas/3d/v1/${districtId}/scene.json`;
        const sceneDefinition = parseAtlasCityScene(JSON.parse(new TextDecoder().decode(await this.optionsAssetManager().loadBytes(scenePath))) as unknown);
        const modelUrls = new Map(sceneDefinition.models.map((model) => [model.id, model.url]));
        const environmentModel = modelUrls.get(`${districtId}-environment`);
        const playerModel = modelUrls.get('atlas-walker-player');
        const npcLod1Model = modelUrls.get('atlas-walker-npc-lod1');
        const npcLod2Model = modelUrls.get('atlas-walker-npc-lod2');
        if (!environmentModel || !playerModel || !npcLod1Model || !npcLod2Model) throw new Error(`Atlas district ${districtId} is missing a required model.`);
        /*
         * The crowd's second body.
         *
         * Optional on purpose: a district whose scene predates the variant
         * still loads, it just draws one body for everyone. Making it required
         * would turn an art addition into a district that refuses to open.
         */
        const npcBodies = [
          { lod1: npcLod1Model, lod2: npcLod2Model },
          {
            lod1: modelUrls.get('atlas-walker-npc-female-lod1') ?? npcLod1Model,
            lod2: modelUrls.get('atlas-walker-npc-female-lod2') ?? npcLod2Model,
          },
        ];
        const environment = await this.gltfCache.acquire(environmentModel);
        acquired.push(environment);
        this.prepareRuntimeMaterials(environment.root);
        const player = await this.gltfCache.acquire(playerModel);
        acquired.push(player);
        this.prepareRuntimeMaterials(player.root);
        this.playerRoleAppearance = createAtlasPlayerRoleAppearance(player.root, this.playerRole);
        if (outlinesEnabledForTier(this.qualityTier)) attachAtlasOutline(player.root, CHARACTER_OUTLINE_THICKNESS);
        this.attachContactShadow(player.root);
        this.attachPlayerRing(player.root);
        this.applyInstanceTransform(player.root, sceneDefinition.instances.find((instance) => instance.modelId === 'atlas-walker-player'));
        player.root.scale.multiplyScalar(PLAYER_WORLD_SCALE);
        this.playerRoot = player.root;
        this.playerAnimator = createAtlasCharacterAnimator(player.root, player.animations, { facialPhase: 0.17 });
        this.scene.add(environment.root, player.root);
        this.createPayHarborInteractionVisuals(districtId, sceneDefinition);
        const npcAnchors = new Map(sceneDefinition.anchors.filter((anchor) => anchor.id.startsWith('npc-spawn-')).map((anchor) => [anchor.id, anchor]));
        const districtCrowd = BEACON_COMMONS_CROWD.filter((citizen) => npcAnchors.has(citizen.spawnAnchorId));
        const npcHandles = await Promise.all(districtCrowd.map(async (citizen) => {
          const anchor = npcAnchors.get(citizen.spawnAnchorId);
          if (!anchor) throw new Error(`Atlas district ${districtId} is missing NPC spawn anchor ${citizen.spawnAnchorId}.`);
          /*
           * Which body this citizen has, chosen from its id so it is stable
           * across reloads and across the LOD swap. A citizen that changed
           * body when it crossed the detail threshold would read as two
           * different people.
           */
          const body = npcBodies[stableHash(`${citizen.id}:body`) % npcBodies.length]!;
          const [lod1, lod2] = await Promise.all([this.gltfCache!.acquire(body.lod1), this.gltfCache!.acquire(body.lod2)]);
          return { citizen, anchor, lod1, lod2 };
        }));
        acquired.push(...npcHandles.flatMap(({ lod1, lod2 }) => [lod1, lod2]));
        this.npcSlots = npcHandles.map(({ citizen, anchor, lod1, lod2 }) => {
          const lod1Root = lod1.root as Group;
          const lod2Root = lod2.root as Group;
          const appearance = citizenAppearance(citizen.id, citizen.role);
          this.prepareRuntimeMaterials(lod1Root, appearance);
          this.prepareRuntimeMaterials(lod2Root, appearance);
          const lod1Identity = applyAtlasCitizenIdentity(lod1Root, appearance.profile, appearance.colors.ink ?? worldColourCss('ink'));
          for (const root of [lod1Root, lod2Root]) {
            root.visible = false;
            root.scale.setScalar(NPC_WORLD_SCALE * appearance.scale);
            root.position.set(anchor.position[0], anchor.position[1], anchor.position[2]);
            if (outlinesEnabledForTier(this.qualityTier)) attachAtlasOutline(root, CHARACTER_OUTLINE_THICKNESS);
            this.attachContactShadow(root);
            this.scene!.add(root);
          }
          return {
            id: citizen.id,
            lod1Root,
            lod2Root,
            lod1Animator: createAtlasCharacterAnimator(lod1Root, lod1.animations, { facialPhase: (stableHash(citizen.id) % 1000) / 1000 }),
            lod2Animator: createAtlasCharacterAnimator(lod2Root, lod2.animations, { facialPhase: (stableHash(citizen.id) % 1000) / 1000 }),
            lod1Identity,
            spawn: anchor.position,
            // Starts distant: nothing is drawn near until the player is close.
            detailLevel: 'distant' as const,
            lastPosition: { x: anchor.position[0], z: anchor.position[2] },
            displayPosition: { x: anchor.position[0], z: anchor.position[2] },
          };
        });
        const signalLights = sceneDefinition.emitters
          .filter((emitter) => emitter.kind === 'lantern' || emitter.kind === 'restoration')
          .map((emitter) => {
            const light = new PointLight(emitter.kind === 'restoration' ? ATLAS_WORLD_PALETTE.restorationEmitter : ATLAS_WORLD_PALETTE.guidanceEmitter, emitter.intensity * 0.12, 10, 2);
            light.position.set(emitter.position[0], emitter.position[1], emitter.position[2]);
            this.scene!.add(light);
            return { light, baseIntensity: emitter.intensity };
          });
        this.districtSignalLights.set(districtId, signalLights);
        this.districtScene = sceneDefinition;
        this.routedPaths = new Map(sceneDefinition.paths.map((path) => [path.id, routeAtlasCitizenPath(path, sceneDefinition.colliders)]));
        this.districtHandles.set(districtId, acquired);
      } catch (error) {
        this.stopCharacterAnimations();
        this.clearCharacterAppearance();
        for (const { light } of this.districtSignalLights.get(districtId) ?? []) light.removeFromParent();
        this.districtSignalLights.delete(districtId);
        for (const handle of [...acquired].reverse()) handle.release();
        this.npcSlots = [];
        this.lastAnimationTick = null;
        this.playerRoot = null;
        this.playerVisualHeading = null;
        this.districtScene = null;
        this.routedPaths.clear();
        throw error;
      }
    }
    this.loadedDistrict = districtId;
  }

  render(snapshot: AtlasLivingWorldSnapshot, crowd: readonly AtlasCitizenPresentation[] = [], player?: AtlasCityPlayerState, interaction?: AtlasCityInteractionPresentation): void {
    const renderer = this.requireRenderer();
    if (!this.scene || !this.camera) throw new Error('Three Atlas renderer scene is not initialized.');
    const deltaSeconds = this.animationDeltaSeconds(snapshot.simulation.tick);
    this.presentPlayer(player, deltaSeconds);
    this.presentCrowd(crowd, snapshot.simulation.tick, deltaSeconds);
    this.presentRestorationLights(snapshot.restoration, snapshot.simulation.tick);
    this.presentInteractionVisuals(snapshot.restoration, interaction, snapshot.simulation.tick);
    this.cameraRig?.update({
      width: this.canvas?.clientWidth ?? 1,
      height: this.canvas?.clientHeight ?? 1,
      deltaSeconds,
      playerPosition: this.playerRoot?.position,
      playerFacing: player?.facing,
      playerHeadingRadians: player?.headingRadians,
      cameraHeadingRadians: player?.cameraHeadingRadians,
      playerMoving: player?.moving,
      playerRunning: player?.pace === 'run',
      mode: interaction?.cameraMode,
      reducedMotion: this.reducedMotion,
      colliders: this.districtScene?.colliders,
    });
    renderer.render(this.scene, this.camera);
  }

  resize(width: number, height: number, _resolution: number): void {
    const renderer = this.renderer;
    const camera = this.camera;
    if (!renderer || !camera) return;
    const safeWidth = clampDimension(width);
    const safeHeight = clampDimension(height);
    this.cameraRig?.resize(safeWidth, safeHeight);
    renderer.setPixelRatio(this.pixelRatioForTier());
    renderer.setSize(safeWidth, safeHeight, false);
  }

  setQuality(tier: AtlasQualityTier): void {
    this.qualityTier = tier;
    if (!this.renderer) return;
    this.renderer.setPixelRatio(this.pixelRatioForTier());
    const plan = shadowPlanForTier(tier);
    this.renderer.shadowMap.enabled = plan.mapEnabled;
    for (const blob of this.blobShadows) blob.visible = plan.blobs;
    if (!this.lighting) return;
    this.lighting.sun.castShadow = plan.mapEnabled;
    this.lighting.sun.shadow.mapSize.setScalar(plan.mapSize);
    this.lighting.sun.shadow.camera.far = 60;
  }

  stats(): AtlasRendererStats {
    const info = this.renderer?.info;
    return {
      kind: 'three',
      drawCalls: info?.render.calls ?? 0,
      triangles: info?.render.triangles ?? 0,
      geometries: info?.memory.geometries ?? 0,
      textures: info?.memory.textures ?? 0,
    };
  }

  async releaseDistrict(districtId: string): Promise<void> {
    const handles = this.districtHandles.get(districtId);
    if (!handles) return;
    if (this.loadedDistrict === districtId) this.stopCharacterAnimations();
    if (this.loadedDistrict === districtId) this.clearInteractionVisuals();
    if (this.loadedDistrict === districtId) this.clearCharacterAppearance();
    for (const handle of [...handles].reverse()) handle.release();
    for (const { light } of this.districtSignalLights.get(districtId) ?? []) light.removeFromParent();
    this.districtSignalLights.delete(districtId);
    this.districtHandles.delete(districtId);
    if (this.loadedDistrict === districtId) {
      this.districtScene = null;
      this.routedPaths.clear();
      this.playerRoot = null;
      this.playerVisualHeading = null;
      this.lastAnimationTick = null;
      this.npcSlots = [];
    }
    if (this.loadedDistrict === districtId) this.loadedDistrict = null;
  }

  async destroy(): Promise<void> {
    const renderer = this.renderer;
    const canvas = this.canvas;
    this.stopCharacterAnimations();
    this.clearInteractionVisuals();
    this.clearCharacterAppearance();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.canvas = null;
    this.loadedDistrict = null;
    this.districtScene = null;
    this.routedPaths.clear();
    this.playerRoot = null;
    this.playerVisualHeading = null;
    this.lastAnimationTick = null;
    this.npcSlots = [];
    for (const handles of this.districtHandles.values()) for (const handle of [...handles].reverse()) handle.release();
    this.districtHandles.clear();
    this.districtSignalLights.clear();
    this.cameraRig = null;
    this.gltfCache = null;
    this.assetManager = null;
    renderer?.dispose();
    canvas?.remove();
  }

  private requireRenderer(): WebGLRenderer {
    if (!this.renderer) throw new Error('Three Atlas renderer is not initialized.');
    return this.renderer;
  }

  /*
   * Render scale is a fraction of the device's pixel ratio, not a pixel ratio.
   *
   * This used to return 0.7, 0.85 or 1 straight into setPixelRatio, which sets
   * the backing store to that many pixels per CSS pixel. On a phone reporting
   * devicePixelRatio 3 the city was drawn at 0.85/3 — about 28% of native — and
   * upscaled to fill the screen. A playtester reported it as "color is blurry",
   * and the screenshots show softened edges on every surface.
   *
   * The scales now come from QUALITY_PROFILES rather than being repeated here,
   * so the governor's idea of a tier and the renderer's cannot drift, and the
   * device ratio is capped so a 3x phone does not pay for pixels nobody can
   * see. If the result is too expensive, render-scale is the last step in
   * QUALITY_REDUCTION_ORDER and the governor will reach for it.
   */
  private pixelRatioForTier(): number {
    const device = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const scale = QUALITY_PROFILES[this.qualityTier].renderScale;
    return Math.max(1, Math.min(device, this.maxPixelRatio) * scale);
  }

  private optionsAssetManager(): Pick<NonNullable<AtlasRendererOptions['assetManager']>, 'loadBytes'> {
    const manager = this.assetManager;
    if (!manager) throw new Error('Atlas 3D assets are unavailable.');
    return manager;
  }

  private applyInstanceTransform(root: Object3D, instance: AtlasCitySceneV1['instances'][number] | undefined): void {
    if (!instance) return;
    root.position.set(...instance.position);
    root.rotation.set(...instance.rotation);
    root.scale.set(...instance.scale);
  }

  /*
   * One flat disc under a character, so it reads as standing on the ground
   * rather than hovering over it. Attached at every tier and toggled by
   * setQuality: the high tier hides it because a real shadow map has taken
   * over, and every cheaper tier shows it because contact matters more than
   * accuracy.
   */
  /*
   * A ring on the ground under the player.
   *
   * Every citizen wears the same model, and the player is only fractionally
   * larger, so a playtester could not tell which figure was theirs. Every game
   * in the reference reel marks the player the same way. The colour is the
   * chosen path's, which also keeps reminding the player which one they took.
   */
  private attachPlayerRing(root: Object3D): void {
    const ring = new Mesh(
      new TorusGeometry(0.52, 0.055, 8, 28),
      new MeshBasicMaterial({ color: ATLAS_WORLD_PALETTE.explorerPath, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    ring.renderOrder = -1;
    ring.userData[NO_OUTLINE_FLAG] = true;
    this.playerRing = ring;
    root.add(ring);
    this.applyPlayerRole(this.playerRole);
  }

  setPlayerRole(role: 'explorer' | 'builder'): void {
    this.playerRole = role;
    this.playerRoleAppearance?.setRole(role);
    this.applyPlayerRole(role);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  private applyPlayerRole(role: 'explorer' | 'builder' | undefined): void {
    if (!this.playerRing || !role) return;
    const material = this.playerRing.material as MeshBasicMaterial;
    const colour = role === 'builder' ? ATLAS_WORLD_PALETTE.builderPath : ATLAS_WORLD_PALETTE.explorerPath;
    if (material.color.getHex() !== colour) material.color.setHex(colour);
  }

  private attachContactShadow(root: Object3D): void {
    const blob = createBlobShadow();
    blob.visible = shadowPlanForTier(this.qualityTier).blobs;
    this.blobShadows.push(blob);
    root.add(blob);
  }

  private prepareRuntimeMaterials(root: Object3D, appearance?: CitizenAppearance): void {
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      // Free unless shadowMap.enabled, which only the high tier turns on.
      object.castShadow = true;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const tinted = materials.map((material) => {
        const clone = material.clone();
        material.side = DoubleSide;
        clone.side = DoubleSide;
        const color = appearance?.colors[clone.name];
        const tintable = clone as typeof clone & { color?: Color };
        // A wardrobe tint is authored in sRGB and converted by three, so it is
        // already right; only an untouched glTF factor needs the correction.
        if (color && tintable.color instanceof Color) tintable.color.set(color);
        else if (tintable.color instanceof Color) atlasCorrectGltfColourSpace(tintable.color);
        // Tint first, then band. toAtlasToonMaterial copies the colour across,
        // so doing it in the other order would shade the untinted colour and
        // throw the wardrobe away.
        const toon = toAtlasToonMaterial(clone);
        toon.side = DoubleSide;
        toon.needsUpdate = true;
        return toon;
      });
      object.material = Array.isArray(object.material) ? tinted : tinted[0]!;
    });
  }

  private presentCrowd(crowd: readonly AtlasCitizenPresentation[], tick: number, deltaSeconds: number): void {
    if (!this.districtScene) return;
    const byId = new Map(crowd.map((citizen) => [citizen.id, citizen]));
    const projected: Array<{
      readonly slot: AtlasNpcSlot;
      readonly citizen: AtlasCitizenPresentation;
      readonly motion: AtlasCitizenMotionProjection;
    }> = [];
    for (const [slotIndex, slot] of this.npcSlots.entries()) {
      const citizen = byId.get(slot.id);
      slot.lod1Root.visible = false;
      slot.lod2Root.visible = false;
      if (!citizen?.visible) continue;
      const namedPath = this.districtScene.paths.find((candidate) => candidate.id === citizen.pathId);
      const fallbackPath = this.districtScene.paths[slotIndex % this.districtScene.paths.length];
      const path = (namedPath ? this.routedPaths.get(namedPath.id) : undefined) ?? (fallbackPath ? this.routedPaths.get(fallbackPath.id) : undefined) ?? namedPath ?? fallbackPath;
      const motion: AtlasCitizenMotionProjection = path
        ? projectAtlasCitizenMotion({
            active: citizen.active,
            activity: citizen.activity,
            elapsedSeconds: tick / 30,
            phase: citizen.animationPhase,
            path,
            spawn: slot.spawn,
          })
        : { position: slot.spawn, headingRadians: 0, moving: false, pace: 'idle', speedUnitsPerSecond: 0 };
      projected.push({ slot, citizen, motion });
    }
    const separated = resolveAtlasCitizenSpacing(
      projected.map(({ slot, citizen, motion }) => ({ id: citizen.id, motion, previousPosition: slot.lastPosition })),
      this.playerRoot ? { x: this.playerRoot.position.x, z: this.playerRoot.position.z } : undefined,
      this.districtScene.colliders,
    );
    for (const [index, { slot, citizen }] of projected.entries()) {
      const motion = separated[index]!;
      const position = motion.position;
      slot.lastPosition.x = position[0];
      slot.lastPosition.z = position[2];
      const presentationBlend = 1 - Math.exp(-Math.max(8, motion.moving ? 12 : 7) * deltaSeconds);
      const previousX = slot.displayPosition.x;
      const previousZ = slot.displayPosition.z;
      const dx = (position[0] - slot.displayPosition.x) * presentationBlend;
      const dz = (position[2] - slot.displayPosition.z) * presentationBlend;
      const maximumStep = Math.max(1.2, motion.speedUnitsPerSecond) * deltaSeconds;
      const stepScale = Math.min(1, maximumStep / Math.max(0.00001, Math.hypot(dx, dz)));
      slot.displayPosition.x += dx * stepScale;
      slot.displayPosition.z += dz * stepScale;
      this.keepCitizenOffPlayer(slot.displayPosition, citizen.id);
      const distanceFromPlayer = this.playerRoot ? Math.hypot(position[0] - this.playerRoot.position.x, position[2] - this.playerRoot.position.z) : Number.POSITIVE_INFINITY;
      const detailLevel = atlasCitizenDetailLevel(this.qualityTier, citizen.active, distanceFromPlayer, slot.detailLevel);
      if (detailLevel !== slot.detailLevel) {
        /*
         * Carry the stride across the swap.
         *
         * Only the visible rig is animated, so the one being switched to has
         * been frozen since it was last drawn. Handing it the other's mixer
         * time means the citizen keeps walking through the change instead of
         * snapping to a stale pose, which is what read as a doubled figure.
         */
        const leaving = slot.detailLevel === 'near' ? slot.lod1Animator : slot.lod2Animator;
        const arriving = detailLevel === 'near' ? slot.lod1Animator : slot.lod2Animator;
        arriving.mixer.setTime(leaving.mixer.time);
        arriving.restoreGait(leaving.gaitState());
        slot.detailLevel = detailLevel;
      }
      const root = detailLevel === 'near' ? slot.lod1Root : slot.lod2Root;
      root.visible = true;
      for (const characterRoot of [slot.lod1Root, slot.lod2Root]) {
        characterRoot.position.set(slot.displayPosition.x, position[1] + (!this.reducedMotion && citizen.activity === 'celebrating' ? Math.sin(tick / 6) * 0.045 : 0), slot.displayPosition.z);
        characterRoot.rotation.y = dampRadians(characterRoot.rotation.y, motion.headingRadians, 1 - Math.exp(-9 * deltaSeconds));
      }
      const animator = root === slot.lod1Root ? slot.lod1Animator : slot.lod2Animator;
      if (motion.moving || detailLevel === 'near' || citizen.active || this.qualityTier !== 'low') {
        const requestedPace = motion.pace === 'run' ? 'run' : 'walk';
        const animationState = atlasCitizenAnimationState(motion.moving, requestedPace, citizen.activity);
        const speedScale = citizenAnimationSpeed(animationState, motion.speedUnitsPerSecond);
        const renderedSpeed = deltaSeconds > 0 ? Math.hypot(slot.displayPosition.x - previousX, slot.displayPosition.z - previousZ) / deltaSeconds : 0;
        animator.update(animationState, deltaSeconds, speedScale, atlasCitizenFacialCue(citizen.activity), { speedUnitsPerSecond: Math.min(3, renderedSpeed), worldScale: NPC_WORLD_SCALE });
      }
    }
  }

  /*
   * Hold the drawn citizen out of the player, after smoothing.
   *
   * `resolveAtlasCitizenSpacing` already separates the simulation positions,
   * but `displayPosition` lags them and is clamped to about walking pace, so a
   * running player passes visibly through a body that has not caught up yet.
   * A play test reported it as players passing through each other.
   *
   * Applied last, in display space, so smoothing cannot reintroduce the
   * overlap it causes. The push is along the existing offset, which keeps the
   * citizen where it already was rather than teleporting it around the player.
   */
  private keepCitizenOffPlayer(position: { x: number; z: number }, citizenId: string): void {
    if (!this.playerRoot) return;
    const playerX = this.playerRoot.position.x;
    const playerZ = this.playerRoot.position.z;
    let offsetX = position.x - playerX;
    let offsetZ = position.z - playerZ;
    let distance = Math.hypot(offsetX, offsetZ);
    if (distance >= ATLAS_PLAYER_PERSONAL_SPACE_METERS) return;
    if (distance < 0.0001) {
      // Exactly coincident: pick a stable direction from the citizen's id so
      // the same pair never jitters between frames.
      const angle = (stableHash(citizenId) % 360) * (Math.PI / 180);
      offsetX = Math.sin(angle);
      offsetZ = Math.cos(angle);
      distance = 1;
    }
    position.x = playerX + (offsetX / distance) * ATLAS_PLAYER_PERSONAL_SPACE_METERS;
    position.z = playerZ + (offsetZ / distance) * ATLAS_PLAYER_PERSONAL_SPACE_METERS;
  }

  private presentRestorationLights(restoration: AtlasLivingWorldSnapshot['restoration'], tick: number): void {
    const lights = this.loadedDistrict ? this.districtSignalLights.get(this.loadedDistrict) ?? [] : [];
    const pulse = this.reducedMotion ? 0.58 : 0.58 + Math.sin(tick / 7) * 0.18;
    for (const { light, baseIntensity } of lights) {
      if (restoration === 'restored') light.intensity = baseIntensity * 2.4;
      else if (restoration === 'confirming') light.intensity = baseIntensity * pulse;
      else light.intensity = baseIntensity * 0.12;
    }
  }

  private presentPlayer(player: AtlasCityPlayerState | undefined, deltaSeconds: number): void {
    const root = this.playerRoot;
    if (!root || !player) return;
    root.position.set(player.x, 0, player.z);
    if (this.playerVisualHeading === null) this.playerVisualHeading = player.headingRadians;
    const blend = atlasCharacterHeadingBlend(this.playerVisualHeading, player.headingRadians, deltaSeconds, player.moving);
    this.playerVisualHeading = blend.heading;
    root.rotation.y = blend.heading;
    root.rotation.z = this.reducedMotion ? 0 : clampNumber(-blend.turnRate * 0.032, -0.1, 0.1);
    const facialCue = player.pace === 'run' ? 'focused' : 'neutral';
    const gaitBefore = this.playerAnimator?.gaitState();
    const dt = Math.max(deltaSeconds, 0.001);
    this.playerAnimator?.update(player.pace, deltaSeconds, playerAnimationSpeed(player), facialCue, { speedUnitsPerSecond: player.speedUnitsPerSecond, worldScale: PLAYER_WORLD_SCALE, acceleration: this.reducedMotion ? 0 : (player.speedUnitsPerSecond - this.lastPlayerSpeed) / dt, turnRate: this.reducedMotion ? 0 : blend.turnRate });
    const gaitAfter = this.playerAnimator?.gaitState();
    if (gaitBefore && gaitAfter && player.moving && Math.floor(gaitBefore.phase * 2) !== Math.floor(gaitAfter.phase * 2)) this.onPlayerFootstep?.();
    this.lastPlayerSpeed = player.speedUnitsPerSecond;
  }

  private animationDeltaSeconds(tick: number): number {
    const previous = this.lastAnimationTick;
    this.lastAnimationTick = tick;
    return previous === null ? 1 / 30 : Math.min(0.25, Math.max(0, tick - previous) / 30);
  }

  private stopCharacterAnimations(): void {
    this.playerAnimator?.stop();
    for (const slot of this.npcSlots) {
      slot.lod1Animator.stop();
      slot.lod2Animator.stop();
    }
    this.playerAnimator = null;
  }

  private clearCharacterAppearance(): void {
    this.playerRoleAppearance?.dispose();
    this.playerRoleAppearance = null;
    for (const slot of this.npcSlots) slot.lod1Identity.dispose();
  }

  private harborSupplies: ReturnType<typeof createHarborSupplies> | null = null;

  private createPayHarborInteractionVisuals(districtId: string, scene: AtlasCitySceneV1): void {
    this.clearInteractionVisuals();
    if (!this.scene || !this.playerRoot) return;

    const relay = new Group();
    relay.name = 'atlas-builder-relay-handheld';
    relay.add(
      new Mesh(new CylinderGeometry(0.07, 0.09, 0.42, 8), new MeshStandardMaterial({ color: ATLAS_WORLD_PALETTE.stationWarm, roughness: 0.72 })),
      new Mesh(new SphereGeometry(0.12, 8, 6), new MeshStandardMaterial({ color: ATLAS_WORLD_PALETTE.lanternComplete, roughness: 0.55 })),
    );
    relay.rotation.z = Math.PI * 0.45;
    const hand = findAttachmentSocket(this.playerRoot);
    this.relayParent = hand ?? this.playerRoot;
    this.relayParent.add(relay);
    relay.position.set(hand ? 0.06 : 0.22, hand ? 0.02 : 0.55, hand ? 0 : 0.05);
    relay.visible = false;
    this.relayRoot = relay;

    const stations = scene.anchors.filter((anchor) => districtId === 'beacon-commons' ? anchor.id === 'travel-pay-harbor' : /^station-[1-6]-install$/.test(anchor.id));
    this.stationVisuals = stations.map((anchor) => {
      const root = new Group();
      root.name = `atlas-builder-station-${anchor.id}`;
      root.position.set(anchor.position[0], anchor.position[1], anchor.position[2]);
      const pedestal = new Mesh(new CylinderGeometry(0.28, 0.34, 0.12, 8), new MeshStandardMaterial({ color: ATLAS_WORLD_PALETTE.lanternPedestal, roughness: 0.86 }));
      pedestal.position.y = 0.06;
      const light = new Mesh(new SphereGeometry(0.12, 8, 6), new MeshStandardMaterial({ color: ATLAS_WORLD_PALETTE.lanternUnlit, roughness: 0.5 }));
      light.position.y = 0.28;
      const ring = new Mesh(new TorusGeometry(0.2, 0.025, 6, 12), new MeshStandardMaterial({ color: ATLAS_WORLD_PALETTE.lanternMast, roughness: 0.66 }));
      ring.rotation.x = Math.PI * 0.5;
      ring.position.y = 0.2;
      const mast = new Mesh(new CylinderGeometry(0.035, 0.05, 0.42, 6), new MeshStandardMaterial({ color: ATLAS_WORLD_PALETTE.lanternMast, roughness: 0.72 }));
      mast.position.y = 0.42;
      const beam = new Mesh(new BoxGeometry(0.12, 0.045, 0.48), new MeshBasicMaterial({ color: ATLAS_WORLD_PALETTE.lanternUnlit }));
      beam.position.y = 0.67;
      beam.visible = false;
      root.add(pedestal, light, ring, mast, beam);
      this.scene!.add(root);
      return { root, light, ring, mast, beam };
    });

    if (districtId === 'pay-harbor') this.harborActivityVisuals = createHarborActivityVisuals(this.scene, scene);
    const market = scene.anchors.find((anchor) => anchor.id === 'conversation-market');
    if (market) this.harborSupplies = createHarborSupplies(this.scene, this.playerRoot, market.position);
  }

  private presentInteractionVisuals(restoration: AtlasLivingWorldSnapshot['restoration'], interaction: AtlasCityInteractionPresentation | undefined, tick: number): void {
    if (this.reducedMotion) tick = 0;
    if (!this.relayRoot) return;
    const isPayHarbor = interaction?.districtId === 'pay-harbor' && this.loadedDistrict === 'pay-harbor';
    this.harborSupplies?.update(isPayHarbor && interaction?.harborCargo === true, isPayHarbor ? interaction?.harborStocked ?? [] : [], isPayHarbor && interaction?.lanternCarried === true);
    const isCity = interaction?.districtId === this.loadedDistrict;
    const relayVisible = isCity && interaction?.relayCarried === true;
    this.relayRoot.visible = relayVisible;
    if (relayVisible) this.relayRoot.rotation.y = this.reducedMotion ? 0 : Math.sin(tick / 10) * 0.08;

    if (isCity && interaction?.targetAnchorId) {
      this.presentMissionMarker(interaction.targetAnchorId, tick);
    } else if (this.missionMarker) {
      this.missionMarker.visible = false;
    }

    const completedStations = restoration === 'restored' ? this.stationVisuals.length : Math.max(0, Math.min(this.stationVisuals.length, interaction?.builderStationIndex ?? 0));
    for (const [index, station] of this.stationVisuals.entries()) {
      const complete = index < completedStations;
      const active = !complete && isPayHarbor && interaction?.relayCarried === true && index === completedStations;
      const color = complete ? ATLAS_WORLD_PALETTE.lanternComplete : active ? ATLAS_WORLD_PALETTE.stationWarm : ATLAS_WORLD_PALETTE.lanternUnlit;
      const ringColor = complete ? ATLAS_WORLD_PALETTE.stationGold : active ? ATLAS_WORLD_PALETTE.lanternLit : ATLAS_WORLD_PALETTE.lanternMast;
      const lightMaterial = station.light.material as MeshStandardMaterial;
      const ringMaterial = station.ring.material as MeshStandardMaterial;
      const mastMaterial = station.mast.material as MeshStandardMaterial;
      const beamMaterial = station.beam.material as MeshBasicMaterial;
      lightMaterial.color.setHex(color);
      ringMaterial.color.setHex(ringColor);
      mastMaterial.color.setHex(complete ? ATLAS_WORLD_PALETTE.lanternMastComplete : ATLAS_WORLD_PALETTE.lanternMast);
      beamMaterial.color.setHex(complete ? ATLAS_WORLD_PALETTE.lanternComplete : ATLAS_WORLD_PALETTE.lanternLit);
      station.light.scale.setScalar(active ? 1 + Math.sin(tick / 8) * 0.08 : complete ? 1.08 : 0.86);
      station.beam.visible = complete || active;
      station.beam.scale.setScalar(active ? 1 + Math.sin(tick / 8) * 0.12 : complete ? 1 : 0.82);
      station.root.visible = isCity;
    }
    this.presentHarborActivity(restoration, isPayHarbor, tick, completedStations);
  }

  private clearInteractionVisuals(): void {
    this.harborSupplies?.dispose();
    this.harborSupplies = null;
    if (this.relayRoot) {
      this.relayParent?.remove(this.relayRoot);
      disposeObject(this.relayRoot);
    }
    for (const station of this.stationVisuals) {
      station.root.removeFromParent();
      disposeObject(station.root);
    }
    this.relayRoot = null;
    this.relayParent = null;
    this.stationVisuals = [];
    if (this.missionMarker) {
      this.missionMarker.removeFromParent();
      disposeObject(this.missionMarker);
    }
    this.missionMarker = null;
    this.missionMarkerAnchorId = null;
    if (this.harborActivityVisuals) {
      this.harborActivityVisuals.root.removeFromParent();
      disposeObject(this.harborActivityVisuals.root);
    }
    this.harborActivityVisuals = null;
  }

  private presentMissionMarker(anchorId: string, tick: number): void {
    if (!this.scene || !this.districtScene) return;
    const anchor = this.districtScene.anchors.find((candidate) => candidate.id === anchorId);
    if (!anchor) return;
    if (!this.missionMarker || this.missionMarkerAnchorId !== anchorId) {
      if (this.missionMarker) {
        this.missionMarker.removeFromParent();
        disposeObject(this.missionMarker);
      }
      const marker = new Group();
      marker.name = `atlas-mission-marker-${anchorId}`;
      const ring = new Mesh(new TorusGeometry(0.36, 0.035, 6, 16), new MeshBasicMaterial({ color: ATLAS_WORLD_PALETTE.restorationEmitter }));
      ring.rotation.x = Math.PI * 0.5;
      const stem = new Mesh(new CylinderGeometry(0.025, 0.025, 0.55, 6), new MeshBasicMaterial({ color: ATLAS_WORLD_PALETTE.restorationEmitter }));
      stem.position.y = 0.28;
      const cap = new Mesh(new SphereGeometry(0.08, 6, 4), new MeshBasicMaterial({ color: ATLAS_WORLD_PALETTE.lanternLit }));
      cap.position.y = 0.58;
      marker.add(ring, stem, cap);
      this.scene.add(marker);
      this.missionMarker = marker;
      this.missionMarkerAnchorId = anchorId;
    }
    this.missionMarker.visible = true;
    this.missionMarker.position.set(anchor.position[0], anchor.position[1] + 0.04, anchor.position[2]);
    this.missionMarker.scale.setScalar(0.9 + Math.sin(tick / 8) * 0.06);
  }

  private presentHarborActivity(restoration: AtlasLivingWorldSnapshot['restoration'], isPayHarbor: boolean, tick: number, completedStations: number): void {
    const visuals = this.harborActivityVisuals;
    if (!visuals) return;
    visuals.root.visible = isPayHarbor;
    if (!isPayHarbor) return;
    const activeColor = restoration === 'restored' || completedStations > 0 ? ATLAS_WORLD_PALETTE.lanternComplete : restoration === 'confirming' ? ATLAS_WORLD_PALETTE.lanternLit : ATLAS_WORLD_PALETTE.lanternUnlit;
    const signalMaterial = visuals.marketSignal.material as MeshStandardMaterial;
    const ferryMaterial = visuals.ferryHull.material as MeshStandardMaterial;
    const ferryLightMaterial = visuals.ferryLight.material as MeshBasicMaterial;
    const haloMaterial = visuals.towerHalo.material as MeshBasicMaterial;
    signalMaterial.color.setHex(activeColor);
    ferryMaterial.color.setHex(restoration === 'restored' ? ATLAS_WORLD_PALETTE.stationWarm : ATLAS_WORLD_PALETTE.stationDim);
    ferryLightMaterial.color.setHex(activeColor);
    haloMaterial.color.setHex(restoration === 'restored' ? ATLAS_WORLD_PALETTE.lanternLit : activeColor);
    const pulse = restoration === 'confirming' ? 1 + Math.sin(tick / 7) * 0.1 : restoration === 'restored' ? 1.08 : 0.9 + Math.min(0.12, completedStations * 0.02);
    visuals.marketSignal.scale.setScalar(pulse);
    visuals.ferryLight.scale.setScalar(restoration === 'restored' ? 1.12 : pulse);
    visuals.towerHalo.scale.setScalar(restoration === 'restored' ? 1.08 + Math.sin(tick / 10) * 0.05 : 0.82);
    visuals.towerHalo.rotation.z = tick / 180;
  }
}

function findAttachmentSocket(root: Object3D): Object3D | null {
  let socket: Object3D | null = null;
  root.traverse((object) => {
    if (socket) return;
    const name = object.name.toLowerCase();
    if (name.includes('hand') || name.includes('wrist')) socket = object;
  });
  return socket;
}

function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

function createHarborActivityVisuals(scene: Scene, district: AtlasCitySceneV1): NonNullable<ThreeAtlasRenderer['harborActivityVisuals']> {
  const findAnchor = (id: string): AtlasCitySceneV1['anchors'][number] => {
    const anchor = district.anchors.find((candidate) => candidate.id === id);
    if (!anchor) throw new Error(`Pay Harbor is missing activity anchor ${id}.`);
    return anchor;
  };
  const marketAnchor = findAnchor('lantern-counter');
  const ferryAnchor = findAnchor('ferry-boarding');
  const towerAnchor = findAnchor('celebration-harbor-tower');
  const root = new Group();
  root.name = 'atlas-pay-harbor-activity-state';

  const marketSignal = new Mesh(new SphereGeometry(0.16, 8, 6), new MeshStandardMaterial({ color: ATLAS_WORLD_PALETTE.lanternUnlit, roughness: 0.6 }));
  marketSignal.position.set(marketAnchor.position[0], marketAnchor.position[1] + 1.05, marketAnchor.position[2]);
  const ferryHull = new Mesh(new BoxGeometry(0.9, 0.15, 0.34), new MeshStandardMaterial({ color: ATLAS_WORLD_PALETTE.stationDim, roughness: 0.8 }));
  ferryHull.position.set(ferryAnchor.position[0], ferryAnchor.position[1] + 0.16, ferryAnchor.position[2]);
  const ferryLight = new Mesh(new SphereGeometry(0.1, 8, 6), new MeshBasicMaterial({ color: ATLAS_WORLD_PALETTE.lanternUnlit }));
  ferryLight.position.set(ferryAnchor.position[0], ferryAnchor.position[1] + 0.42, ferryAnchor.position[2]);
  const towerHalo = new Mesh(new TorusGeometry(0.75, 0.045, 6, 18), new MeshBasicMaterial({ color: ATLAS_WORLD_PALETTE.lanternUnlit }));
  towerHalo.position.set(towerAnchor.position[0], towerAnchor.position[1] + 1.18, towerAnchor.position[2]);
  towerHalo.rotation.x = Math.PI * 0.5;
  root.add(marketSignal, ferryHull, ferryLight, towerHalo);
  scene.add(root);
  return { root, marketSignal, ferryHull, ferryLight, towerHalo };
}

interface CitizenAppearance {
  readonly colors: Readonly<Record<string, string>>;
  readonly scale: number;
  readonly profile: AtlasCitizenAppearanceProfile;
}

function citizenAppearance(id: string, role: AtlasCitizenPresentation['role']): CitizenAppearance {
  const profile = atlasCitizenAppearance(id, role);
  return {
    colors: ATLAS_CITIZEN_WARDROBE[profile.wardrobeIndex]!,
    scale: profile.bodyScale,
    profile,
  };
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

function playerAnimationSpeed(player: AtlasCityPlayerState): number {
  if (player.pace === 'walk') return clampNumber(player.speedUnitsPerSecond / 1.35, 0.52, 1.22);
  if (player.pace === 'run') return clampNumber(player.speedUnitsPerSecond / 2.65, 0.86, 1.42);
  return 1;
}

function citizenAnimationSpeed(state: 'idle' | 'walk' | 'run' | 'talk', speedUnitsPerSecond: number): number {
  if (state === 'walk') return clampNumber(speedUnitsPerSecond / 0.62, 0.62, 1.42);
  if (state === 'run') return clampNumber(speedUnitsPerSecond / 1.42, 0.92, 1.45);
  return 1;
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function dampRadians(current: number, target: number, amount: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * clampNumber(amount, 0, 1);
}

function clampDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
}

function clampResolution(value: number): number {
  return Number.isFinite(value) ? Math.min(2, Math.max(0.5, value)) : 1;
}

function aspect(width: number, height: number): number {
  return clampDimension(width) / clampDimension(height);
}
