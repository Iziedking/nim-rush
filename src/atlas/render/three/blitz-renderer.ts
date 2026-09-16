import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DynamicDrawUsage,
  Fog,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  HemisphereLight,
  InstancedMesh,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  PCFShadowMap,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';

import { BLITZ_LINE_GATES, blitzCity, blitzEnabledObstacles, type BlitzCityDefinition, type BlitzPickup } from '../../../../shared/atlas/blitz/cities';
import { blitzRules } from '../../../../shared/atlas/blitz/rules';
import { sampleBlitzRoute } from '../../../../shared/atlas/blitz/core';
import { buildBlitzRoadRibbon } from '../../../../shared/atlas/blitz/road-ribbon';
import type { BlitzCityId, BlitzDifficulty, BlitzRunState } from '../../../../shared/atlas/blitz/types';
import { createBlitzRun } from '../../../../shared/atlas/blitz/core';
import { courseTerrainHeight } from '../../../../shared/atlas/blitz/course';
import { RushBike } from './rush-bike';
import { createRushCourse, updateRushCourse } from './rush-course';

interface CrowdMember {
  readonly distanceMeters: number;
  readonly side: -1 | 1;
  readonly direction: -1 | 1;
  readonly speedMps: number;
  readonly phase: number;
  readonly scale: number;
}

interface FeaturedCitizen {
  readonly root: Group;
  readonly arms: readonly Group[];
  readonly legs: readonly Group[];
  readonly distanceMeters: number;
  readonly side: -1 | 1;
  readonly direction: -1 | 1;
  readonly speedMps: number;
  readonly phase: number;
}

interface CityCrowd {
  readonly city: BlitzCityDefinition;
  readonly members: readonly CrowdMember[];
  readonly torso: InstancedMesh;
  readonly head: InstancedMesh;
  readonly hair: InstancedMesh;
  readonly arms: InstancedMesh;
  readonly legs: InstancedMesh;
  readonly umbrellas: InstancedMesh | null;
  readonly featured: readonly FeaturedCitizen[];
  readonly dummy: Object3D;
}

export class BlitzRenderer {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(58, 1, 0.1, 450);
  private readonly renderer: WebGLRenderer;
  private cityRoot: Group | null = null;
  private bike: RushBike | null = null;
  private crowd: CityCrowd | null = null;
  private activeCity: BlitzCityId | null = null;
  /*
   * Part of the scene's identity, not a detail. The course a rider is shown has
   * to be the course the simulation runs, and the two differ by difficulty, so
   * reusing a rookie scene for a pro run would draw the wrong course.
   */
  private activeDifficulty: BlitzDifficulty = 'rookie';
  /*
   * Every supply still lying on the road, by id.
   *
   * Kept rather than rebuilt because a collected bottle has to disappear the
   * instant the simulation says it was taken - a supply the rider has already
   * banked but can still see is worse than no supply at all.
   */
  private pickupNodes = new Map<string, Group>();
  private reducedMotion = false;
  private cameraReady = false;
  private previousDistance = 0;
  private renderTimestamp = 0;
  private readonly previousBikePosition = new Vector3();
  private readonly cameraTarget = new Vector3();
  private readonly cameraFocus = new Vector3();
  private readonly forward = new Vector3();
  private readonly sun = new DirectionalLight(0xffe9c9, 2.3);

  constructor(canvas: HTMLCanvasElement) {
    // The game is judged on a phone first. MSAA plus a large dynamic shadow
    // map made the primitive-heavy hero scene look acceptable in a desktop
    // screenshot while starving the actual controls on mobile.
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = 'srgb';
  }

  async initialize(reducedMotion: boolean): Promise<void> {
    this.reducedMotion = reducedMotion;
    this.renderer.setClearColor(0x10142c, 1);
    this.scene.add(new AmbientLight(0x8f9ac4, 0.65));
    const sky = new HemisphereLight(0xcfe6ff, 0x19142c, 1.55);
    sky.position.set(0, 30, 0);
    this.scene.add(sky);
    const sun = this.sun;
    sun.position.set(-12, 24, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -9;
    sun.shadow.camera.right = sun.shadow.camera.top = 9;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 70;
    sun.shadow.normalBias = .025; sun.shadow.bias = -.0001;
    this.scene.add(sun, sun.target);
  }

  async loadCity(cityId: BlitzCityId, difficulty: BlitzDifficulty = 'rookie'): Promise<void> {
    if (this.activeCity === cityId && this.activeDifficulty === difficulty && this.cityRoot) return;
    if (this.cityRoot) {
      this.cityRoot.removeFromParent();
      /*
       * This disposes every geometry and material under the old city, and the
       * supply parts are shared across all eighteen of them - so the cache has
       * to be dropped here too, or the next city would attach geometry the GPU
       * has already released.
       */
      disposeTree(this.cityRoot);
      nitroParts = null;
      gearboxParts = null;
    }
    const city = blitzCity(cityId);
    this.scene.background = new Color(city.sky);
    this.scene.fog = new Fog(city.fog, 65, 225);
    this.cityRoot = createCity(city, difficulty);
    this.scene.add(this.cityRoot);
    this.crowd = cityId === 'lagos' ? null : createCityCrowd(city);
    if (this.crowd) {
      this.cityRoot.add(this.crowd.torso, this.crowd.head, this.crowd.hair, this.crowd.arms, this.crowd.legs);
      if (this.crowd.umbrellas) this.cityRoot.add(this.crowd.umbrellas);
      for (const citizen of this.crowd.featured) this.cityRoot.add(citizen.root);
    }
    this.bike = new RushBike();
    this.cityRoot.add(this.bike.root, this.bike.particles, this.bike.shadow);
    /*
     * The line gates, at the exact fractions the simulation scores. They used
     * to stand at 0.24 / 0.51 / 0.77 against a score taken at 0.26 / 0.5 /
     * 0.74, so a rider who threaded the posts in front of them was marked
     * several car-lengths later, on a line they never saw.
     */
    const corridor = Math.min(city.roadWidth * blitzRules(difficulty).lineTolerance, city.roadWidth / 2);
    BLITZ_LINE_GATES.forEach((distance01, index) => {
      const gate = createRelayGate(city, index, corridor);
      const pose = sampleBlitzRoute(city.id, city.lengthMeters * distance01);
      gate.position.set(pose.x, pose.y, pose.z);
      gate.rotation.y = pose.headingRadians;
      this.cityRoot!.add(gate);
    });
    /*
     * Supplies. Added here rather than inside createCity because Lagos builds
     * its own course and returns early, and a bottle that exists in two cities
     * but not the third is exactly the kind of drift that costs a rider fuel
     * they thought they had.
     */
    this.pickupNodes = new Map();
    for (const pickup of city.pickups) {
      const node = createPickup(city, pickup);
      const pose = sampleBlitzRoute(city.id, city.lengthMeters * pickup.distance01, pickup.lane);
      node.position.set(pose.x, pose.y, pose.z);
      node.rotation.y = pose.headingRadians;
      // Kept on the node so culling is a subtraction rather than a lookup.
      node.userData.distance = city.lengthMeters * pickup.distance01;
      node.visible = false;
      this.cityRoot!.add(node);
      this.pickupNodes.set(pickup.id, node);
    }

    this.activeCity = cityId;
    this.activeDifficulty = difficulty;
    this.cameraReady = false;
    this.previousDistance = 0;
  }

  renderPreview(cityId: BlitzCityId): void {
    if (!this.bike || this.activeCity !== cityId) return;
    const city = blitzCity(cityId);
    const state = { ...createBlitzRun({ cityId, seed: 'preview' }), distanceMeters: city.lengthMeters * 0.015 };
    this.present(state, 0);
    this.renderer.render(this.scene, this.camera);
  }

  render(state: BlitzRunState, steer: number, previous: BlitzRunState | null = null, alpha = 1): void {
    if (!this.bike || this.activeCity !== state.cityId) return;
    const blend = MathUtils.clamp(alpha, 0, 1);
    const visibleState = previous && previous.cityId === state.cityId ? {
      ...state,
      distanceMeters: MathUtils.lerp(previous.distanceMeters, state.distanceMeters, blend),
      laneOffset: MathUtils.lerp(previous.laneOffset, state.laneOffset, blend),
      heightMeters: MathUtils.lerp(previous.heightMeters, state.heightMeters, blend),
    } : state;
    this.present(visibleState, steer);
    this.renderer.render(this.scene, this.camera);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    const safeWidth = Math.max(1, Math.round(width));
    const safeHeight = Math.max(1, Math.round(height));
    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
    const maximumPixelRatio = safeWidth < 720 ? 1 : 1.25;
    this.renderer.setPixelRatio(MathUtils.clamp(pixelRatio, 0.75, maximumPixelRatio));
    this.renderer.setSize(safeWidth, safeHeight, false);
  }

  destroy(): void {
    if (this.cityRoot) disposeTree(this.cityRoot);
    this.renderer.dispose();
  }

  debugSnapshot(): object {
    const bikeWorld = this.bike?.root.getWorldPosition(new Vector3()) ?? null;
    const bikeNdc = bikeWorld?.clone().project(this.camera) ?? null;
    return {
      city: this.activeCity,
      cityChildren: this.cityRoot?.children.length ?? 0,
      camera: this.camera.position.toArray(),
      cameraAspect: this.camera.aspect,
      cameraFov: this.camera.fov,
      bikeWorld: bikeWorld?.toArray() ?? null,
      bikeNdc: bikeNdc?.toArray() ?? null,
      contextLost: this.renderer.getContext().isContextLost(),
      render: { ...this.renderer.info.render },
      resources: { ...this.renderer.info.memory },
    };
  }

  private present(state: BlitzRunState, steer: number): void {
    const now = performance.now();
    const dt = this.renderTimestamp ? MathUtils.clamp((now - this.renderTimestamp) / 1000, 0, 1 / 30) : 1 / 60;
    this.renderTimestamp = now;
    const bike = this.bike!;
    const impact = bike.update(state, steer, dt);
    this.sun.position.set(bike.root.position.x - 18, bike.root.position.y + 28, bike.root.position.z + 12);
    this.sun.target.position.copy(bike.root.position);
    const pose = sampleBlitzRoute(state.cityId, state.distanceMeters, state.laneOffset);
    const reset = !this.cameraReady || state.distanceMeters < this.previousDistance;
    this.previousDistance = state.distanceMeters;
    const speed = MathUtils.clamp(state.speedMps / 40, 0, 1);
    const speedLookahead = 3 + speed * 3;
    this.forward.set(Math.sin(pose.headingRadians), 0, Math.cos(pose.headingRadians));
    const behindGround = courseTerrainHeight(state.cityId, Math.max(0, state.distanceMeters - 6.7), state.laneOffset);
    this.cameraTarget.set(pose.x, Math.max(bike.root.position.y + 2.5, behindGround + 2), pose.z).addScaledVector(this.forward, -6.7);
    this.cameraFocus.set(pose.x, bike.root.position.y + 1.05, pose.z).addScaledVector(this.forward, speedLookahead);
    if (reset) {
      this.camera.position.copy(this.cameraTarget);
      this.cameraReady = true;
    } else {
      // Transport the follow rig with the bicycle before damping its offset.
      // Otherwise low FPS increases chase lag and hides the actual speed.
      this.camera.position.add(bike.root.position).sub(this.previousBikePosition);
      this.camera.position.lerp(this.cameraTarget, 1 - Math.exp(-dt * 9));
    }
    this.previousBikePosition.copy(bike.root.position);
    this.camera.lookAt(this.cameraFocus);
    if (!this.reducedMotion) this.camera.rotateZ(-steer * .018 + impact * .015 * Math.sin(state.tick * .9));
    const targetFov = this.reducedMotion ? 60 : 58 + speed * 9 + (state.boostActive ? 3 : 0);
    this.camera.fov = MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-dt * 5));
    this.camera.updateProjectionMatrix();
    /*
     * Always visible. These are scoring gates, and hiding one because an
     * unrelated mission happened to complete removed the only cue a rider had
     * for where their racing line was about to be judged. Mission progress has
     * its own HUD.
     */
    /*
     * A supply spins and bobs so it reads as a thing to take rather than as
     * scenery, and vanishes the tick the simulation banks it.
     */
    for (const [id, node] of this.pickupNodes) {
      /*
       * Only the ones a rider could act on. A city carries eighteen supplies
       * and the fog closes at 225 metres, so drawing all of them spends the
       * draw-call budget on objects nobody can see. Behind the bike they are
       * gone for good; far ahead they are not worth submitting yet.
       */
      const ahead = (node.userData.distance as number) - state.distanceMeters;
      const shown = !state.collectedPickupIds.includes(id) && ahead > -6 && ahead < 150;
      if (node.visible !== shown) node.visible = shown;
      if (!shown || this.reducedMotion) continue;
      const body = node.children[0]!;
      body.rotation.y = state.tick * 0.09;
      body.position.y = 0.78 + Math.sin(state.tick * 0.11) * 0.07;
    }
    if (this.crowd) updateCityCrowd(this.crowd, state.tick);
    if (state.cityId === 'lagos' && this.cityRoot) updateRushCourse(this.cityRoot, state.distanceMeters);
  }
}

