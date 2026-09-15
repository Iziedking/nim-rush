import { BoxGeometry, BufferGeometry, CapsuleGeometry, CircleGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, InstancedMesh, MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Points, ShaderMaterial, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { courseGroundLift, sampleCourse } from '../../../../shared/atlas/blitz/course';
import type { BlitzRunState } from '../../../../shared/atlas/blitz/types';
import { blitzSurface } from '../../../../shared/atlas/blitz/surfaces';
import { pedalPoint, riderKnee, type RiderPoint } from './rush-rider-pose';

const up = new Vector3(0, 1, 0);
const axis = new Vector3();
const dummy = new Object3D();
const end = new Vector3();
const start = new Vector3();

function tube(a: number[], b: number[], radius: number): BufferGeometry {
  const p = new Vector3(...a as [number, number, number]), q = new Vector3(...b as [number, number, number]);
  const shape = new CylinderGeometry(radius, radius, p.distanceTo(q), 8);
  dummy.position.copy(p).add(q).multiplyScalar(0.5);
  dummy.quaternion.setFromUnitVectors(up, q.sub(p).normalize());
  dummy.scale.set(1, 1, 1); dummy.updateMatrix();
  shape.applyMatrix4(dummy.matrix);
  return shape;
}

function joined(parts: BufferGeometry[], material: MeshStandardMaterial): Mesh<BufferGeometry, MeshStandardMaterial> {
  // Three 0.185.1, addons/utils/BufferGeometryUtils.js, read 2026-09-15.
  const geometry = mergeGeometries(parts);
  if (!geometry) throw new Error('Bicycle geometry could not be assembled.');
  parts.forEach(p => p.dispose());
  return new Mesh(geometry, material);
}

function shoeGeometry(): BufferGeometry {
  const sections = [[-.15, .035, .065], [-.11, .057, .10], [.015, .064, .076], [.12, .052, .052], [.175, .023, .025]];
  const vertices: number[] = [], indices: number[] = [];
  for (const [z, width, height] of sections) for (let i = 0; i < 12; i++) {
    const angle = i / 12 * Math.PI * 2;
    vertices.push(Math.cos(angle) * width!, (Math.sin(angle) + 1) * height! / 2, z!);
  }
  for (let s = 0; s < sections.length - 1; s++) for (let i = 0; i < 12; i++) {
    const a = s * 12 + i, b = s * 12 + (i + 1) % 12;
    indices.push(a, b, a + 12, b, b + 12, a + 12);
  }
  for (let i = 1; i < 11; i++) { indices.push(0, i + 1, i); indices.push(48, 48 + i, 49 + i); }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function combineShoe(parts: Mesh<BufferGeometry, MeshStandardMaterial>[]): Mesh {
  const geometries = parts.map(part => {
    part.updateMatrix();
    const geometry = part.geometry.clone().applyMatrix4(part.matrix);
    geometry.deleteAttribute('uv');
    const colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = part.material.color.r; colors[i + 1] = part.material.color.g; colors[i + 2] = part.material.color.b;
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    part.geometry.dispose();
    return geometry;
  });
  const mesh = joined(geometries, new MeshStandardMaterial({ vertexColors: true, roughness: .9 }));
  mesh.name = 'cycling-shoe-upper-sole-laces-heel-cuff';
  return mesh;
}

export class RushBike {
  readonly root = new Group();
  readonly particles: Points;
  readonly shadow = new Group();
  private readonly frame = new Group();
  private readonly rear = new Group();
  private readonly fork = new Group();
  private readonly front = new Group();
  private readonly torso = new Group();
  private readonly limbs: InstancedMesh;
  private readonly feet: InstancedMesh;
  private readonly shoes: Group[] = [];
  private readonly knees: InstancedMesh;
  private readonly cranks: InstancedMesh;
  private readonly pedals: InstancedMesh;
  private readonly springs: InstancedMesh;
  private readonly positions = new Float32Array(96 * 3);
  private readonly life = new Float32Array(96);
  private readonly velocities = new Float32Array(96 * 3);
  private cursor = 0;
  private emission = 0;
  private travelled = 0;
  private previousDistance = 0;
  private lastEventTick = -1;
  private compression = 0;
  private compressionSpeed = 0;
  private impact = 0;
  private pedal = 0;
  private cadence = 0;
  private previousSpeed = 0;

  constructor() {
    this.root.name = 'nim-rush-mountain-bike';
    const rubber = new MeshStandardMaterial({ color: 0x171a18, roughness: 0.97 });
    const alloy = new MeshStandardMaterial({ color: 0x8d9999, roughness: 0.42, metalness: 0.7 });
    const paint = new MeshStandardMaterial({ color: 0xbac6a4, roughness: 0.45, metalness: 0.25 });
    const jersey = new MeshStandardMaterial({ color: 0xb2af70, roughness: 0.95 });
    const pants = new MeshStandardMaterial({ color: 0x303934, roughness: 1 });
    const frameParts = [
      tube([0, .42, -.06], [0, 1.02, -.35], .045), tube([0, 1.02, -.35], [0, 1.06, .64], .04),
      tube([0, 1.06, .64], [0, .42, -.06], .053),
    ];
    for (const side of [-1, 1]) {
      frameParts.push(tube([side * .09, .41, -.87], [side * .07, 1.02, -.35], .026));
      frameParts.push(tube([side * .09, .41, -.87], [side * .07, .42, -.06], .024));
    }
    this.frame.add(joined(frameParts, paint));
    this.frame.add(joined([tube([0, .75, -.34], [0, 1.12, -.39], .025), tube([0, 1.06, .64], [0, 1.22, .71], .028), tube([-.39, 1.22, .76], [.39, 1.22, .76], .021)], alloy));
    const saddle = new Mesh(new SphereGeometry(.17, 12, 8), rubber);
    saddle.scale.set(.68, .22, 1.1); saddle.position.set(0, 1.12, -.41); this.frame.add(saddle);
    const rearWheel = this.makeWheel(rubber, alloy), frontWheel = this.makeWheel(rubber, alloy);
    this.rear.add(rearWheel); this.front.add(frontWheel);
    this.rear.position.set(0, .41, -.87);
    this.fork.position.set(0, 0, .87);
    this.front.position.y = .41;
    this.fork.add(this.front);
    this.springs = new InstancedMesh(new CylinderGeometry(1, 1.1, 1, 8), alloy, 2);
    this.root.add(this.frame, this.rear, this.fork, this.springs);
    const chest = new Mesh(new CylinderGeometry(.24, .17, .55, 14), jersey);
    chest.scale.set(1.12, 1, .65); chest.rotation.x = .7;
    const pack = new Mesh(new CapsuleGeometry(.12, .15, 5, 10), pants);
    pack.scale.set(1.2, 1, .55); pack.position.set(0, .07, -.16); pack.rotation.x = .7;
    const head = new Mesh(new SphereGeometry(.18, 20, 14), paint);
    head.scale.set(.94, 1.07, 1.12); head.position.set(0, .39, .3);
    const peak = joined([tube([-.14, .4, .38], [.14, .4, .38], .032)], paint);
    const hip = new Mesh(new SphereGeometry(.2, 12, 8), pants);
    hip.scale.set(1.06, .6, .88); hip.position.set(0, -.32, -.23);
    this.torso.add(chest, pack, head, peak, hip);
    for (const x of [-.085, 0, .085]) {
      const vent = new Mesh(new BoxGeometry(.025, .018, .21), rubber);
      vent.position.set(x, .58, .29); this.torso.add(vent);
    }
    this.frame.add(this.torso);
    this.limbs = new InstancedMesh(new CylinderGeometry(1, .86, 1, 10), jersey, 8);
    for (let i = 0; i < 8; i++) this.limbs.setColorAt(i, new Color(i < 4 ? 0xffffff : 0x485144));
    this.feet = new InstancedMesh(new SphereGeometry(1, 10, 7), rubber, 2);
    this.knees = new InstancedMesh(new SphereGeometry(1, 12, 8), pants, 2);
    this.cranks = new InstancedMesh(new CylinderGeometry(1, 1, 1, 8), alloy, 2);
    this.pedals = new InstancedMesh(new BoxGeometry(.14, .025, .1), rubber, 2);
    const ring = new Mesh(new CylinderGeometry(.12, .12, .016, 24), alloy);
    ring.rotation.z = Math.PI / 2; ring.position.set(.12, .42, -.06);
    const chain = joined([tube([.13, .52, -.06], [.13, .47, -.87], .008), tube([.13, .32, -.06], [.13, .35, -.87], .008)], rubber);
    this.frame.add(this.limbs, this.feet, this.knees, this.cranks, this.pedals, ring, chain);
    for (let side = 0; side < 2; side++) {
      const shoe = new Group(); shoe.name = `rider-shoe-${side}`;
      const upper = new Mesh(shoeGeometry(), new MeshStandardMaterial({ color: 0x65716e, roughness: .92 }));
      upper.position.y = .018;
      const sole = new Mesh(shoeGeometry(), new MeshStandardMaterial({ color: 0xd8d1b8, roughness: 1 }));
      sole.scale.set(1.08, .2, 1.02);
      const details = [tube([-.048, .094, -.04], [.048, .094, -.04], .009), tube([-.047, .089, -.005], [.047, .089, -.005], .009), tube([-.045, .08, .03], [.045, .08, .03], .009)];
      const laces = joined(details, paint);
      const heel = new Mesh(new BoxGeometry(.07, .045, .02), rubber); heel.position.set(0, .04, -.14);
      const cuff = new Mesh(new CylinderGeometry(.047, .044, .11, 12), pants);
      cuff.position.set(0, .10, -.055);
      shoe.add(combineShoe([upper, sole, laces, heel, cuff])); this.shoes.push(shoe); this.frame.add(shoe);
    }
    // Dynamic limb bounds from the first pose are not valid for a full pedal
    // cycle. These small player meshes must never disappear through culling.
    for (const mesh of [this.limbs, this.feet, this.knees, this.cranks, this.pedals, this.springs]) mesh.frustumCulled = false;
    for (const z of [-.87, .87]) {
      const contact = new Mesh(new CircleGeometry(.32, 24), new MeshBasicMaterial({ color: 0x182017, transparent: true, opacity: .2, depthWrite: false }));
      contact.rotation.x = -Math.PI / 2; contact.position.set(0, .006, z); contact.scale.set(.6, 1.8, 1); this.shadow.add(contact);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('life', new Float32BufferAttribute(this.life, 1));
    this.particles = new Points(geometry, new ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'attribute float life; varying float fade; void main(){ fade=life; vec4 p=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*p; gl_PointSize=min(40.,(90.+(1.-life)*100.)/max(1.,-p.z)); }',
      fragmentShader: 'varying float fade; void main(){float r=length(gl_PointCoord-.5)*2.; if(r>1.)discard; gl_FragColor=vec4(.64,.56,.43,pow(1.-r,2.)*fade*.38);}',
    }));
    this.particles.frustumCulled = false;
    this.root.traverse(object => { if (object instanceof Mesh) object.castShadow = true; });
    // The leg and wheel shadows already cover these tiny parts. Extra shadow
    // draws here add cost without changing a readable contact silhouette.
    for (const object of [this.cranks, this.pedals, ring, chain, ...this.shoes.map(shoe => shoe.children[0]!)]) object.castShadow = false;
  }

  private makeWheel(rubber: MeshStandardMaterial, alloy: MeshStandardMaterial): Group {
    const wheel = new Group();
    const tyre = new TorusGeometry(.365, .045, 8, 40); tyre.rotateY(Math.PI / 2);
    const rim = new TorusGeometry(.32, .013, 6, 36); rim.rotateY(Math.PI / 2);
    const parts: BufferGeometry[] = [rim];
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * Math.PI * 2;
      parts.push(tube([i % 2 ? -.045 : .045, 0, 0], [0, Math.sin(a) * .32, Math.cos(a) * .32], .003));
    }
    wheel.add(new Mesh(tyre, rubber), joined(parts, alloy));
    return wheel;
  }

  update(state: BlitzRunState, steer: number, dt: number): number {
    const pose = sampleCourse(state.cityId, state.distanceMeters, state.laneOffset);
    if (state.distanceMeters < this.previousDistance || state.phase === 'countdown') {
      this.previousDistance = state.distanceMeters; this.impact = 0; this.life.fill(0);
    }
    const travelled = Math.max(0, state.distanceMeters - this.previousDistance);
    this.previousDistance = state.distanceMeters; this.travelled += travelled;
    const yaw = Math.atan2(state.lateralVelocityMps, Math.max(2, state.speedMps)) * .85;
    const probeDistance = Math.cos(yaw) * .87, probeLane = Math.sin(yaw) * .87;
    const front = sampleCourse(state.cityId, state.distanceMeters + probeDistance, state.laneOffset + probeLane);
    const rear = sampleCourse(state.cityId, state.distanceMeters - probeDistance, state.laneOffset - probeLane);
    const frontY = front.y + courseGroundLift(state.cityId, state.distanceMeters + probeDistance, state.laneOffset + probeLane);
    const rearY = rear.y + courseGroundLift(state.cityId, state.distanceMeters - probeDistance, state.laneOffset - probeLane);
    const ground = (frontY + rearY) / 2;
    const event = state.lastEvent;
    if (event && event.tick !== this.lastEventTick) {
      this.lastEventTick = event.tick;
      if (event.type === 'landing' || event.type === 'impact') {
        this.compressionSpeed -= event.intensity * 2.2;
        this.impact = event.intensity;
        this.emission += event.intensity * 18;
      }
    }
    this.impact *= Math.exp(-dt * 7);
    const roughness = blitzSurface(state.surface).roughness;
    const trailResponse = state.airborne ? 0 : Math.sin(state.distanceMeters * 4.3) * roughness * Math.min(1, state.speedMps / 15);
    this.compressionSpeed += ((trailResponse - this.compression) * 120 - this.compressionSpeed * 18) * dt;
    this.compression = MathUtils.clamp(this.compression + this.compressionSpeed * dt, -.12, .06);
    this.root.position.set(pose.x, state.airborne ? pose.y + state.heightMeters + .025 : ground + .025, pose.z);
    this.root.rotation.order = 'YXZ';
    this.root.rotation.y = pose.headingRadians + yaw;
    const pitch = state.airborne ? -Math.atan2(state.verticalVelocityMps, Math.max(12, state.speedMps)) : -Math.atan2(frontY - rearY, 1.74);
    this.root.rotation.x = MathUtils.lerp(this.root.rotation.x, pitch, 1 - Math.exp(-dt * 16));
    const lean = MathUtils.clamp(-steer * .32 - pose.bend * state.speedMps * .08, -.55, .55);
    const bankProbe = Math.cos(yaw) * .25;
    const leftLift = courseGroundLift(state.cityId, state.distanceMeters + Math.sin(yaw) * .25, state.laneOffset - bankProbe);
    const rightLift = courseGroundLift(state.cityId, state.distanceMeters - Math.sin(yaw) * .25, state.laneOffset + bankProbe);
    const bank = state.airborne ? 0 : Math.atan2(rightLift - leftLift, .5);
    this.root.rotation.z = MathUtils.lerp(this.root.rotation.z, MathUtils.clamp(bank + lean, -.65, .65), 1 - Math.exp(-dt * 10));
    this.frame.position.y = this.compression;
    this.fork.rotation.y = -steer * .25;
    this.rear.children[0]!.rotation.x += travelled / .365;
    this.front.children[0]!.rotation.x += travelled / .365;
    this.torso.position.set(-lean * .11, 1.48 + this.compression * .55 - (state.boostActive ? .06 : 0), -.13 - this.impact * .12);
    this.torso.rotation.z = -lean * .24;
    this.torso.rotation.x = this.impact * .15;
    const braking = state.speedMps < this.previousSpeed - .06;
    const targetCadence = state.phase === 'running' && !state.airborne && !braking && state.speedMps > .3
      ? (state.boostActive ? 11 : Math.min(8.5, 3.5 + state.speedMps * .16)) : 0;
    this.cadence = MathUtils.lerp(this.cadence, targetCadence, 1 - Math.exp(-dt * 8));
    this.pedal += this.cadence * dt;
    this.previousSpeed = state.speedMps;
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      const pedal = pedalPoint(this.pedal, side);
      const hipVector = new Vector3(sign * .13, -.32, -.23).applyEuler(this.torso.rotation).add(this.torso.position);
      const hip: RiderPoint = [hipVector.x, hipVector.y, hipVector.z];
      const ankle: RiderPoint = [pedal[0], pedal[1] + .13, pedal[2] - .09];
      const knee = riderKnee(hip, ankle, side);
      const points = [
        [sign * .23, this.torso.position.y + .18, .05], [sign * .37, this.torso.position.y -.1, .35], [sign * .37, 1.23, .76],
        hip, knee, ankle,
      ];
      this.segment(this.limbs, side * 2, points[0]!, points[1]!, .075);
      this.segment(this.limbs, side * 2 + 1, points[1]!, points[2]!, .058);
      this.segment(this.limbs, 4 + side * 2, points[3]!, points[4]!, .093);
      this.segment(this.limbs, 5 + side * 2, points[4]!, points[5]!, .066);
      dummy.position.set(...knee); dummy.quaternion.identity(); dummy.scale.set(.086, .086, .086); dummy.updateMatrix(); this.knees.setMatrixAt(side, dummy.matrix);
      this.shoes[side]!.position.set(pedal[0], pedal[1] + .013, pedal[2] - .035);
      dummy.position.set(...pedal); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); this.pedals.setMatrixAt(side, dummy.matrix);
      this.segment(this.cranks, side, [sign * .13, .42, -.06], pedal, .019);
      dummy.position.set(sign * .37, 1.23, .76); dummy.quaternion.identity(); dummy.scale.set(.058, .053, .07); dummy.updateMatrix(); this.feet.setMatrixAt(side, dummy.matrix);
      this.segment(this.springs, side, [sign * .08, .41, .87], [sign * .08, 1.08 + this.compression, .65], .027);
    }
    this.limbs.instanceMatrix.needsUpdate = true; this.feet.instanceMatrix.needsUpdate = true; this.springs.instanceMatrix.needsUpdate = true;
    this.knees.instanceMatrix.needsUpdate = true; this.cranks.instanceMatrix.needsUpdate = true; this.pedals.instanceMatrix.needsUpdate = true;
    this.shadow.position.set(pose.x, ground + .008, pose.z); this.shadow.rotation.y = pose.headingRadians;
    this.shadow.scale.setScalar(state.airborne ? Math.max(.25, 1 - state.heightMeters * .22) : 1);
    if (!state.airborne && state.speedMps > 3 && state.surface !== 'pavement') this.emission += dt * (state.driftActive ? 55 : 20);
    for (let i = 0; i < 96; i++) {
      this.life[i] = Math.max(0, this.life[i]! - dt * 1.3);
      for (let j = 0; j < 3; j++) this.positions[i * 3 + j] = this.positions[i * 3 + j]! + this.velocities[i * 3 + j]! * dt;
    }
    let emitted = 0;
    while (this.emission >= 1 && emitted++ < 32) {
      this.emission--;
      const i = this.cursor++ % 96, variation = Math.sin(this.cursor * 17.17);
      this.positions[i * 3] = pose.x - Math.sin(pose.headingRadians) * .9;
      this.positions[i * 3 + 1] = ground + .12;
      this.positions[i * 3 + 2] = pose.z - Math.cos(pose.headingRadians) * .9;
      this.velocities[i * 3] = variation * .9 - state.lateralVelocityMps * .12;
      this.velocities[i * 3 + 1] = .4 + Math.abs(variation) * .6;
      this.velocities[i * 3 + 2] = Math.cos(this.cursor * 9.1) * .7;
      this.life[i] = 1;
    }
    // Buffer attributes keep their own typed arrays after construction.
    (this.particles.geometry.getAttribute('position').array as Float32Array).set(this.positions);
    (this.particles.geometry.getAttribute('life').array as Float32Array).set(this.life);
    this.particles.geometry.getAttribute('position').needsUpdate = true;
    this.particles.geometry.getAttribute('life').needsUpdate = true;
    return this.impact;
  }

  private segment(mesh: InstancedMesh, index: number, a: number[], b: number[], radius: number): void {
    start.set(a[0]!, a[1]!, a[2]!); end.set(b[0]!, b[1]!, b[2]!);
    dummy.position.copy(start).add(end).multiplyScalar(.5);
    axis.subVectors(end, start); dummy.scale.set(radius, axis.length(), radius);
    dummy.quaternion.setFromUnitVectors(up, axis.normalize()); dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
  }
}
