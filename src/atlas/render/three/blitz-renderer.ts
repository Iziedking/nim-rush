import {
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
  HemisphereLight,
  InstancedMesh,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';

import { blitzCity, type BlitzCityDefinition } from '../../../../shared/atlas/blitz/cities';
import { sampleBlitzRoute } from '../../../../shared/atlas/blitz/core';
import { buildBlitzRoadRibbon } from '../../../../shared/atlas/blitz/road-ribbon';
import type { BlitzCityId, BlitzRunState } from '../../../../shared/atlas/blitz/types';

interface BikeRig {
  readonly root: Group;
  readonly body: Group;
  readonly wheels: readonly Mesh[];
  readonly trail: readonly Mesh[];
  readonly headlight: PointLight;
}

interface CrowdMember {
  readonly distanceMeters: number;
  readonly side: -1 | 1;
  readonly direction: -1 | 1;
  readonly speedMps: number;
  readonly phase: number;
  readonly scale: number;
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
  readonly dummy: Object3D;
}

export class BlitzRenderer {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(58, 1, 0.1, 140);
  private readonly renderer: WebGLRenderer;
  private cityRoot: Group | null = null;
  private bike: BikeRig | null = null;
  private relayGates: Group[] = [];
  private crowd: CityCrowd | null = null;
  private activeCity: BlitzCityId | null = null;
  private reducedMotion = false;
  private cameraReady = false;
  private previousDistance = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputColorSpace = 'srgb';
  }

  async initialize(reducedMotion: boolean): Promise<void> {
    this.reducedMotion = reducedMotion;
    this.renderer.setClearColor(0x10142c, 1);
    this.scene.add(new AmbientLight(0x8f9ac4, 0.65));
    const sky = new HemisphereLight(0xcfe6ff, 0x19142c, 1.55);
    sky.position.set(0, 30, 0);
    this.scene.add(sky);
    const sun = new DirectionalLight(0xffe1b6, 2.2);
    sun.position.set(-12, 24, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    this.scene.add(sun);
  }

  async loadCity(cityId: BlitzCityId): Promise<void> {
    if (this.activeCity === cityId && this.cityRoot) return;
    if (this.cityRoot) {
      this.cityRoot.removeFromParent();
      disposeTree(this.cityRoot);
    }
    const city = blitzCity(cityId);
    this.scene.background = new Color(city.sky);
    this.scene.fog = new Fog(city.fog, 24, 68);
    this.cityRoot = createCity(city);
    this.scene.add(this.cityRoot);
    this.crowd = createCityCrowd(city);
    this.cityRoot.add(this.crowd.torso, this.crowd.head, this.crowd.hair, this.crowd.arms, this.crowd.legs);
    if (this.crowd.umbrellas) this.cityRoot.add(this.crowd.umbrellas);
    this.bike = createBikeAndRider(city);
    this.cityRoot.add(this.bike.root);
    this.relayGates = [0.24, 0.51, 0.77].map((distance01, index) => {
      const gate = createRelayGate(city, index);
      const pose = sampleBlitzRoute(city.id, city.lengthMeters * distance01);
      gate.position.set(pose.x, 0, pose.z);
      gate.rotation.y = pose.headingRadians;
      this.cityRoot!.add(gate);
      return gate;
    });
    this.activeCity = cityId;
    this.cameraReady = false;
    this.previousDistance = 0;
  }

  renderPreview(cityId: BlitzCityId): void {
    if (!this.bike || this.activeCity !== cityId) return;
    const city = blitzCity(cityId);
    const state = { cityId, tick: 0, distanceMeters: city.lengthMeters * 0.08, laneOffset: 0, speedMps: 0, driftActive: false, boostActive: false, missions: [] } as unknown as BlitzRunState;
    this.present(state, 0);
    this.renderer.render(this.scene, this.camera);
  }

  render(state: BlitzRunState, steer: number): void {
    if (!this.bike || this.activeCity !== state.cityId) return;
    this.present(state, steer);
    this.renderer.render(this.scene, this.camera);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    const safeWidth = Math.max(1, Math.round(width));
    const safeHeight = Math.max(1, Math.round(height));
    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
    const maximumPixelRatio = safeWidth < 720 ? 1.25 : 1.6;
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
    };
  }

  private present(state: BlitzRunState, steer: number): void {
    const bike = this.bike!;
    const pose = sampleBlitzRoute(state.cityId, state.distanceMeters, state.laneOffset);
    bike.root.position.set(pose.x, 0.36, pose.z);
    bike.root.rotation.y = pose.headingRadians;
    const targetLean = this.reducedMotion ? 0 : MathUtils.clamp(-steer * (state.driftActive ? 0.38 : 0.2) - pose.bend * 0.035, -0.46, 0.46);
    bike.body.rotation.z = MathUtils.lerp(bike.body.rotation.z, targetLean, 0.18);
    const travelled = Math.max(0, state.distanceMeters - this.previousDistance);
    this.previousDistance = state.distanceMeters;
    for (const wheel of bike.wheels) wheel.rotation.x -= travelled / 0.34;
    for (const trail of bike.trail) {
      trail.visible = state.boostActive;
      trail.scale.z = state.boostActive ? 1 + Math.sin(state.tick * 0.7) * 0.22 : 0.1;
    }
    bike.headlight.intensity = state.boostActive ? 9 : 5;
    this.relayGates.forEach((gate, index) => {
      const mission = state.missions[index];
      gate.visible = !mission?.resolved;
      const pulse = this.reducedMotion ? 1 : 1 + Math.sin(state.tick * 0.12 + index) * 0.05;
      gate.scale.setScalar(pulse);
    });
    if (this.crowd) updateCityCrowd(this.crowd, state.tick);

    const forward = new Vector3(Math.sin(pose.headingRadians), 0, Math.cos(pose.headingRadians));
    const right = new Vector3(forward.z, 0, -forward.x);
    const portrait = this.camera.aspect < 0.8;
    const focus = new Vector3(pose.x, portrait ? 1.9 : 1.18, pose.z).addScaledVector(forward, portrait ? 1.9 : 2.1);
    const desired = new Vector3(pose.x, portrait ? 3.4 : 3.5, pose.z)
      .addScaledVector(forward, portrait ? -7.2 : -7.8)
      .addScaledVector(right, this.reducedMotion ? 0 : -pose.bend * 0.16);
    if (!this.cameraReady) {
      this.camera.position.copy(desired);
      this.cameraReady = true;
    } else {
      this.camera.position.lerp(desired, this.reducedMotion ? 0.22 : state.boostActive ? 0.13 : 0.17);
    }
    this.camera.lookAt(focus);
    const desiredFov = this.reducedMotion ? 58 : state.boostActive ? 64 : 58 + Math.min(3, state.speedMps / 14);
    this.camera.fov = MathUtils.lerp(this.camera.fov, desiredFov, 0.12);
    this.camera.updateProjectionMatrix();
  }
}

