import { BufferGeometry, Color, CylinderGeometry, DataTexture, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, Object3D, RepeatWrapping, RGBAFormat, SphereGeometry, SRGBColorSpace } from 'three';
import { blitzCity, blitzEnabledObstacles } from '../../../../shared/atlas/blitz/cities';
import { courseTerrainHeight, obstacleShape, roadsideRocks, sampleCourse } from '../../../../shared/atlas/blitz/course';
import type { BlitzCityId, BlitzDifficulty } from '../../../../shared/atlas/blitz/types';

function noise(x: number, z: number): number {
  return Math.sin(x * 1.73 + z * .41) * Math.cos(z * 1.19 - x * .27);
}

function texture(seed: number): DataTexture {
  const data = new Uint8Array(128 * 128 * 4);
  let value = seed;
  for (let i = 0; i < 128 * 128; i++) {
    value = Math.imul(value ^ (value >>> 13), 1597334677);
    const grain = 175 + (value >>> 24) * .25;
    data[i * 4] = grain; data[i * 4 + 1] = grain; data[i * 4 + 2] = grain; data[i * 4 + 3] = 255;
  }
  const map = new DataTexture(data, 128, 128, RGBAFormat);
  map.magFilter = LinearFilter; map.minFilter = LinearMipmapLinearFilter; map.generateMipmaps = true;
  map.wrapS = map.wrapT = RepeatWrapping; map.colorSpace = SRGBColorSpace; map.needsUpdate = true;
  return map;
}

export function createRushCourse(id: BlitzCityId, difficulty: BlitzDifficulty = 'rookie'): Group {
  const city = blitzCity(id), root = new Group();
  root.name = 'nim-rush-ridge-course';
  const map = texture(438729);
  const soil = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map, bumpMap: map, bumpScale: .045, roughness: 1 });
  const bark = new MeshStandardMaterial({ color: 0x535042, roughness: 1 });
  const leaf = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, side: DoubleSide });
  const stone = new MeshStandardMaterial({ color: 0x827f6c, roughness: 1, map, bumpMap: map, bumpScale: .12 });
  const grassMaterial = new MeshStandardMaterial({ color: 0x67704c, roughness: 1, side: DoubleSide });
  const dummy = new Object3D();
  const trunkGeometry = new CylinderGeometry(.18, .29, 1, 7);
  const canopyGeometry = pineBranches();
  const rockGeometry = new SphereGeometry(1, 9, 6);
  const rockPositions = rockGeometry.getAttribute('position');
  for (let i = 0; i < rockPositions.count; i++) {
    const x = rockPositions.getX(i), y = rockPositions.getY(i), z = rockPositions.getZ(i);
    const scale = .9 + noise(x * 4, z * 4 + y) * .1;
    rockPositions.setXYZ(i, x * scale, y * scale, z * scale);
  }
  rockGeometry.computeVertexNormals();
  const grassGeometry = new BufferGeometry();
  grassGeometry.setAttribute('position', new Float32BufferAttribute([-.2, 0, 0, .2, 0, 0, .05, .6, 0, 0, 0, -.2, 0, 0, .2, 0, .48, .02], 3));
  grassGeometry.computeVertexNormals();
  for (let section = 0; section < city.lengthMeters; section += 100) {
    const chunk = new Group();
    chunk.userData.start = section; chunk.userData.end = Math.min(city.lengthMeters, section + 100);
    chunk.add(terrain(id, section, chunk.userData.end as number, soil));
    const trunks = new InstancedMesh(trunkGeometry, bark, 22);
    const foliage = new InstancedMesh(canopyGeometry, leaf, 22);
    const stones = new InstancedMesh(rockGeometry, stone, 24);
    const grasses = new InstancedMesh(grassGeometry, grassMaterial, 160);
    for (let i = 0; i < 22; i++) {
      const d = section + (i + .5) / 22 * 100;
      const lane = (i % 2 ? -1 : 1) * (9 + Math.abs(noise(d, i)) * 35);
      const p = sampleCourse(id, d, lane);
      const ground = terrainHeight(id, d, lane);
      const height = 6 + Math.abs(noise(i * 4, section)) * 9;
      dummy.position.set(p.x, ground + height / 2, p.z); dummy.rotation.set(0, i * 2, noise(i, d) * .03); dummy.scale.set(1, height, 1); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x, ground, p.z);
      dummy.scale.set(6 + (i % 4) * .5, height, 6 + (i % 4) * .5); dummy.updateMatrix(); foliage.setMatrixAt(i, dummy.matrix);
      foliage.setColorAt(i, new Color().setHSL(.23 + noise(i, section) * .02, .21, .48 + (i % 4) * .045));
    }
    for (const [i, rock] of roadsideRocks(section).entries()) {
      const d = rock.distance, lane = rock.lane, size = rock.size!;
      const p = sampleCourse(id, d, lane);
      dummy.position.set(p.x, terrainHeight(id, d, lane) + size * .25, p.z); dummy.rotation.set(0, p.headingRadians, 0); dummy.scale.set(size, size * .7, size * 1.2); dummy.updateMatrix(); stones.setMatrixAt(i, dummy.matrix);
    }
    for (let i = 0; i < 160; i++) {
      const d = section + (i + .2) / 160 * 100, lane = (i % 2 ? -1 : 1) * (4.9 + (i % 9) * .46);
      const p = sampleCourse(id, d, lane);
      dummy.position.set(p.x, terrainHeight(id, d, lane), p.z); dummy.rotation.set(0, i * 2.3, 0); dummy.scale.setScalar(.6 + Math.abs(noise(d, i))); dummy.updateMatrix(); grasses.setMatrixAt(i, dummy.matrix);
    }
    chunk.add(trunks, foliage, stones, grasses);
    for (let d = section + 8; d < section + 100 && d < city.lengthMeters; d += 25) {
      for (const lane of [-5.8, 5.8]) {
        const p = sampleCourse(id, d, lane);
        const post = new Mesh(new CylinderGeometry(.035, .035, .8, 5), bark);
        post.position.set(p.x, p.y + .4, p.z); chunk.add(post);
      }
    }
    root.add(chunk);
  }
  // Only what the simulation makes solid on this difficulty. A drawn obstacle
  // a rider can ride through teaches them to distrust the ones that are real.
  for (const obstacle of blitzEnabledObstacles(city, difficulty)) {
    const shape = obstacleShape(obstacle.id), p = sampleCourse(id, obstacle.distance01 * city.lengthMeters, obstacle.lane);
    let hazard: Mesh;
    if (obstacle.id.includes('log')) {
      hazard = new Mesh(new CylinderGeometry(shape.height / 2, shape.height / 2, shape.halfWidth * 2, 14), bark);
      hazard.rotation.z = Math.PI / 2;
    } else {
      hazard = new Mesh(rockGeometry, stone);
      hazard.scale.set(shape.halfWidth, shape.height / 2, shape.halfLength);
    }
    const group = new Group(); group.rotation.y = p.headingRadians; group.position.set(p.x, p.y + shape.height / 2, p.z); group.add(hazard); root.add(group);
  }
  return root;
}