function createCity(city: BlitzCityDefinition, difficulty: BlitzDifficulty): Group {
  if (city.id === 'lagos') return createRushCourse(city.id, difficulty);
  const root = new Group();
  root.name = `atlas-blitz-city-${city.id}`;
    const ground = new Mesh(new PlaneGeometry(1200, 1200), new MeshStandardMaterial({ color: city.fog, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  ground.receiveShadow = true;
  root.add(ground);
  createHeroEnvironment(root, city);
  createRoad(root, city);
  createRouteDistricts(root, city);
  createSkyline(root, city);
  createCityLandmarks(root, city);
  createStreetLife(root, city);
  createRoadsideDetails(root, city);
  createHeroDressing(root, city);
  createCourseFeatures(root, city);
  createBeacon(root, city);
  // Only what is solid. Drawing an obstacle the simulation ignores teaches a
  // rider to swerve around nothing, and to mistrust the ones that are real.
  for (const obstacle of blitzEnabledObstacles(city, difficulty)) {
    const pose = sampleBlitzRoute(city.id, city.lengthMeters * obstacle.distance01, obstacle.lane);
    const traffic = createTrafficVehicle(city, obstacle.id);
    traffic.position.set(pose.x, pose.y + 0.26, pose.z);
    traffic.rotation.y = pose.headingRadians;
    root.add(traffic);
  }
  return root;
}

function createRoad(root: Group, city: BlitzCityDefinition): void {
  const roadMaterial = new MeshStandardMaterial({
    color: city.road,
    roughness: city.id === 'london' ? 0.3 : city.id === 'dubai' ? 0.62 : 0.9,
    metalness: city.id === 'london' ? 0.42 : city.id === 'dubai' ? 0.15 : 0.04,
  });
  const shoulderMaterial = new MeshStandardMaterial({ color: city.id === 'dubai' ? 0x62514b : 0x4b4a4f, roughness: 0.98, metalness: 0.02 });
  const edgeMaterial = new MeshBasicMaterial({ color: 0xd6d9d0, transparent: true, opacity: 0.5 });
  const lineMaterial = new MeshBasicMaterial({ color: 0xbac8c3, transparent: true, opacity: 0.52 });
  const shoulder = createRoadRibbon(city, city.roadWidth + 0.9, shoulderMaterial);
  shoulder.position.y = 0.012;
  const edge = createRoadRibbon(city, city.roadWidth + 0.22, edgeMaterial);
  edge.position.y = 0.03;
  const road = createRoadRibbon(city, city.roadWidth, roadMaterial);
  road.position.y = 0.045;
  road.receiveShadow = true;
  root.add(shoulder, edge, road);
  for (let index = 0; index < 52; index += 1) {
    const pose = sampleBlitzRoute(city.id, city.lengthMeters * (index / 52));
    const dash = new Mesh(new BoxGeometry(0.065, 0.018, 0.68), lineMaterial);
    dash.position.set(pose.x, pose.y + 0.082, pose.z);
    dash.rotation.y = pose.headingRadians;
    root.add(dash);
  }
}

function createRoadRibbon(city: BlitzCityDefinition, width: number, material: MeshStandardMaterial | MeshBasicMaterial): Mesh {
  const samples = Array.from({ length: 640 }, (_, i) => sampleBlitzRoute(city.id, city.lengthMeters * i / 640));
  const ribbon = buildBlitzRoadRibbon(samples.map(p => [p.x, p.z] as const), width, samples.map(p => p.y));
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(ribbon.positions, 3));
  geometry.setIndex([...ribbon.indices]);
  geometry.computeVertexNormals();
  return new Mesh(geometry, material);
}

function createRouteDistricts(root: Group, city: BlitzCityDefinition): void {
  const random = seeded(`${city.id}-street`);
  const district = new Group();
  district.name = `atlas-blitz-route-districts-${city.id}`;
  // Leave the segment immediately behind the start line open: a chase camera
  // cuts across that corner before it settles onto the circuit.
  for (let index = 0; index < city.route.length - 1; index += 1) {
    // Lagos is the authored hero run. Keep the market city present at the
    // horizon, but open the immediate sightline so terrain and speed own the
    // frame instead of a wall of repeated cubes.
    if (city.id === 'lagos' && index % 3 !== 0) continue;
    const point = city.route[index]!;
    const next = city.route[(index + 1) % city.route.length]!;
    const centerX = (point[0] + next[0]) / 2;
    const centerZ = (point[1] + next[1]) / 2;
    const radialLength = Math.max(1, Math.hypot(centerX, centerZ));
    const outwardX = centerX / radialLength;
    const outwardZ = centerZ / radialLength;
    const width = 2.4 + random() * 2.1;
    const depth = 2.2 + random() * 1.8;
    const cityBase = city.id === 'dubai' ? 6 : city.id === 'london' ? 3.8 : 1.15;
    const height = cityBase + random() * (city.id === 'dubai' ? 11 : city.id === 'london' ? 5 : 1.9);
    const setback = city.roadWidth / 2 + depth / 2 + (city.id === 'lagos' ? 5.8 : 0.9);
    const featureTone = city.id === 'lagos' ? 0x5d514d : city.id === 'london' ? 0x704052 : 0x8a7043;
    const tone = index % 3 === 0 ? featureTone : city.id === 'london' ? 0x313a55 : city.id === 'dubai' ? 0x334060 : 0x30345d;
    const building = new Mesh(new BoxGeometry(width, height, depth), new MeshStandardMaterial({ color: tone, roughness: city.id === 'dubai' ? 0.38 : 0.82, metalness: city.id === 'dubai' ? 0.28 : 0.03 }));
    const terrainSample = sampleBlitzRoute(city.id, city.lengthMeters * ((index + 0.5) / Math.max(1, city.route.length - 1)));
    building.position.set(centerX + outwardX * setback, (city.id === 'lagos' ? terrainSample.y : 0) + height / 2, centerZ + outwardZ * setback);
    building.rotation.y = Math.atan2(outwardX, outwardZ);
    building.castShadow = true;
    building.receiveShadow = true;
    district.add(building);

    const sign = new Mesh(new BoxGeometry(width * 0.68, 0.16, 0.06), new MeshBasicMaterial({ color: index % 2 === 0 ? city.signal : 0xffd166 }));
    sign.position.set(0, -height / 2 + 1.3, -depth / 2 - 0.035);
    building.add(sign);
    addStreetFrontage(building, width, depth, height, city, index);
    if (city.id === 'lagos') addMarketAwning(building, width, depth, height, city);
    if (city.id === 'london') addLondonLamp(district, centerX, centerZ, outwardX, outwardZ, city);
    if (city.id === 'dubai') addDubaiCrown(building, width, depth, height, city);
  }
  root.add(district);
}

function addStreetFrontage(building: Mesh, width: number, depth: number, height: number, city: BlitzCityDefinition, index: number): void {
  const floors = Math.max(1, Math.min(5, Math.floor((height - 1.4) / 1.35)));
  const windowColor = city.id === 'lagos' && index % 2 === 0 ? city.accent : city.signal;
  const material = new MeshBasicMaterial({ color: windowColor, transparent: true, opacity: city.id === 'london' ? 0.74 : 0.9 });
  for (let floor = 0; floor < floors; floor += 1) {
    for (let column = -1; column <= 1; column += 1) {
      const windows = new Mesh(new BoxGeometry(width * 0.15, 0.13, 0.045), material);
      windows.position.set(column * width * 0.22, -height / 2 + 2.05 + floor * 1.28, -depth / 2 - 0.03);
      building.add(windows);
    }
    const sill = new Mesh(new BoxGeometry(width * 0.74, 0.035, 0.06), new MeshStandardMaterial({ color: city.id === 'london' ? 0x8995a6 : 0x504557, roughness: 0.78 }));
    sill.position.set(0, -height / 2 + 1.83 + floor * 1.28, -depth / 2 - 0.04);
    building.add(sill);
  }
  if (city.id === 'dubai') {
    for (const x of [-width * 0.32, width * 0.32]) {
      const strip = new Mesh(new BoxGeometry(0.055, height * 0.7, 0.05), material);
      strip.position.set(x, 0, -depth / 2 - 0.035);
      building.add(strip);
    }
  }
}

function createCityCrowd(city: BlitzCityDefinition): CityCrowd {
  const count = city.id === 'lagos' ? 26 : city.id === 'london' ? 30 : 24;
  const random = seeded(`${city.id}-crowd`);
  const members: CrowdMember[] = Array.from({ length: count }, (_, index) => ({
    distanceMeters: city.lengthMeters * ((index + 0.35 + random() * 0.3) / count),
    side: index % 2 === 0 ? -1 : 1,
    direction: index % 4 < 2 ? 1 : -1,
    speedMps: index % 4 === 0 ? 0 : 0.42 + random() * 0.68,
    phase: random() * Math.PI * 2,
    scale: 0.6 + random() * 0.12,
  }));
  const torso = new InstancedMesh(new CylinderGeometry(0.2, 0.27, 0.72, 7), new MeshBasicMaterial({ color: 0xffffff }), count);
  const head = new InstancedMesh(new SphereGeometry(0.17, 9, 7), new MeshBasicMaterial({ color: 0xffffff }), count);
  const hair = new InstancedMesh(new CylinderGeometry(0.17, 0.18, 0.09, 9), new MeshBasicMaterial({ color: 0x171322 }), count);
  const arms = new InstancedMesh(new CylinderGeometry(0.045, 0.055, 0.56, 6), new MeshBasicMaterial({ color: 0xffffff }), count * 2);
  const legs = new InstancedMesh(new CylinderGeometry(0.055, 0.065, 0.6, 6), new MeshBasicMaterial({ color: 0x252a42 }), count * 2);
  const umbrellas = city.id === 'london'
    ? new InstancedMesh(new CylinderGeometry(0.06, 0.46, 0.15, 10), new MeshBasicMaterial({ color: 0xffffff }), count)
    : null;
  const meshes = umbrellas ? [torso, head, hair, arms, legs, umbrellas] : [torso, head, hair, arms, legs];
  for (const mesh of meshes) {
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
  }
  torso.name = `atlas-blitz-${city.id}-crowd-torsos`;
  head.name = `atlas-blitz-${city.id}-crowd-heads`;
  hair.name = `atlas-blitz-${city.id}-crowd-hair`;
  arms.name = `atlas-blitz-${city.id}-crowd-arms`;
  legs.name = `atlas-blitz-${city.id}-crowd-legs`;
  if (umbrellas) umbrellas.name = 'atlas-blitz-london-umbrellas';
  const clothes = city.id === 'lagos'
    ? [0xffb020, 0x10e0c1, 0xef3655, 0x6587ff, 0xf7f9ff]
    : city.id === 'london'
      ? [0x43526f, 0xa72f50, 0x66748c, 0xf2eadf, 0x2e9ad1]
      : [0xffffff, 0xe8d4a8, 0x3c4f83, 0xffca63, 0x5cd9ee];
  const skin = [0x3f2418, 0x704631, 0xa76f4f, 0xd1a080, 0xefd0b4];
  for (let index = 0; index < count; index += 1) {
    const clothing = new Color(clothes[index % clothes.length]!);
    torso.setColorAt(index, clothing);
    head.setColorAt(index, new Color(skin[(index * 3) % skin.length]!));
    arms.setColorAt(index * 2, clothing);
    arms.setColorAt(index * 2 + 1, clothing);
    if (umbrellas) umbrellas.setColorAt(index, new Color(index % 3 === 0 ? city.accent : index % 3 === 1 ? city.signal : 0x11162b));
  }
  torso.instanceColor!.needsUpdate = true;
  head.instanceColor!.needsUpdate = true;
  arms.instanceColor!.needsUpdate = true;
  if (umbrellas?.instanceColor) umbrellas.instanceColor.needsUpdate = true;
  const crowd = { city, members, torso, head, hair, arms, legs, umbrellas, featured: createFeaturedCitizens(city), dummy: new Object3D() };
  updateCityCrowd(crowd, 0);
  return crowd;
}

function updateCityCrowd(crowd: CityCrowd, tick: number): void {
  const elapsedSeconds = tick / 30;
  crowd.members.forEach((member, index) => {
    const travelled = member.speedMps * elapsedSeconds * member.direction;
    const distance = (member.distanceMeters + travelled + crowd.city.lengthMeters) % crowd.city.lengthMeters;
    const sidewalk = member.side * (crowd.city.roadWidth / 2 + (crowd.city.id === 'lagos' ? 1.62 : 1.08) + (index % 3) * 0.28);
    const pose = sampleBlitzRoute(crowd.city.id, distance, sidewalk);
    const heading = pose.headingRadians + (member.direction < 0 ? Math.PI : 0);
    const stride = member.speedMps === 0 ? 0 : Math.sin(tick * 0.16 + member.phase) * 0.46;
    const bob = member.speedMps === 0 ? Math.sin(tick * 0.035 + member.phase) * 0.015 : Math.abs(Math.sin(tick * 0.16 + member.phase)) * 0.035;
    setCrowdPart(crowd.torso, index, crowd.dummy, pose.x, pose.z, heading, 0, 1.04 + bob, 0, 0, member.scale);
    setCrowdPart(crowd.head, index, crowd.dummy, pose.x, pose.z, heading, 0, 1.57 + bob, 0, 0, member.scale);
    setCrowdPart(crowd.hair, index, crowd.dummy, pose.x, pose.z, heading, 0, 1.71 + bob, 0.005, 0, member.scale);
    setCrowdPart(crowd.arms, index * 2, crowd.dummy, pose.x, pose.z, heading, -0.285, 1.06 + bob, 0, -stride * 0.72, member.scale);
    setCrowdPart(crowd.arms, index * 2 + 1, crowd.dummy, pose.x, pose.z, heading, 0.285, 1.06 + bob, 0, stride * 0.72, member.scale);
    setCrowdPart(crowd.legs, index * 2, crowd.dummy, pose.x, pose.z, heading, -0.11, 0.43 + bob, 0, stride, member.scale);
    setCrowdPart(crowd.legs, index * 2 + 1, crowd.dummy, pose.x, pose.z, heading, 0.11, 0.43 + bob, 0, -stride, member.scale);
    if (crowd.umbrellas) setCrowdPart(crowd.umbrellas, index, crowd.dummy, pose.x, pose.z, heading, 0, 1.88 + bob, 0, 0, member.scale);
  });
  crowd.torso.instanceMatrix.needsUpdate = true;
  crowd.head.instanceMatrix.needsUpdate = true;
  crowd.hair.instanceMatrix.needsUpdate = true;
  crowd.arms.instanceMatrix.needsUpdate = true;
  crowd.legs.instanceMatrix.needsUpdate = true;
  if (crowd.umbrellas) crowd.umbrellas.instanceMatrix.needsUpdate = true;
  for (const citizen of crowd.featured) {
    const distance = (citizen.distanceMeters + citizen.speedMps * elapsedSeconds * citizen.direction + crowd.city.lengthMeters) % crowd.city.lengthMeters;
    const pose = sampleBlitzRoute(crowd.city.id, distance, citizen.side * (crowd.city.roadWidth / 2 + (crowd.city.id === 'lagos' ? 2.15 : 1.65)));
    citizen.root.position.set(pose.x, 0, pose.z);
    citizen.root.rotation.y = pose.headingRadians + Math.PI;
    const stride = Math.sin(elapsedSeconds * (citizen.speedMps > 0 ? 7.2 : 1.5) + citizen.phase) * (citizen.speedMps > 0 ? 0.32 : 0.035);
    citizen.arms[0]!.rotation.x = stride;
    citizen.arms[1]!.rotation.x = -stride;
    citizen.legs[0]!.rotation.x = -stride * 0.72;
    citizen.legs[1]!.rotation.x = stride * 0.72;
    citizen.root.position.y = Math.max(0, Math.abs(stride) * 0.012);
  }
}

function createFeaturedCitizens(city: BlitzCityDefinition): FeaturedCitizen[] {
  const random = seeded(`${city.id}-featured-citizens`);
  const outfits = city.id === 'lagos'
    ? [0xffa51f, 0x0f9f91, 0xe94b62, 0x4c72b8, 0xf4e7d0, 0x7d4e38]
    : city.id === 'london'
      ? [0x263653, 0xa62d4d, 0x8b99ad, 0xe9dfd0, 0x376b8b, 0x453858]
      : [0xf4ead9, 0xd9ae5f, 0x31527d, 0x2a9c8a, 0xf0c4a4, 0x7e5b8a];
  const skins = [0x3b2119, 0x633b2d, 0x87563f, 0xb77757, 0xd59b78, 0xe6b99a];
  const hairColors = [0x110d12, 0x21161a, 0x3a2119, 0x5b3a2a];
  return Array.from({ length: 6 }, (_, index) => {
    const outfit = new MeshPhysicalMaterial({ color: outfits[index % outfits.length]!, roughness: 0.74, metalness: 0.03, clearcoat: 0.08, clearcoatRoughness: 0.66 });
    const trouser = new MeshPhysicalMaterial({ color: index % 2 === 0 ? 0x202338 : 0x3b3540, roughness: 0.88, metalness: 0.02 });
    const skin = new MeshPhysicalMaterial({ color: skins[(index * 2) % skins.length]!, roughness: 0.72, metalness: 0, clearcoat: 0.04, clearcoatRoughness: 0.75 });
    const hair = new MeshPhysicalMaterial({ color: hairColors[index % hairColors.length]!, roughness: 0.9, metalness: 0 });
    const eye = new MeshBasicMaterial({ color: 0xf7f2e8 });
    const pupil = new MeshBasicMaterial({ color: 0x15111a });
    const mouth = new MeshBasicMaterial({ color: 0x542b32 });
    const root = new Group();
    root.name = `atlas-blitz-${city.id}-featured-citizen-${index + 1}`;
    const torso = new Mesh(new SphereGeometry(0.27, 14, 10), outfit);
    torso.scale.set(0.95, 1.35, 0.68);
    torso.position.set(0, 1.03, 0);
    const chest = new Mesh(new SphereGeometry(0.22, 12, 8), outfit);
    chest.scale.set(1.12, 0.7, 0.72);
    chest.position.set(0, 1.27, 0.03);
    const pelvis = new Mesh(new SphereGeometry(0.23, 12, 8), trouser);
    pelvis.scale.set(1.05, 0.62, 0.72);
    pelvis.position.set(0, 0.78, 0);
    const neck = new Mesh(new CylinderGeometry(0.075, 0.09, 0.16, 10), skin);
    neck.position.set(0, 1.55, 0);
    const head = new Mesh(new SphereGeometry(0.205, 16, 12), skin);
    head.scale.set(0.86, 1.08, 0.84);
    head.position.set(0, 1.76, 0.02);
    const hairCap = new Mesh(new SphereGeometry(0.211, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), hair);
    hairCap.scale.set(0.99, 1.02, 0.98);
    hairCap.position.set(0, 1.83, -0.015);
    const nose = new Mesh(new SphereGeometry(0.032, 8, 6), skin);
    nose.scale.set(0.8, 1.2, 1.25);
    nose.position.set(0, 1.75, 0.198);
    const smile = new Mesh(new BoxGeometry(0.075, 0.018, 0.012), mouth);
    smile.position.set(0, 1.68, 0.196);
    root.add(torso, chest, pelvis, neck, head, hairCap, nose, smile);
    for (const x of [-0.072, 0.072]) {
      const eyeWhite = new Mesh(new SphereGeometry(0.028, 8, 6), eye);
      eyeWhite.scale.set(1, 0.72, 0.42);
      eyeWhite.position.set(x, 1.80, 0.185);
      const pupilDot = new Mesh(new SphereGeometry(0.012, 7, 5), pupil);
      pupilDot.position.set(x, 1.80, 0.207);
      const brow = new Mesh(new BoxGeometry(0.06, 0.012, 0.015), hair);
      brow.position.set(x, 1.855, 0.19);
      brow.rotation.z = x < 0 ? -0.08 : 0.08;
      root.add(eyeWhite, pupilDot, brow);
    }
    for (const x of [-0.205, 0.205]) {
      const ear = new Mesh(new SphereGeometry(0.055, 8, 6), skin);
      ear.scale.set(0.52, 0.9, 0.6);
      ear.position.set(x, 1.76, 0.005);
      root.add(ear);
    }
    const arms = [-1, 1].map((side) => {
      const arm = new Group();
      arm.position.set(side * 0.27, 1.3, 0);
      arm.add(
        limb(new Vector3(0, 0, 0), new Vector3(side * 0.05, -0.31, 0.015), 0.078, outfit),
        limb(new Vector3(side * 0.05, -0.31, 0.015), new Vector3(side * 0.07, -0.6, 0.04), 0.064, skin),
      );
      const hand = new Mesh(new SphereGeometry(0.07, 8, 6), skin);
      hand.position.set(side * 0.07, -0.63, 0.04);
      arm.add(hand);
      root.add(arm);
      return arm;
    });
    const legs = [-1, 1].map((side) => {
      const leg = new Group();
      leg.position.set(side * 0.12, 0.74, 0);
      leg.add(
        limb(new Vector3(0, 0, 0), new Vector3(side * 0.03, -0.36, 0.01), 0.092, trouser),
        limb(new Vector3(side * 0.03, -0.36, 0.01), new Vector3(side * 0.04, -0.68, 0.1), 0.074, trouser),
      );
      const shoe = new Mesh(new SphereGeometry(0.12, 10, 7), new MeshStandardMaterial({ color: 0x11131f, roughness: 0.92 }));
      shoe.scale.set(0.85, 0.55, 1.35);
      shoe.position.set(side * 0.04, -0.73, 0.13);
      leg.add(shoe);
      root.add(leg);
      return leg;
    });
    root.traverse((object) => { if (object instanceof Mesh) object.castShadow = true; });
    root.scale.setScalar(city.id === 'lagos' ? 0.84 : 1);
    return {
      root,
      arms,
      legs,
      distanceMeters: city.lengthMeters * ((index + 0.16 + random() * 0.12) / 6),
      side: index % 2 === 0 ? -1 : 1,
      direction: index % 3 === 0 ? -1 : 1,
      speedMps: 0.22 + random() * 0.5,
      phase: random() * Math.PI * 2,
    };
  });
}

function setCrowdPart(mesh: InstancedMesh, index: number, dummy: Object3D, x: number, z: number, heading: number, offsetX: number, y: number, offsetZ: number, pitch: number, scale: number): void {
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  const rightX = forwardZ;
  const rightZ = -forwardX;
  dummy.position.set(x + rightX * offsetX + forwardX * offsetZ, y * scale, z + rightZ * offsetX + forwardZ * offsetZ);
  dummy.rotation.set(pitch, heading, 0);
  dummy.scale.setScalar(scale);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

function addMarketAwning(building: Mesh, width: number, depth: number, height: number, city: BlitzCityDefinition): void {
  const awning = new Mesh(new BoxGeometry(width * 0.82, 0.08, 0.62), new MeshBasicMaterial({ color: city.signal }));
  awning.position.set(0, -height / 2 + 1.25, -depth / 2 - 0.28);
  awning.rotation.x = -0.14;
  building.add(awning);
}

function addLondonLamp(root: Group, x: number, z: number, outwardX: number, outwardZ: number, city: BlitzCityDefinition): void {
  const lamp = new Group();
  const pole = new Mesh(new CylinderGeometry(0.045, 0.065, 2.5, 7), new MeshStandardMaterial({ color: 0x141925, roughness: 0.72 }));
  pole.position.y = 1.25;
  const glow = new Mesh(new SphereGeometry(0.13, 8, 6), new MeshBasicMaterial({ color: city.signal }));
  glow.position.y = 2.48;
  lamp.position.set(x - outwardX * (city.roadWidth / 2 + 0.45), 0, z - outwardZ * (city.roadWidth / 2 + 0.45));
  lamp.add(pole, glow);
  root.add(lamp);
}

function addDubaiCrown(building: Mesh, width: number, depth: number, height: number, city: BlitzCityDefinition): void {
  const crown = new Mesh(new BoxGeometry(width * 0.88, 0.1, depth * 0.88), new MeshBasicMaterial({ color: city.signal }));
  crown.position.y = height / 2 + 0.06;
  building.add(crown);
}

function createSkyline(root: Group, city: BlitzCityDefinition): void {
  const random = seeded(city.id);
  const skylineCount = city.id === 'lagos' ? 20 : 38;
  for (let index = 0; index < skylineCount; index += 1) {
    const angle = index / 38 * Math.PI * 2 + random() * 0.08;
    // The chase camera cuts the inside of sharp corners. Keep the decorative
    // skyline outside that swept volume so no tower can swallow the camera.
    const radius = city.id === 'lagos' ? 34 + random() * 10 : 27 + random() * 12;
    const width = 2.1 + random() * 3.2;
    const depth = 2 + random() * 3;
    const baseHeight = city.id === 'dubai' ? 7 : city.id === 'london' ? 4.6 : 3.2;
    const height = baseHeight + random() * (city.id === 'dubai' ? 18 : city.id === 'london' ? 8 : 5.2);
    const featureTone = city.id === 'lagos' ? 0x765047 : city.id === 'london' ? 0x663d50 : 0x8a7043;
    const tone = index % 4 === 0 ? featureTone : index % 3 === 0 ? 0x343b65 : 0x252b52;
    const building = new Mesh(new BoxGeometry(width, height, depth), new MeshStandardMaterial({ color: tone, roughness: city.id === 'dubai' ? 0.35 : 0.86, metalness: city.id === 'dubai' ? 0.25 : 0.02 }));
    building.position.set(Math.cos(angle) * radius, height / 2 - 0.02, Math.sin(angle) * radius);
    building.rotation.y = -angle + random() * 0.35;
    building.castShadow = true;
    building.receiveShadow = true;
    root.add(building);
    if (index % 2 === 0) {
      const window = new Mesh(new BoxGeometry(width * 0.68, Math.max(0.12, height * 0.035), 0.035), new MeshBasicMaterial({ color: index % 4 === 0 ? city.signal : 0xffd166 }));
      window.position.set(0, height * 0.14, depth / 2 + 0.02);
      building.add(window);
    }
  }
}

function createRoadsideDetails(root: Group, city: BlitzCityDefinition): void {
  const roadside = new Group();
  roadside.name = `atlas-blitz-roadside-details-${city.id}`;
  const stops = city.id === 'lagos' ? 10 : 8;
  const poleMaterial = new MeshStandardMaterial({ color: city.id === 'london' ? 0x1a2030 : 0x28263a, roughness: 0.72, metalness: 0.18 });
  const glowMaterial = new MeshBasicMaterial({ color: city.signal });
  for (let index = 0; index < stops; index += 1) {
    const distance01 = (index + 0.42) / stops;
    const side = index % 2 === 0 ? -1 : 1;
    const pose = sampleBlitzRoute(city.id, city.lengthMeters * distance01, side * (city.roadWidth / 2 + 2.7));
    const pole = new Group();
    pole.position.set(pose.x, 0, pose.z);
    pole.rotation.y = pose.headingRadians + (side < 0 ? Math.PI : 0);
    const stem = new Mesh(new CylinderGeometry(0.045, 0.075, 2.7, 8), poleMaterial);
    stem.position.y = 1.35;
    const arm = new Mesh(new BoxGeometry(0.48, 0.045, 0.045), poleMaterial);
    arm.position.set(side < 0 ? 0.2 : -0.2, 2.64, 0);
    const lamp = new Mesh(new SphereGeometry(0.095, 8, 6), glowMaterial);
    lamp.position.set(side < 0 ? 0.39 : -0.39, 2.58, 0);
    pole.add(stem, arm, lamp);
    roadside.add(pole);
    if (city.id !== 'london' && index % 2 === 0) {
      const tree = new Group();
      tree.position.set(pose.x + (side < 0 ? -0.65 : 0.65), 0, pose.z);
      const trunk = new Mesh(new CylinderGeometry(0.09, 0.14, city.id === 'dubai' ? 2.2 : 1.7, 8), new MeshStandardMaterial({ color: city.id === 'dubai' ? 0x9c7045 : 0x563d32, roughness: 0.94 }));
      trunk.position.y = city.id === 'dubai' ? 1.1 : 0.85;
      const crown = new Mesh(new SphereGeometry(city.id === 'dubai' ? 0.74 : 0.62, 10, 8), new MeshStandardMaterial({ color: city.id === 'dubai' ? 0x238b6e : 0x2f765e, roughness: 0.9 }));
      crown.scale.set(1, city.id === 'dubai' ? 0.68 : 0.88, 1);
      crown.position.y = city.id === 'dubai' ? 2.35 : 1.72;
      tree.add(trunk, crown);
      roadside.add(tree);
    }
    if (index % 3 === 1) {
      const sign = new Mesh(new BoxGeometry(0.6, 0.32, 0.045), new MeshBasicMaterial({ color: index % 2 === 0 ? city.accent : city.signal }));
      sign.position.set(pose.x + (side < 0 ? -0.28 : 0.28), 1.45, pose.z);
      sign.rotation.y = pose.headingRadians + Math.PI / 2;
      roadside.add(sign);
    }
  }
  root.add(roadside);
}

/**
 * The race line needs a physical envelope. These are deliberately instanced
 * low-poly forms: close enough to sell scale and contact, cheap enough for a
 * mobile WebGL scene. The route remains the hero; dressing exists to make the
 * ground move past the rider instead of leaving a flat toy track in space.
 */
function createHeroDressing(root: Group, city: BlitzCityDefinition): void {
  const dressing = new Group();
  dressing.name = `atlas-blitz-hero-dressing-${city.id}`;
  const random = seeded(`${city.id}-hero-dressing-v1`);
  const dummy = new Object3D();
  const railCount = 34;
  const rockCount = 30;
  const treeCount = city.id === 'dubai' ? 16 : 24;

  const rail = new InstancedMesh(
    new BoxGeometry(0.16, 0.42, 2.2),
    new MeshStandardMaterial({ color: 0x767a80, roughness: 0.93, metalness: 0.08 }),
    railCount,
  );
  const rocks = new InstancedMesh(
    new IcosahedronGeometry(1, 1),
    new MeshStandardMaterial({ color: city.id === 'dubai' ? 0x886c58 : 0x5d514c, roughness: 0.98, metalness: 0 }),
    rockCount,
  );
  const trunks = new InstancedMesh(
    new CylinderGeometry(0.09, 0.16, 1.75, 7),
    new MeshStandardMaterial({ color: city.id === 'dubai' ? 0x9b704c : 0x4c3b31, roughness: 0.98 }),
    treeCount,
  );
  const canopies = new InstancedMesh(
    new SphereGeometry(city.id === 'dubai' ? 0.92 : 0.78, 8, 6),
    new MeshStandardMaterial({ color: city.id === 'dubai' ? 0x317b69 : 0x2e674f, roughness: 0.94 }),
    treeCount,
  );

  for (let index = 0; index < railCount; index += 1) {
    const distance01 = (index + 0.38) / railCount;
    const side = index % 2 === 0 ? -1 : 1;
    const pose = sampleBlitzRoute(city.id, city.lengthMeters * distance01, side * (city.roadWidth / 2 + 0.82));
    dummy.position.set(pose.x, pose.y + 0.25, pose.z);
    dummy.rotation.set(0, pose.headingRadians, 0);
    dummy.scale.set(1, 1, 0.92 + random() * 0.18);
    dummy.updateMatrix();
    rail.setMatrixAt(index, dummy.matrix);
  }

  for (let index = 0; index < rockCount; index += 1) {
    const distance01 = (index + 0.22 + random() * 0.52) / rockCount;
    const side = index % 2 === 0 ? -1 : 1;
    const offset = city.roadWidth / 2 + 1.55 + random() * 3.8;
    const pose = sampleBlitzRoute(city.id, city.lengthMeters * distance01, side * offset);
    dummy.position.set(pose.x, pose.y + 0.18 + random() * 0.18, pose.z);
    dummy.rotation.set(random() * 0.3, random() * Math.PI, random() * 0.3);
    const scale = 0.26 + random() * 0.62;
    dummy.scale.set(scale * (1.2 + random() * 0.5), scale * (0.7 + random() * 0.55), scale);
    dummy.updateMatrix();
    rocks.setMatrixAt(index, dummy.matrix);
  }

  for (let index = 0; index < treeCount; index += 1) {
    const distance01 = (index + 0.5 + random() * 0.25) / treeCount;
    const side = index % 2 === 0 ? -1 : 1;
    const offset = city.roadWidth / 2 + 2.1 + random() * 4.4;
    const pose = sampleBlitzRoute(city.id, city.lengthMeters * distance01, side * offset);
    const trunkHeight = city.id === 'dubai' ? 1.34 : 1.05;
    dummy.position.set(pose.x, pose.y + trunkHeight / 2, pose.z);
    dummy.rotation.set(0, random() * Math.PI, 0);
    dummy.scale.set(0.78 + random() * 0.42, 0.85 + random() * 0.42, 0.78 + random() * 0.42);
    dummy.updateMatrix();
    trunks.setMatrixAt(index, dummy.matrix);
    dummy.position.y += trunkHeight * 0.82;
    dummy.scale.set(0.92 + random() * 0.18, 1.12 + random() * 0.22, 0.92 + random() * 0.18);
    dummy.updateMatrix();
    canopies.setMatrixAt(index, dummy.matrix);
  }

  for (const mesh of [rail, rocks, trunks, canopies]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    dressing.add(mesh);
  }
  root.add(dressing);
}

function createCourseFeatures(root: Group, city: BlitzCityDefinition): void {
  const features = new Group();
  features.name = `atlas-blitz-course-features-${city.id}`;
  for (const feature of city.terrainFeatures) {
    const pose = sampleBlitzRoute(city.id, city.lengthMeters * feature.distance01);
    const material = new MeshStandardMaterial({
      color: feature.kind === 'jump' ? feature.surface === 'wood' ? 0x765544 : 0x7a5943 : 0x6d655e,
      roughness: 0.98,
      metalness: 0,
    });
    const mesh = feature.kind === 'jump'
      ? new Mesh(buildRampGeometry(city.roadWidth * 0.76, 2.8, 0.7), material)
      : new Mesh(new BoxGeometry(city.roadWidth * 0.9, 0.045, 2.4), material);
    mesh.position.set(pose.x, pose.y + 0.06, pose.z);
    mesh.rotation.y = pose.headingRadians;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    features.add(mesh);
  }
  root.add(features);
}

function buildRampGeometry(width: number, length: number, height: number): BufferGeometry {
  const halfWidth = width / 2;
  const halfLength = length / 2;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([
    -halfWidth, 0, -halfLength,
    halfWidth, 0, -halfLength,
    -halfWidth, 0, halfLength,
    halfWidth, 0, halfLength,
    -halfWidth, height, halfLength,
    halfWidth, height, halfLength,
  ], 3));
  geometry.setIndex([0, 1, 3, 0, 3, 2, 0, 2, 4, 1, 5, 3, 2, 3, 5, 2, 5, 4, 0, 4, 5, 0, 5, 1]);
  geometry.computeVertexNormals();
  return geometry;
}

function createCityLandmarks(root: Group, city: BlitzCityDefinition): void {
  const landmark = new Group();
  landmark.name = `atlas-blitz-landmark-${city.id}`;
  if (city.id === 'lagos') {
    const bridge = new Mesh(new BoxGeometry(13, 0.28, 1.1), new MeshStandardMaterial({ color: city.accent, roughness: 0.65 }));
    bridge.position.set(0, 3.2, -16);
    landmark.add(bridge);
    for (const x of [-5.5, 5.5]) {
      const mast = new Mesh(new BoxGeometry(0.32, 6, 0.4), new MeshStandardMaterial({ color: 0xf7f9ff }));
      mast.position.set(x, 2.8, -16);
      landmark.add(mast);
    }
  } else if (city.id === 'london') {
    const tower = new Mesh(new BoxGeometry(3.4, 12, 3.4), new MeshStandardMaterial({ color: 0x735a62, roughness: 0.9 }));
    tower.position.set(-16.5, 6, -7);
    const clock = new Mesh(new CylinderGeometry(1.05, 1.05, 0.12, 24), new MeshBasicMaterial({ color: 0xffd166 }));
    clock.rotation.x = Math.PI / 2;
    clock.position.set(0, 3.8, 1.75);
    tower.add(clock);
    landmark.add(tower);
  } else {
    const needle = new Mesh(new CylinderGeometry(0.35, 2.6, 26, 7), new MeshStandardMaterial({ color: 0xbccaf2, roughness: 0.26, metalness: 0.6 }));
    needle.position.set(16.5, 13, -6);
    landmark.add(needle);
    const crown = new Mesh(new SphereGeometry(0.6, 8, 6), new MeshBasicMaterial({ color: city.accent }));
    crown.position.set(16.5, 26, -6);
    landmark.add(crown);
  }
  root.add(landmark);
}

function createStreetLife(root: Group, city: BlitzCityDefinition): void {
  const street = new Group();
  street.name = `atlas-blitz-street-life-${city.id}`;
  const stops = city.id === 'lagos' ? [0.14, 0.34, 0.58, 0.82] : [0.18, 0.36, 0.58, 0.76];
  stops.forEach((distance01, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const pose = sampleBlitzRoute(city.id, city.lengthMeters * distance01, side * (city.roadWidth / 2 + 2));
    const prop = city.id === 'lagos'
      ? createLagosMarketStall(city, index)
      : city.id === 'london'
        ? createLondonKiosk(city, index)
        : createDubaiPalm(city, index);
    prop.position.set(pose.x, 0, pose.z);
    prop.rotation.y = pose.headingRadians + (side < 0 ? Math.PI : 0);
    street.add(prop);

    const reflection = new Mesh(
      new BoxGeometry(city.id === 'london' ? 0.24 : 0.15, 0.012, city.id === 'dubai' ? 2.8 : 1.9),
      new MeshBasicMaterial({ color: index % 2 === 0 ? city.accent : city.signal, transparent: true, opacity: city.id === 'london' ? 0.38 : city.id === 'lagos' ? 0.08 : 0.16 }),
    );
    const roadPose = sampleBlitzRoute(city.id, city.lengthMeters * distance01, side * city.roadWidth * 0.24);
    reflection.position.set(roadPose.x, 0.092, roadPose.z);
    reflection.rotation.y = roadPose.headingRadians;
    street.add(reflection);
  });
  root.add(street);
}

/**
 * The hero course gets a readable physical setting before decorative city
 * dressing is added. Lagos is deliberately an open waterfront climb/drop:
 * the road rises above a dark lagoon edge, then returns through a sparse
 * market embankment. It gives the camera a foreground, midground and horizon
 * instead of the flat-box silhouette that made the first pass feel toy-like.
 */
function createHeroEnvironment(root: Group, city: BlitzCityDefinition): void {
  if (city.id !== 'lagos') return;

  const earth = new MeshStandardMaterial({ color: 0x675a52, roughness: 1, metalness: 0 });
  const embankment = createRoadRibbon(city, city.roadWidth + 9.5, earth);
  embankment.position.y = -0.14;
  embankment.receiveShadow = true;
  root.add(embankment);

  const outerShoulder = createRoadRibbon(city, city.roadWidth + 2.2, new MeshStandardMaterial({ color: 0x4f4a49, roughness: 0.98 }));
  outerShoulder.position.y = -0.015;
  outerShoulder.receiveShadow = true;
  root.add(outerShoulder);

  const outlook = new Group();
  outlook.name = 'atlas-blitz-lagos-waterfront-outlook';
  const pose = sampleBlitzRoute(city.id, city.lengthMeters * 0.46);
  const forward = new Vector3(Math.sin(pose.headingRadians), 0, Math.cos(pose.headingRadians));
  const right = new Vector3(forward.z, 0, -forward.x);
  const water = new Mesh(
    new PlaneGeometry(18, 6),
    new MeshPhysicalMaterial({ color: 0x315b67, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.82 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.rotation.y = pose.headingRadians;
  water.position.copy(new Vector3(pose.x, pose.y - 0.32, pose.z)).addScaledVector(right, 8.2).addScaledVector(forward, 1.5);
  water.receiveShadow = true;
  outlook.add(water);

  const retainingWall = new Mesh(
    new BoxGeometry(14, 0.5, 0.32),
    new MeshStandardMaterial({ color: 0x9b9080, roughness: 0.92 }),
  );
  retainingWall.rotation.y = pose.headingRadians;
  retainingWall.position.copy(new Vector3(pose.x, pose.y + 0.1, pose.z)).addScaledVector(right, 4.9);
  outlook.add(retainingWall);
  for (let index = 0; index < 7; index += 1) {
    const post = new Mesh(new CylinderGeometry(0.06, 0.08, 1.2, 7), new MeshStandardMaterial({ color: 0x4a4f52, roughness: 0.9 }));
    post.position.copy(retainingWall.position).addScaledVector(forward, -5.8 + index * 1.9);
    post.position.y += 0.58;
    outlook.add(post);
  }
  root.add(outlook);
}

function createLagosMarketStall(city: BlitzCityDefinition, index: number): Group {
  const stall = new Group();
  const counter = new Mesh(new BoxGeometry(1.15, 0.62, 0.58), new MeshStandardMaterial({ color: index % 2 === 0 ? 0xf0b323 : 0x2c775d, roughness: 0.82 }));
  counter.position.y = 0.31;
  const canopy = new Mesh(new BoxGeometry(1.55, 0.09, 1.05), new MeshBasicMaterial({ color: index % 3 === 0 ? 0xff4d6d : index % 3 === 1 ? city.signal : city.accent }));
  canopy.position.y = 1.78;
  for (const x of [-0.62, 0.62]) {
    const pole = new Mesh(new CylinderGeometry(0.025, 0.035, 1.72, 6), new MeshStandardMaterial({ color: 0x40352f, roughness: 0.95 }));
    pole.position.set(x, 0.86, 0);
    stall.add(pole);
  }
  for (const x of [-0.36, 0, 0.36]) {
    const goods = new Mesh(new SphereGeometry(0.105, 7, 5), new MeshBasicMaterial({ color: x === 0 ? 0xffd166 : 0xef3655 }));
    goods.position.set(x, 0.7, -0.25);
    stall.add(goods);
  }
  const light = new Mesh(new SphereGeometry(0.08, 7, 5), new MeshBasicMaterial({ color: 0xffe5a6 }));
  light.position.set(0, 1.63, 0);
  stall.add(counter, canopy, light);
  return stall;
}

function createLondonKiosk(city: BlitzCityDefinition, index: number): Group {
  const kiosk = new Group();
  const shell = new Mesh(new BoxGeometry(0.72, 1.95, 0.72), new MeshStandardMaterial({ color: 0xc62343, roughness: 0.58, metalness: 0.08 }));
  shell.position.y = 0.98;
  const glass = new Mesh(new BoxGeometry(0.44, 1.1, 0.025), new MeshBasicMaterial({ color: index % 2 === 0 ? city.signal : 0xd9f2ff, transparent: true, opacity: 0.76 }));
  glass.position.set(0, 1.05, -0.375);
  const cap = new Mesh(new BoxGeometry(0.82, 0.14, 0.82), new MeshBasicMaterial({ color: 0xf03a55 }));
  cap.position.y = 2;
  kiosk.add(shell, glass, cap);
  return kiosk;
}

function createDubaiPalm(city: BlitzCityDefinition, index: number): Group {
  const palm = new Group();
  const trunk = new Mesh(new CylinderGeometry(0.1, 0.17, 2.65, 7), new MeshStandardMaterial({ color: 0xa67a4b, roughness: 0.92 }));
  trunk.position.y = 1.32;
  palm.add(trunk);
  for (let leafIndex = 0; leafIndex < 5; leafIndex += 1) {
    const leaf = new Mesh(new BoxGeometry(0.12, 0.055, 1.08), new MeshBasicMaterial({ color: leafIndex % 2 === 0 ? 0x2fa982 : 0x49c797 }));
    leaf.position.y = 2.68;
    leaf.rotation.y = leafIndex / 5 * Math.PI * 2 + index * 0.18;
    leaf.rotation.x = -0.3;
    leaf.translateZ(0.4);
    palm.add(leaf);
  }
  const uplight = new Mesh(new CylinderGeometry(0.16, 0.22, 0.05, 8), new MeshBasicMaterial({ color: city.accent }));
  uplight.position.y = 0.025;
  palm.add(uplight);
  return palm;
}

function createBeacon(root: Group, city: BlitzCityDefinition): void {
  const beacon = new Group();
  beacon.position.set(0, 0, 0);
  const mast = new Mesh(new CylinderGeometry(0.35, 0.72, 8, 8), new MeshStandardMaterial({ color: 0xf7f9ff, roughness: 0.55 }));
  mast.position.y = 4;
  const rings = [2.2, 4.2, 6.2].map((height, index) => {
    const ring = new Mesh(new TorusGeometry(1.2 + index * 0.25, 0.08, 8, 24), new MeshBasicMaterial({ color: index === 2 ? city.signal : city.accent }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = height;
    return ring;
  });
  const light = new PointLight(city.signal, 18, 22, 2);
  light.position.y = 7.6;
  const orb = new Mesh(new SphereGeometry(0.42, 12, 8), new MeshBasicMaterial({ color: city.signal }));
  orb.position.y = 7.6;
  beacon.add(mast, ...rings, light, orb);
  root.add(beacon);
}

function createTrafficVehicle(city: BlitzCityDefinition, id: string): Group {
  const root = new Group();
  root.name = `atlas-blitz-traffic-${id}`;
  if (id.includes('barrier') || id.includes('crate')) return createRoadHazard(city, id);
  const isBus = id.includes('bus');
  const isKeke = id.includes('keke');
  const isLondonCab = city.id === 'london' && id.includes('cab');
  const bodyColor = isBus ? (city.id === 'london' ? 0xd2263f : 0xffc627) : isKeke ? 0xffc627 : isLondonCab ? 0x12141c : city.id === 'dubai' ? 0xe9edf6 : 0x334a72;
  const width = isBus ? 1.3 : isKeke ? 0.88 : 0.98;
  const height = isBus && city.id === 'london' ? 1.55 : isKeke ? 0.82 : 0.65;
  const depth = isBus ? 2.45 : isKeke ? 1.38 : 1.68;
  const body = new Mesh(new BoxGeometry(width, height, depth), new MeshStandardMaterial({ color: bodyColor, roughness: isLondonCab ? 0.28 : 0.58, metalness: isLondonCab ? 0.35 : 0.12 }));
  body.castShadow = true;
  const glassHeight = isBus && city.id === 'london' ? 0.9 : 0.36;
  const glass = new Mesh(new BoxGeometry(width * 0.82, glassHeight, depth * 0.48), new MeshStandardMaterial({ color: 0x8ed8ef, roughness: 0.16, metalness: 0.44 }));
  glass.position.set(0, height * 0.55, -0.08);
  root.add(body, glass);
  if (isKeke) {
    const roof = new Mesh(new BoxGeometry(1, 0.08, 1.28), new MeshBasicMaterial({ color: 0x1d623e }));
    roof.position.y = 0.88;
    root.add(roof);
  }
  if (isBus && city.id === 'lagos') {
    const stripe = new Mesh(new BoxGeometry(width + 0.025, 0.12, depth * 0.82), new MeshBasicMaterial({ color: 0x2f7f50 }));
    stripe.position.y = 0.05;
    root.add(stripe);
  }
  for (const x of [-width * 0.51, width * 0.51]) for (const z of [-0.55, 0.55]) {
    const wheel = new Mesh(new CylinderGeometry(0.22, 0.22, 0.14, 12), new MeshStandardMaterial({ color: 0x090b18, roughness: 0.9 }));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, -height * 0.34, z * (isBus ? 1.55 : isKeke ? 0.82 : 1));
    root.add(wheel);
  }
  for (const x of [-width * 0.3, width * 0.3]) {
    const lamp = new Mesh(new SphereGeometry(0.075, 7, 5), new MeshBasicMaterial({ color: 0xfff0bd }));
    lamp.position.set(x, 0, depth / 2 + 0.01);
    root.add(lamp);
  }
  return root;
}

function createRoadHazard(city: BlitzCityDefinition, id: string): Group {
  const hazard = new Group();
  hazard.name = `atlas-blitz-hazard-${id}`;
  if (id.includes('crate')) {
    for (const [x, y] of [[-0.3, 0.28], [0.3, 0.28], [0, 0.8]] as const) {
      const crate = new Mesh(new BoxGeometry(0.55, 0.55, 0.55), new MeshStandardMaterial({ color: 0x9c6235, roughness: 0.96 }));
      crate.position.set(x, y, 0);
      hazard.add(crate);
    }
    return hazard;
  }
  const bar = new Mesh(new BoxGeometry(1.75, 0.32, 0.24), new MeshBasicMaterial({ color: city.accent }));
  bar.position.y = 0.72;
  hazard.add(bar);
  for (const x of [-0.68, 0.68]) {
    const leg = new Mesh(new BoxGeometry(0.14, 1.25, 0.14), new MeshStandardMaterial({ color: 0xe5e8ef, roughness: 0.8 }));
    leg.position.set(x, 0.46, 0);
    hazard.add(leg);
  }
  return hazard;
}

/*
 * A line gate.
 *
 * Two posts said "something happens here" without saying what. The scored
 * condition is staying inside a corridor, so the gate now draws that corridor:
 * a lit bar across the road at the width actually being judged, with the posts
 * standing at its edges rather than off in the scenery.
 */
function createRelayGate(city: BlitzCityDefinition, index: number, corridorHalfWidth: number): Group {
  const gate = new Group();
  gate.name = `nim-rush-course-marker-${index}`;
  const pole = new MeshStandardMaterial({ color: 0x454a40, roughness: .9 });
  const flag = new MeshStandardMaterial({ color: city.accent, roughness: .85, side: 2 });
  const lit = new MeshBasicMaterial({ color: city.signal, transparent: true, opacity: .62 });
  for (const side of [-1, 1]) {
    const upright = new Mesh(new CylinderGeometry(.025, .025, 2.6, 6), pole);
    upright.position.set(side * (city.roadWidth / 2 + .5), 1.3, 0);
    const cloth = new Mesh(new PlaneGeometry(.4, 1.5), flag);
    cloth.position.set(side * (city.roadWidth / 2 + .72), 1.7, 0);
    cloth.rotation.y = side * .3;
    // The edge of the scored corridor, marked on the road itself: a rider
    // reading the line does not have to look up to find it.
    const edge = new Mesh(new BoxGeometry(.16, .02, 2.2), lit);
    edge.position.set(side * corridorHalfWidth, .03, 0);
    const marker = new Mesh(new CylinderGeometry(.045, .045, 1.5, 6), lit);
    marker.position.set(side * corridorHalfWidth, .75, 0);
    gate.add(upright, cloth, edge, marker);
  }
  // One bar overhead spanning the corridor, so the gate reads from a distance.
  const span = new Mesh(new BoxGeometry(corridorHalfWidth * 2, .1, .12), lit);
  span.position.y = 2.35;
  gate.add(span);
  return gate;
}

/*
 * A supply on the road.
 *
 * Two silhouettes a rider can tell apart in peripheral vision at 100 km/h,
 * which is the only test that matters here: a bottle stands upright and tall,
 * a gear sits flat and wide. Both hover over a ring painted on the road, so
 * the lane a rider has to be in is readable before the object itself is.
 */
/*
 * One set of geometries and materials for every supply of a kind.
 *
 * Eighteen bottles that each built their own cylinder would be eighteen
 * uploads of the same vertices, and eighteen materials the renderer has to
 * switch between. Built once, lazily, and shared.
 */
const PICKUP_PARTS: Record<'nitro' | 'gearbox', ReturnType<typeof buildPickupParts>> = {
  get nitro() { return (nitroParts ??= buildPickupParts('nitro')); },
  get gearbox() { return (gearboxParts ??= buildPickupParts('gearbox')); },
};
let nitroParts: ReturnType<typeof buildPickupParts> | null = null;
let gearboxParts: ReturnType<typeof buildPickupParts> | null = null;

function buildPickupParts(kind: 'nitro' | 'gearbox') {
  const glow = kind === 'nitro' ? 0x5fe3ff : 0xffc247;
  return {
    primary: kind === 'nitro'
      ? new CylinderGeometry(0.12, 0.21, 0.68, 10)
      : new CylinderGeometry(0.28, 0.28, 0.12, 14).rotateX(Math.PI / 2),
    accent: kind === 'nitro'
      ? new CylinderGeometry(0.085, 0.085, 0.09, 7)
      : new TorusGeometry(0.31, 0.075, 4, 8),
    trim: kind === 'nitro' ? new TorusGeometry(0.195, 0.038, 5, 12) : new TorusGeometry(0.11, 0.042, 5, 10),
    shell: new MeshStandardMaterial({
      color: kind === 'nitro' ? 0x1d4f63 : 0x4a4436,
      roughness: kind === 'nitro' ? 0.34 : 0.42,
      metalness: kind === 'nitro' ? 0.5 : 0.72,
      emissive: new Color(glow),
      emissiveIntensity: kind === 'nitro' ? 0.32 : 0.22,
    }),
    lit: new MeshBasicMaterial({ color: glow }),
    halo: new RingGeometry(0.34, 0.5, 14),
    haloMaterial: new MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.4, side: 2 }),
  };
}

function createPickup(city: BlitzCityDefinition, pickup: BlitzPickup): Group {
  const root = new Group();
  root.name = `nim-rush-pickup-${pickup.id}`;
  const body = new Group();
  body.position.y = 0.78;
  root.add(body);

  const parts = PICKUP_PARTS[pickup.kind];
  if (pickup.kind === 'nitro') {
    /*
     * A bottle: tapered from a wide base to a narrow neck, with a cap on top.
     * The taper is what stops it reading as a barrel, and a barrel reads as
     * something to swerve around rather than something to collect.
     */
    const tank = new Mesh(parts.primary, parts.shell);
    const cap = new Mesh(parts.accent, parts.lit);
    cap.position.y = 0.4;
    // One lit band, low on the tank: the part that catches the eye first.
    const band = new Mesh(parts.trim, parts.lit);
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.04;
    body.add(tank, cap, band);
  } else {
    /*
     * A gear, flat on. The teeth are an eight-sided ring rather than eight
     * separate boxes: at the size a rider sees this, the silhouette is
     * identical and it costs one draw call instead of nine.
     */
    const disc = new Mesh(parts.primary, parts.shell);
    const teeth = new Mesh(parts.accent, parts.shell);
    const hub = new Mesh(parts.trim, parts.lit);
    body.add(disc, teeth, hub);
  }

  // The road marking. A rider reading the surface still sees which lane.
  const halo = new Mesh(parts.halo, parts.haloMaterial);
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.035;
  root.add(halo);
  void city;
  return root;
}

function seeded(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) state = Math.imul(state ^ seed.charCodeAt(index), 16777619);
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

function disposeTree(root: Object3D): void {
  const disposedTextures = new Set<Texture>();
  root.traverse((object) => {
    if (!(object instanceof Mesh) && !(object instanceof Points)) return;
    (object.geometry as BufferGeometry).dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof Texture && !disposedTextures.has(value)) {
        disposedTextures.add(value); value.dispose();
      }
      material.dispose();
    }
  });
}

function limb(start: Vector3, end: Vector3, radius: number, material: MeshStandardMaterial): Mesh {
  const direction = end.clone().sub(start);
  const mesh = new Mesh(new CylinderGeometry(radius, radius * 1.04, direction.length(), 8), material);
  mesh.position.copy(start).add(end).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
  return mesh;
}