function createCity(city: BlitzCityDefinition): Group {
  const root = new Group();
  root.name = `atlas-blitz-city-${city.id}`;
  const ground = new Mesh(new PlaneGeometry(86, 86), new MeshStandardMaterial({ color: city.fog, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  ground.receiveShadow = true;
  root.add(ground);
  createRoad(root, city);
  createRouteDistricts(root, city);
  createSkyline(root, city);
  createCityLandmarks(root, city);
  createStreetLife(root, city);
  createBeacon(root, city);
  for (const obstacle of city.obstacles) {
    const pose = sampleBlitzRoute(city.id, city.lengthMeters * obstacle.distance01, obstacle.lane);
    const traffic = createTrafficVehicle(city, obstacle.id);
    traffic.position.set(pose.x, 0.26, pose.z);
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
  const edgeMaterial = new MeshBasicMaterial({ color: city.accent });
  const lineMaterial = new MeshBasicMaterial({ color: 0xf7f9ff, transparent: true, opacity: 0.72 });
  const edge = createRoadRibbon(city, city.roadWidth + 0.34, edgeMaterial);
  edge.position.y = 0.015;
  const road = createRoadRibbon(city, city.roadWidth, roadMaterial);
  road.position.y = 0.045;
  road.receiveShadow = true;
  root.add(edge, road);
  for (let index = 0; index < 52; index += 1) {
    const pose = sampleBlitzRoute(city.id, city.lengthMeters * (index / 52));
    const dash = new Mesh(new BoxGeometry(0.09, 0.025, 0.78), lineMaterial);
    dash.position.set(pose.x, 0.085, pose.z);
    dash.rotation.y = pose.headingRadians;
    root.add(dash);
  }
}

function createRoadRibbon(city: BlitzCityDefinition, width: number, material: MeshStandardMaterial | MeshBasicMaterial): Mesh {
  const ribbon = buildBlitzRoadRibbon(city.route, width);
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
    const point = city.route[index]!;
    const next = city.route[(index + 1) % city.route.length]!;
    const centerX = (point[0] + next[0]) / 2;
    const centerZ = (point[1] + next[1]) / 2;
    const radialLength = Math.max(1, Math.hypot(centerX, centerZ));
    const outwardX = centerX / radialLength;
    const outwardZ = centerZ / radialLength;
    const width = 2.4 + random() * 2.1;
    const depth = 2.2 + random() * 1.8;
    const cityBase = city.id === 'dubai' ? 6 : city.id === 'london' ? 3.8 : 2.8;
    const height = cityBase + random() * (city.id === 'dubai' ? 11 : city.id === 'london' ? 5 : 4.2);
    const setback = city.roadWidth / 2 + depth / 2 + 0.9;
    const featureTone = city.id === 'lagos' ? 0x624653 : city.id === 'london' ? 0x704052 : 0x8a7043;
    const tone = index % 3 === 0 ? featureTone : city.id === 'london' ? 0x313a55 : city.id === 'dubai' ? 0x334060 : 0x30345d;
    const building = new Mesh(new BoxGeometry(width, height, depth), new MeshStandardMaterial({ color: tone, roughness: city.id === 'dubai' ? 0.38 : 0.82, metalness: city.id === 'dubai' ? 0.28 : 0.03 }));
    building.position.set(centerX + outwardX * setback, height / 2, centerZ + outwardZ * setback);
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
    const windows = new Mesh(new BoxGeometry(width * 0.62, 0.11, 0.045), material);
    windows.position.set(0, -height / 2 + 2.05 + floor * 1.28, -depth / 2 - 0.03);
    building.add(windows);
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
  const count = city.id === 'lagos' ? 38 : city.id === 'london' ? 30 : 24;
  const random = seeded(`${city.id}-crowd`);
  const members: CrowdMember[] = Array.from({ length: count }, (_, index) => ({
    distanceMeters: city.lengthMeters * ((index + 0.35 + random() * 0.3) / count),
    side: index % 2 === 0 ? -1 : 1,
    direction: index % 4 < 2 ? 1 : -1,
    speedMps: index % 4 === 0 ? 0 : 0.42 + random() * 0.68,
    phase: random() * Math.PI * 2,
    scale: 0.96 + random() * 0.16,
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
  const crowd = { city, members, torso, head, hair, arms, legs, umbrellas, dummy: new Object3D() };
  updateCityCrowd(crowd, 0);
  return crowd;
}

function updateCityCrowd(crowd: CityCrowd, tick: number): void {
  const elapsedSeconds = tick / 30;
  crowd.members.forEach((member, index) => {
    const travelled = member.speedMps * elapsedSeconds * member.direction;
    const distance = (member.distanceMeters + travelled + crowd.city.lengthMeters) % crowd.city.lengthMeters;
    const sidewalk = member.side * (crowd.city.roadWidth / 2 + 0.58 + (index % 3) * 0.18);
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
  for (let index = 0; index < 38; index += 1) {
    const angle = index / 38 * Math.PI * 2 + random() * 0.08;
    // The chase camera cuts the inside of sharp corners. Keep the decorative
    // skyline outside that swept volume so no tower can swallow the camera.
    const radius = 27 + random() * 12;
    const width = 2.1 + random() * 3.2;
    const depth = 2 + random() * 3;
    const baseHeight = city.id === 'dubai' ? 7 : city.id === 'london' ? 4.6 : 5.2;
    const height = baseHeight + random() * (city.id === 'dubai' ? 18 : 8);
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
  const stops = city.id === 'lagos' ? [0.08, 0.2, 0.33, 0.47, 0.7, 0.88] : [0.18, 0.36, 0.58, 0.76];
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
      new MeshBasicMaterial({ color: index % 2 === 0 ? city.accent : city.signal, transparent: true, opacity: city.id === 'london' ? 0.38 : 0.24 }),
    );
    const roadPose = sampleBlitzRoute(city.id, city.lengthMeters * distance01, side * city.roadWidth * 0.24);
    reflection.position.set(roadPose.x, 0.092, roadPose.z);
    reflection.rotation.y = roadPose.headingRadians;
    street.add(reflection);
  });
  root.add(street);
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

function createRelayGate(city: BlitzCityDefinition, index: number): Group {
  const gate = new Group();
  gate.name = `atlas-blitz-relay-gate-${index + 1}`;
  const material = new MeshBasicMaterial({ color: index === 1 ? city.accent : city.signal, transparent: true, opacity: 0.88 });
  for (const side of [-1, 1]) {
    const pillar = new Mesh(new BoxGeometry(0.16, 2.7, 0.16), material);
    pillar.position.set(side * city.roadWidth * 0.46, 1.35, 0);
    gate.add(pillar);
  }
  const arch = new Mesh(new TorusGeometry(city.roadWidth * 0.46, 0.11, 8, 28, Math.PI), material);
  arch.position.y = 2.7;
  arch.rotation.z = Math.PI;
  gate.add(arch);
  const pulse = new PointLight(index === 1 ? city.accent : city.signal, 9, 10, 2);
  pulse.position.y = 2.4;
  gate.add(pulse);
  return gate;
}

function createBikeAndRider(city: BlitzCityDefinition): BikeRig {
  const root = new Group();
  root.name = 'atlas-blitz-bike';
  const body = new Group();
  root.add(body);
  const dark = new MeshStandardMaterial({ color: 0x0c1026, roughness: 0.64, metalness: 0.38 });
  const frame = new MeshStandardMaterial({ color: city.accent, roughness: 0.42, metalness: 0.48 });
  const chrome = new MeshStandardMaterial({ color: 0xb8c7e8, roughness: 0.3, metalness: 0.74 });
  const wheels: Mesh[] = [];
  for (const z of [-0.88, 0.92]) {
    const wheel = new Mesh(new TorusGeometry(0.34, 0.085, 10, 22), dark);
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(0, 0.34, z);
    wheel.castShadow = true;
    body.add(wheel);
    wheels.push(wheel);
  }
  body.add(cylinderBetween(new Vector3(0, 0.4, -0.82), new Vector3(0, 0.74, 0.05), 0.055, frame));
  body.add(cylinderBetween(new Vector3(0, 0.4, 0.86), new Vector3(0, 0.74, 0.05), 0.055, frame));
  body.add(cylinderBetween(new Vector3(0, 0.4, -0.82), new Vector3(0, 0.42, 0.86), 0.04, chrome));
  const tank = new Mesh(new SphereGeometry(0.28, 12, 8), frame);
  tank.scale.set(1.25, 0.72, 1.5);
  tank.position.set(0, 0.78, 0.24);
  const seat = new Mesh(new BoxGeometry(0.36, 0.1, 0.55), dark);
  seat.position.set(0, 0.78, -0.34);
  seat.rotation.x = -0.08;
  const handle = new Mesh(new BoxGeometry(0.82, 0.045, 0.045), chrome);
  handle.position.set(0, 1.02, 0.72);
  const fairing = new Mesh(new BoxGeometry(0.46, 0.4, 0.48), frame);
  fairing.position.set(0, 0.79, 0.68);
  fairing.rotation.x = -0.18;
  const exhaust = new Mesh(new CylinderGeometry(0.07, 0.085, 0.78, 10), chrome);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0.27, 0.42, -0.35);
  const tail = new Mesh(new BoxGeometry(0.22, 0.12, 0.07), new MeshBasicMaterial({ color: 0xff477e }));
  tail.position.set(0, 0.72, -0.75);
  body.add(tank, seat, handle, fairing, exhaust, tail, createHumanRider(city));
  const headlight = new PointLight(0xcff8ff, 5, 10, 2);
  headlight.position.set(0, 0.88, 0.95);
  body.add(headlight);
  const trail = [-0.12, 0.12].map((x) => {
    const beam = new Mesh(new BoxGeometry(0.065, 0.05, 1.5), new MeshBasicMaterial({ color: city.signal, transparent: true, opacity: 0.72 }));
    beam.position.set(x, 0.38, -1.55);
    body.add(beam);
    return beam;
  });
  return { root, body, wheels, trail, headlight };
}

function createHumanRider(city: BlitzCityDefinition): Group {
  const rider = new Group();
  rider.name = 'atlas-blitz-human-rider';
  const skin = new MeshStandardMaterial({ color: 0x704631, roughness: 0.86 });
  const jacket = new MeshStandardMaterial({ color: 0x20264c, roughness: 0.72 });
  const trousers = new MeshStandardMaterial({ color: 0x10142c, roughness: 0.82 });
  const shoe = new MeshStandardMaterial({ color: 0x090b18, roughness: 0.92 });
  const hair = new MeshStandardMaterial({ color: 0x151018, roughness: 0.94 });
  const torso = new Mesh(new CylinderGeometry(0.2, 0.27, 0.7, 8), jacket);
  torso.position.set(0, 1.34, -0.08);
  torso.rotation.x = 0.52;
  torso.castShadow = true;
  const neck = new Mesh(new CylinderGeometry(0.075, 0.085, 0.15, 8), skin);
  neck.position.set(0, 1.67, 0.13);
  neck.rotation.x = 0.45;
  const head = new Mesh(new SphereGeometry(0.17, 12, 9), skin);
  head.name = 'atlas-blitz-rider-face';
  head.scale.set(0.82, 1.08, 0.9);
  head.position.set(0, 1.83, 0.22);
  const hairCap = new Mesh(new SphereGeometry(0.174, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.48), hair);
  hairCap.position.set(0, 1.88, 0.205);
  hairCap.rotation.x = -0.12;
  const nose = new Mesh(new SphereGeometry(0.028, 7, 5), skin);
  nose.position.set(0, 1.83, 0.375);
  for (const x of [-0.055, 0.055]) {
    const eye = new Mesh(new SphereGeometry(0.013, 6, 4), new MeshBasicMaterial({ color: 0x11121e }));
    eye.position.set(x, 1.87, 0.365);
    rider.add(eye);
  }
  const shoulderLeft = new Vector3(-0.23, 1.57, 0.04);
  const shoulderRight = new Vector3(0.23, 1.57, 0.04);
  const elbowLeft = new Vector3(-0.34, 1.31, 0.35);
  const elbowRight = new Vector3(0.34, 1.31, 0.35);
  const handLeft = new Vector3(-0.34, 1.05, 0.72);
  const handRight = new Vector3(0.34, 1.05, 0.72);
  const hipLeft = new Vector3(-0.13, 1.03, -0.25);
  const hipRight = new Vector3(0.13, 1.03, -0.25);
  const kneeLeft = new Vector3(-0.25, 0.75, 0.08);
  const kneeRight = new Vector3(0.25, 0.75, 0.08);
  const ankleLeft = new Vector3(-0.22, 0.48, 0.34);
  const ankleRight = new Vector3(0.22, 0.48, 0.34);
  rider.add(
    torso, neck, head, hairCap, nose,
    limb(shoulderLeft, elbowLeft, 0.07, jacket),
    limb(elbowLeft, handLeft, 0.06, jacket),
    limb(shoulderRight, elbowRight, 0.07, jacket),
    limb(elbowRight, handRight, 0.06, jacket),
    limb(hipLeft, kneeLeft, 0.095, trousers),
    limb(kneeLeft, ankleLeft, 0.075, trousers),
    limb(hipRight, kneeRight, 0.095, trousers),
    limb(kneeRight, ankleRight, 0.075, trousers),
  );
  for (const x of [-0.22, 0.22]) {
    const foot = new Mesh(new BoxGeometry(0.14, 0.1, 0.28), shoe);
    foot.position.set(x, 0.45, 0.3);
    foot.rotation.x = -0.16;
    rider.add(foot);
  }
  const stripe = new Mesh(new BoxGeometry(0.22, 0.04, 0.03), new MeshBasicMaterial({ color: city.signal }));
  stripe.position.set(0, 1.38, 0.25);
  stripe.rotation.x = 0.52;
  rider.add(stripe);
  return rider;
}

function limb(start: Vector3, end: Vector3, radius: number, material: MeshStandardMaterial): Mesh {
  return cylinderBetween(start, end, radius, material);
}

function cylinderBetween(start: Vector3, end: Vector3, radius: number, material: MeshStandardMaterial): Mesh {
  const direction = end.clone().sub(start);
  const mesh = new Mesh(new CylinderGeometry(radius, radius * 1.04, direction.length(), 8), material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  return mesh;
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
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    (object.geometry as BufferGeometry).dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}