function terrainHeight(id: BlitzCityId, distance: number, lane: number): number {
  return courseTerrainHeight(id, distance, lane);
}

function pineBranches(): BufferGeometry {
  const positions: number[] = [], colors: number[] = [];
  const triangle = (a: number[], b: number[], c: number[], tone: number) => {
    positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) colors.push(tone * .65, tone * .79, tone * .55);
  };
  // Branch whorls with broken needle silhouettes instead of stacked spheres.
  // One geometry is shared by every tree, with no transparent leaf overdraw.
  for (let level = 0; level < 9; level++) for (let branch = 0; branch < 9; branch++) {
    const y = .28 + level * .078;
    const angle = branch / 9 * Math.PI * 2 + level * 1.81;
    const reach = (.52 - level * .052) * (.82 + Math.abs(noise(level, branch)) * .3);
    for (let twig = 0; twig < 4; twig++) {
      const r = reach * (.18 + twig * .22), tip = r + reach * .35;
      const x = Math.cos(angle), z = Math.sin(angle);
      const width = reach * (.27 - twig * .035);
      const ay = y - r * .09;
      triangle([x * r - z * width, ay, z * r + x * width], [x * tip, ay + .055, z * tip], [x * r + z * width, ay, z * r - x * width], .5 + level * .035);
      triangle([x * r, ay - .025, z * r], [x * tip, ay + .055, z * tip], [x * r, ay + .06, z * r], .45 + level * .035);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function terrain(id: BlitzCityId, from: number, to: number, material: MeshStandardMaterial): Mesh {
  const offsets = [-80, -45, -24, -12, -7, -6, -5.5, -5, -4.5, -4.3, -4, -3.6, -2.7, -1.4, -.9, 0,
    .9, 1.4, 2.7, 3.6, 4, 4.3, 4.5, 5, 5.5, 6, 7, 12, 24, 45, 80];
  const positions: number[] = [], colors: number[] = [], uvs: number[] = [], indices: number[] = [];
  const steps = Math.ceil((to - from) / 2);
  const distances = Array.from({ length: steps + 1 }, (_, i) => from + (to - from) * i / steps);
  for (const feature of blitzCity(id).terrainFeatures) {
    if (feature.kind !== 'jump') continue;
    const lip = feature.distance01 * blitzCity(id).lengthMeters;
    for (const d of [lip - 6, lip - .001, lip]) if (d > from && d < to) distances.push(d);
  }
  distances.sort((a, b) => a - b);
  const rows = distances.length - 1;
  for (let row = 0; row <= rows; row++) {
    const d = distances[row]!;
    for (const lane of offsets) {
      const p = sampleCourse(id, d, lane);
      positions.push(p.x, terrainHeight(id, d, lane), p.z);
      uvs.push(lane / 2, d / 2);
      const onTrail = Math.abs(lane) < 3.7;
      const variation = noise(d * .4, lane) * .035;
      const color = new Color(onTrail ? p.surface === 'gravel' ? 0x96958a : p.surface === 'wood' ? 0x998774 : 0x9b8267 : 0x71775b);
      color.multiplyScalar(1 + variation - (Math.abs(Math.abs(lane) - .9) < .2 ? .17 : 0));
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let row = 0; row < rows; row++) for (let col = 0; col < offsets.length - 1; col++) {
    const a = row * offsets.length + col, b = a + offsets.length;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

export function updateRushCourse(root: Group, distance: number): void {
  for (const child of root.children) {
    if (typeof child.userData.start === 'number') child.visible = child.userData.end >= distance - 65 && child.userData.start <= distance + 225;
  }
}
