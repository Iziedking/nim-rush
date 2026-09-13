import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
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
import type { BlitzCityId, BlitzRunState } from '../../../../shared/atlas/blitz/types';

interface BikeRig {
  readonly root: Group;
  readonly body: Group;
  readonly wheels: readonly Mesh[];
  readonly trail: readonly Mesh[];
  readonly headlight: PointLight;
}

export class BlitzRenderer {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(58, 1, 0.1, 140);
  private readonly renderer: WebGLRenderer;
  private cityRoot: Group | null = null;
  private bike: BikeRig | null = null;
  private relayGates: Group[] = [];
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
    const state = { cityId, distanceMeters: city.lengthMeters * 0.08, laneOffset: 0, speedMps: 0, driftActive: false, boostActive: false, missions: [] } as unknown as BlitzRunState;
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
    this.renderer.setPixelRatio(MathUtils.clamp(pixelRatio, 0.75, 1.6));
    this.renderer.setSize(safeWidth, safeHeight, false);
  }

  destroy(): void {
    if (this.cityRoot) disposeTree(this.cityRoot);
    this.renderer.dispose();
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

    const forward = new Vector3(Math.sin(pose.headingRadians), 0, Math.cos(pose.headingRadians));
    const right = new Vector3(forward.z, 0, -forward.x);
    const focus = new Vector3(pose.x, 1.18, pose.z).addScaledVector(forward, 1.9);
    const desired = new Vector3(pose.x, 3.4, pose.z)
      .addScaledVector(forward, -7.2)
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
  createSkyline(root, city);
  createCityLandmarks(root, city);
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
  const roadMaterial = new MeshStandardMaterial({ color: city.road, roughness: 0.94, metalness: 0.05 });
  const edgeMaterial = new MeshBasicMaterial({ color: city.accent });
  const lineMaterial = new MeshBasicMaterial({ color: 0xf7f9ff, transparent: true, opacity: 0.72 });
  for (let index = 0; index < city.route.length; index += 1) {
    const start = city.route[index]!;
    const end = city.route[(index + 1) % city.route.length]!;
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const length = Math.hypot(dx, dz) + 1.4;
    const angle = Math.atan2(dx, dz);
    const road = new Mesh(new BoxGeometry(city.roadWidth, 0.12, length), roadMaterial);
    road.position.set((start[0] + end[0]) / 2, 0, (start[1] + end[1]) / 2);
    road.rotation.y = angle;
    road.receiveShadow = true;
    root.add(road);
    for (const side of [-1, 1]) {
      const edge = new Mesh(new BoxGeometry(0.1, 0.035, length), edgeMaterial);
      edge.position.set(side * city.roadWidth * 0.48, 0.09, 0);
      road.add(edge);
    }
    for (let dashIndex = -2; dashIndex <= 2; dashIndex += 1) {
      const dash = new Mesh(new BoxGeometry(0.08, 0.025, Math.max(0.7, length / 9)), lineMaterial);
      dash.position.set(0, 0.09, dashIndex * length / 5);
      road.add(dash);
    }
  }
}

function createSkyline(root: Group, city: BlitzCityDefinition): void {
  const random = seeded(city.id);
  for (let index = 0; index < 38; index += 1) {
    const angle = index / 38 * Math.PI * 2 + random() * 0.08;
    const radius = 22 + random() * 13;
    const width = 2.1 + random() * 3.2;
    const depth = 2 + random() * 3;
    const baseHeight = city.id === 'dubai' ? 7 : city.id === 'london' ? 4.6 : 5.2;
    const height = baseHeight + random() * (city.id === 'dubai' ? 18 : 8);
    const tone = index % 4 === 0 ? city.accent : index % 3 === 0 ? 0x343b65 : 0x252b52;
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
    bridge.position.set(0, 3.2, -19);
    landmark.add(bridge);
    for (const x of [-5.5, 5.5]) {
      const mast = new Mesh(new BoxGeometry(0.32, 6, 0.4), new MeshStandardMaterial({ color: 0xf7f9ff }));
      mast.position.set(x, 2.8, -19);
      landmark.add(mast);
    }
  } else if (city.id === 'london') {
    const tower = new Mesh(new BoxGeometry(3.4, 12, 3.4), new MeshStandardMaterial({ color: 0x735a62, roughness: 0.9 }));
    tower.position.set(-19, 6, -7);
    const clock = new Mesh(new CylinderGeometry(1.05, 1.05, 0.12, 24), new MeshBasicMaterial({ color: 0xffd166 }));
    clock.rotation.x = Math.PI / 2;
    clock.position.set(0, 3.8, 1.75);
    tower.add(clock);
    landmark.add(tower);
  } else {
    const needle = new Mesh(new CylinderGeometry(0.35, 2.6, 26, 7), new MeshStandardMaterial({ color: 0xbccaf2, roughness: 0.26, metalness: 0.6 }));
    needle.position.set(19, 13, -6);
    landmark.add(needle);
    const crown = new Mesh(new SphereGeometry(0.6, 8, 6), new MeshBasicMaterial({ color: city.accent }));
    crown.position.set(19, 26, -6);
    landmark.add(crown);
  }
  root.add(landmark);
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
  const bodyColor = id.includes('bus') || id.includes('van') ? city.accent : id.includes('keke') ? 0xffc627 : 0x334a72;
  const body = new Mesh(new BoxGeometry(id.includes('bus') ? 1.3 : 0.95, 0.65, id.includes('bus') ? 2.4 : 1.65), new MeshStandardMaterial({ color: bodyColor, roughness: 0.58, metalness: 0.12 }));
  body.castShadow = true;
  const glass = new Mesh(new BoxGeometry(body.geometry.parameters.width * 0.82, 0.36, body.geometry.parameters.depth * 0.48), new MeshStandardMaterial({ color: 0x8ed8ef, roughness: 0.18, metalness: 0.4 }));
  glass.position.set(0, 0.46, -0.08);
  root.add(body, glass);
  for (const x of [-0.48, 0.48]) for (const z of [-0.55, 0.55]) {
    const wheel = new Mesh(new CylinderGeometry(0.22, 0.22, 0.14, 12), new MeshStandardMaterial({ color: 0x090b18, roughness: 0.9 }));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, -0.22, z * (id.includes('bus') ? 1.55 : 1));
    root.add(wheel);
  }
  return root;
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
  const tail = new Mesh(new BoxGeometry(0.22, 0.12, 0.07), new MeshBasicMaterial({ color: 0xff477e }));
  tail.position.set(0, 0.72, -0.75);
  body.add(tank, seat, handle, tail, createHumanRider(city));
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
  const shoulderLeft = new Vector3(-0.2, 1.57, 0.04);
  const shoulderRight = new Vector3(0.2, 1.57, 0.04);
  const handLeft = new Vector3(-0.34, 1.05, 0.72);
  const handRight = new Vector3(0.34, 1.05, 0.72);
  rider.add(
    torso, neck, head, hairCap, nose,
    limb(shoulderLeft, handLeft, 0.065, jacket),
    limb(shoulderRight, handRight, 0.065, jacket),
    limb(new Vector3(-0.13, 1.03, -0.25), new Vector3(-0.22, 0.48, 0.18), 0.085, trousers),
    limb(new Vector3(0.13, 1.03, -0.25), new Vector3(0.22, 0.48, 0.18), 0.085, trousers),
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
