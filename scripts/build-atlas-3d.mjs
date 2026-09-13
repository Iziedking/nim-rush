import { createHash } from 'node:crypto';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, join, relative } from 'node:path';

const root = process.cwd();
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (value.startsWith('--')) args.set(value, process.argv[index + 1] ?? true);
}

const district = args.get('--district');
if (district !== 'beacon-commons' && district !== 'pay-harbor') throw new Error('The native 3D builder supports --district beacon-commons or --district pay-harbor.');

const repeatValue = args.get('--repeat');
const repeat = typeof repeatValue === 'string' && /^\d+$/.test(repeatValue) ? Number(repeatValue) : 1;
if (repeat < 1 || repeat > 3) throw new Error('--repeat must be an integer from 1 through 3.');

const characterSource = join(root, 'art', 'atlas', 'characters', 'atlas-walker-v1');
const environmentSource = join(root, 'art', 'atlas', 'environments', 'beacon-commons-v1');
const payHarborSource = join(root, 'art', 'atlas', 'environments', 'pay-harbor-v1');
const publicRoot = join(root, 'public', 'atlas', '3d', 'v1');
const manifestPath = join(root, 'public', 'atlas', 'manifests', 'assets-v2.json');
const scenePath = join(publicRoot, district, 'scene.json');
const npcPositions = [[0.7, 0.5], [-5.25, 0.25], [-4.45, 0.25], [-3.45, -1.15], [-3.2, -2], [3.25, -0.45], [4.6, -0.55], [2, -3.7], [-1.2, -4.6], [-3.6, -9.8], [3, -7.4], [-0.4, -7], [2.1, -14], [-2, -24], [4, -39], [-6, -51], [2, -62]];
const streetBlockColliders = [
  [-5.4, 4.8], [5.4, 4.0], [-5.5, -17.6], [5.5, -20.8],
  [-5.4, -29.2], [5.5, -32.0], [-5.4, -41.8], [5.4, -44.2],
  [-5.5, -54.5], [5.5, -57.0], [-5.4, -66.0], [5.4, -64.0],
];

const scene = {
  version: 1,
  districtId: 'beacon-commons',
  models: [
    { id: 'beacon-commons-environment', url: '/atlas/3d/v1/beacon-commons/environment.glb', contentType: 'model/gltf-binary' },
    { id: 'atlas-walker-player', url: '/atlas/3d/v2/characters/atlas-walker-v2-player.glb', contentType: 'model/gltf-binary' },
    { id: 'atlas-walker-npc-lod1', url: '/atlas/3d/v2/characters/atlas-walker-v2-lod1.glb', contentType: 'model/gltf-binary' },
    { id: 'atlas-walker-npc-lod2', url: '/atlas/3d/v2/characters/atlas-walker-v2-lod2.glb', contentType: 'model/gltf-binary' },
    { id: 'atlas-walker-npc-female-lod1', url: '/atlas/3d/v2/characters/atlas-walker-v2-female-lod1.glb', contentType: 'model/gltf-binary' },
    { id: 'atlas-walker-npc-female-lod2', url: '/atlas/3d/v2/characters/atlas-walker-v2-female-lod2.glb', contentType: 'model/gltf-binary' },
  ],
  instances: [
    { id: 'beacon-commons-environment-instance', modelId: 'beacon-commons-environment', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    { id: 'atlas-walker-player-instance', modelId: 'atlas-walker-player', position: [0, 0, 4.2], rotation: [0, 3.14159265359, 0], scale: [1, 1, 1] },
  ],
  navigation: {
    safeSpawn: [0, 0, 4.2],
    bounds: { minX: -9.4, maxX: 9.4, minZ: -70.2, maxZ: 7.2 },
    cameraHeadingRadians: Math.PI,
  },
  anchors: [
    { id: 'arrival-player', kind: 'arrival', position: [0, 0, 4.2], radius: 1.2 },
    { id: 'travel-pay-harbor', kind: 'travel', position: [5.7, 0, -9.7], radius: 2.5 },
    { id: 'return-pay-harbor', kind: 'travel', position: [0.2, 0, 3.2], radius: 1.6 },
    { id: 'mission-guide', kind: 'mission', position: [0.7, 0, 0.5], radius: 1.2 },
    { id: 'community-plaza', kind: 'conversation', position: [-2.9, 0, -4.6], radius: 1.8 },
    /*
     * These two sat at [5.9, 0, -5.7], which is the exact centre of
     * obstruction-workshop (4.8 x 4.2). The nearest edge is 2.10 m away and
     * the anchor radius is 2, so a player standing hard against the wall was
     * still 2.40 m from the anchor and could never reach either objective.
     * Both now sit just off the workshop's near face, where a workbench is
     * approached from. Nothing references these ids in code; they are scene
     * data read generically, so moving them is safe.
     */
    { id: 'team-workshop', kind: 'work', position: [5.9, 0, -3.2], radius: 2.0 },
    { id: 'district-map', kind: 'travel', position: [-3.7, 0, -11.4], radius: 2.0 },
    { id: 'conversation-guide-market', kind: 'conversation', position: [0.7, 0, 0.5], radius: 1.2 },
    { id: 'conversation-community-plaza', kind: 'conversation', position: [-2.9, 0, -4.6], radius: 1.5 },
    { id: 'conversation-team-pavilion', kind: 'conversation', position: [-3.7, 0, -11.4], radius: 1.5 },
    { id: 'work-repair-core', kind: 'work', position: [3.95, 0, -1.35], radius: 1.2 },
    { id: 'work-builder-yard', kind: 'work', position: [5.9, 0, -3.2], radius: 2.0 },
    { id: 'work-community-board', kind: 'work', position: [-2.9, 0, -4.6], radius: 1.2 },
    { id: 'work-team-table', kind: 'work', position: [-3.7, 0, -11.4], radius: 1.4 },
    { id: 'queue-market-entry', kind: 'queue', position: [-3.2, 0, -0.5], radius: 1.0 },
    { id: 'queue-repair-entry', kind: 'queue', position: [2.5, 0, -1.8], radius: 1.0 },
    ...Array.from({ length: 17 }, (_, index) => ({
      id: `npc-spawn-${String(index + 1).padStart(2, '0')}`,
      kind: 'arrival',
      position: [npcPositions[index][0], 0, npcPositions[index][1]],
      radius: 0.65,
    })),
  ],
  paths: [
    { id: 'walk-main-street', points: [[0, 0, 4.2], [0.7, 0, 0.5], [2.2, 0, -3.2], [2.0, 0, -9.5], [-3.2, 0, -13.0], [-3.2, 0, -21.7], [0.6, 0, -24.5], [2.0, 0, -29.2], [3.4, 0, -33.5], [1.4, 0, -41.0], [-1.2, 0, -49.5], [0.8, 0, -58.0], [2.0, 0, -68.0]], purpose: 'walk', speed: 1.8 },
    { id: 'queue-market', points: [[-3.2, 0, -2], [-3.2, 0, -1.1], [-3.4, 0, 0.15], [-5.25, 0, 0.25]], purpose: 'queue', speed: 0.65 },
    { id: 'queue-builder-yard', points: [[2.0, 0, -3.7], [2.7, 0, -2.4], [3.25, 0, -0.45], [4.6, 0, -0.55]], purpose: 'queue', speed: 0.65 },
    { id: 'conversation-loop', points: [[0.7, 0, 0.5], [-2.9, 0, -4.6], [-1.0, 0, -4.6], [-1.0, 0, -6.6], [-2.3, 0, -8.8], [-2.3, 0, -14.2], [-3.2, 0, -15.2], [-3.2, 0, -21.7], [1.2, 0, -24.0], [-1.4, 0, -36.0], [1.0, 0, -48.0]], purpose: 'conversation', speed: 1.1 },
    { id: 'walk-outer-ring', points: [[-7.6, 0, -13.5], [-13.3, 0, -15.5], [-13.3, 0, -44.0], [-10.0, 0, -55.0], [-8.0, 0, -58.0], [0, 0, -60.0], [2.0, 0, -68.0]], purpose: 'walk', speed: 1.5 },
  ],
  colliders: [
    { id: 'obstruction-market', shape: 'box', position: [-5.6, 1.4, -4.2], size: [3.6, 2.8, 7.8] },
    { id: 'obstruction-workshop', shape: 'box', position: [5.9, 1.45, -5.7], size: [4.8, 2.9, 4.2] },
    { id: 'obstruction-community-board', shape: 'box', position: [-2.9, 0.825, -5.6], size: [2.3, 1.65, 0.18] },
    { id: 'obstruction-team-table', shape: 'capsule', position: [-3.7, 0.8, -11.4], size: [1.9, 1.6, 1.9] },
    { id: 'obstruction-team-pavilion-post-1', shape: 'capsule', position: [-6.1, 1.8, -13.1], size: [0.2, 3.6, 0.2] },
    { id: 'obstruction-team-pavilion-post-2', shape: 'capsule', position: [-1.3, 1.8, -13.1], size: [0.2, 3.6, 0.2] },
    { id: 'obstruction-team-pavilion-post-3', shape: 'capsule', position: [-6.1, 1.8, -9.7], size: [0.2, 3.6, 0.2] },
    { id: 'obstruction-team-pavilion-post-4', shape: 'capsule', position: [-1.3, 1.8, -9.7], size: [0.2, 3.6, 0.2] },
    { id: 'obstruction-transit', shape: 'box', position: [5.7, 1.9, -12.6], size: [6.2, 3.8, 4] },
    { id: 'obstruction-signal-tower', shape: 'capsule', position: [0, 3.2, -16.2], size: [4.8, 7.4, 4.8] },
    /*
     * Removed, deliberately. This was a 4.8 x 2.4 m solid block at ground
     * level standing in the middle of `north_cross_street`, which
     * art/atlas/environments/beacon-commons-v1/build_scene.py authors as
     * walkable ground from x -15.5 to 15.5.
     *
     * The only geometry there is `far_commons_sign`: 4.8 m wide, **0.18 m
     * thick**, hanging at y 2.15. A gantry sign over a street was being
     * collided with as a building thirteen times its depth.
     *
     * Measured consequence: at z -19 the three gaps across the whole street
     * were 0.5 m, 0.6 m and 0.6 m wide, so the player hit a wall about 18 m
     * from spawn and turned back. Beyond it the city opens to 19 m wide and
     * runs to z -70, with a south street, a far cross street and a horizon
     * street already built and dressed. A play test reported the city as "too
     * small and concised"; roughly fifty metres of it were behind this.
     */
    { id: 'obstruction-south-west', shape: 'box', position: [-8.8, 1.4, -27], size: [4.4, 2.8, 3.8] },
    { id: 'obstruction-south-east', shape: 'box', position: [8.4, 1.4, -27.2], size: [4.8, 2.8, 4.0] },
    { id: 'obstruction-tea-house', shape: 'box', position: [-7.8, 1.5, 3.9], size: [3.62, 3.4, 3.18] },
    { id: 'obstruction-map-house', shape: 'box', position: [-8.0, 1.5, -10.7], size: [4.02, 3.4, 3.58] },
    { id: 'obstruction-relay-house', shape: 'box', position: [7.9, 1.5, 2.2], size: [3.82, 3.4, 3.38] },
    { id: 'obstruction-ferry-house', shape: 'box', position: [8.1, 1.5, -10.0], size: [3.72, 3.4, 3.18] },
    { id: 'obstruction-north-block-west', shape: 'box', position: [-10.5, 1.1, -19.6], size: [4.0, 2.3, 3.4] },
    { id: 'obstruction-north-block-east', shape: 'box', position: [9.2, 1.1, -19.8], size: [4.4, 2.3, 3.6] },
    /*
     * Street furniture: trees, planters and posts.
     *
     * Found by sampling the environment mesh between 0.35 m and 1.70 m - the
     * band a walking player's body occupies - and diffing the occupied cells
     * against collider coverage. Thirteen clusters of solid geometry had no
     * collider at all, so the player walked straight through tree trunks
     * (65513b) and foliage (6f8e6e) in the middle of the street.
     *
     * Two rules decide what gets one, and four clusters are deliberately
     * absent because of them:
     *
     * - Canopy is not a wall. Sampling the 6f8e6e foliage put colliders under
     *   tree crowns; only the trunk is solid, so the sample skips that
     *   material.
     * - Nothing may block a place the player has to stand, or a lane the crowd
     *   is authored to walk. (3.75, -0.75) encloses the work-repair-core
     *   anchor, and three trunks stand on walk-outer-ring, walk-main-street
     *   and conversation-loop. A collider that makes an objective unreachable,
     *   or that walks citizens into a tree, is worse than the hole it fills.
     *   Those three trunks are still walk-through; fixing them means moving
     *   the authored lane, which is a crowd-design change, not a collider one.
     */
    { id: 'obstruction-prop-01', shape: 'box', position: [-6.5, 0.88, -8.5], size: [1.5, 1.75, 0.5] },
    { id: 'obstruction-prop-02', shape: 'capsule', position: [-8.75, 0.92, 6], size: [1, 1.83, 0.5] },
    { id: 'obstruction-prop-03', shape: 'capsule', position: [8.5, 0.94, 5.75], size: [0.5, 1.88, 1] },
    { id: 'obstruction-prop-04', shape: 'capsule', position: [-9.5, 0.92, -7], size: [0.5, 1.84, 0.5] },
    { id: 'obstruction-prop-05', shape: 'capsule', position: [9.25, 0.84, -8], size: [1, 1.69, 0.5] },
    { id: 'obstruction-prop-06', shape: 'capsule', position: [-8.5, 0.88, -8.5], size: [0.5, 1.75, 0.5] },
    { id: 'obstruction-prop-07', shape: 'capsule', position: [-2.5, 0.88, -20], size: [0.5, 1.75, 0.5] },
    { id: 'obstruction-prop-08', shape: 'capsule', position: [2.5, 0.88, -20], size: [0.5, 1.75, 0.5] },
    ...streetBlockColliders.map(([x, z], index) => ({ id: `obstruction-street-block-${index + 1}`, shape: 'box', position: [x, 3, z], size: [3.2, 6, 4.6] })),
  ],
  emitters: [
    { id: 'ambient-beacon', kind: 'ambient', position: [0, 4, -16], intensity: 0.8 },
    { id: 'lantern-market', kind: 'lantern', position: [-5.6, 2.7, -4.2], intensity: 1 },
    { id: 'restoration-signal', kind: 'restoration', position: [0, 6.2, -16.2], intensity: 0.6 },
  ],
};

const payHarborScene = {
  version: 1,
  districtId: 'pay-harbor',
  models: [
    { id: 'pay-harbor-environment', url: '/atlas/3d/v1/pay-harbor/environment.glb', contentType: 'model/gltf-binary' },
    { id: 'atlas-walker-player', url: '/atlas/3d/v2/characters/atlas-walker-v2-player.glb', contentType: 'model/gltf-binary' },
    { id: 'atlas-walker-npc-lod1', url: '/atlas/3d/v2/characters/atlas-walker-v2-lod1.glb', contentType: 'model/gltf-binary' },
    { id: 'atlas-walker-npc-lod2', url: '/atlas/3d/v2/characters/atlas-walker-v2-lod2.glb', contentType: 'model/gltf-binary' },
    { id: 'atlas-walker-npc-female-lod1', url: '/atlas/3d/v2/characters/atlas-walker-v2-female-lod1.glb', contentType: 'model/gltf-binary' },
    { id: 'atlas-walker-npc-female-lod2', url: '/atlas/3d/v2/characters/atlas-walker-v2-female-lod2.glb', contentType: 'model/gltf-binary' },
  ],
  instances: [
    { id: 'pay-harbor-environment-instance', modelId: 'pay-harbor-environment', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    { id: 'atlas-walker-player-instance', modelId: 'atlas-walker-player', position: [0, 0, 6.2], rotation: [0, 3.14159265359, 0], scale: [1, 1, 1] },
  ],
  navigation: {
    safeSpawn: [0, 0, 6.2],
    bounds: { minX: -8.8, maxX: 9.0, minZ: -7.0, maxZ: 7.2 },
    cameraHeadingRadians: Math.PI,
  },
  anchors: [
    { id: 'arrival-dock', kind: 'arrival', position: [0, 0, 6.2], radius: 1.3 },
    { id: 'mara-harbor-keeper', kind: 'conversation', position: [-1, 0, 0.5], radius: 1.2 },
    { id: 'lantern-counter', kind: 'mission', position: [-4.4, 0, -0.9], radius: 1.1 },
    { id: 'payment-review', kind: 'conversation', position: [-3.8, 0, -1.4], radius: 1 },
    { id: 'relay-pickup', kind: 'pickup', position: [2.1, 0, -1.3], radius: 1 },
    ...Array.from({ length: 6 }, (_, index) => ({ id: `station-${index + 1}-install`, kind: 'install', position: [4.3 + (index % 3) * 1.25, 0, -0.8 - Math.floor(index / 3) * 2.15], radius: 0.8 })),
    { id: 'builder-workbench', kind: 'work', position: [7, 0, 1.8], radius: 1.4 },
    { id: 'ferry-boarding', kind: 'travel', position: [0, 0, -5.7], radius: 2 },
    { id: 'beacon-return-gate', kind: 'travel', position: [0, 0, 6.2], radius: 1.4 },
    { id: 'conversation-market', kind: 'conversation', position: [-5.2, 0, 0.4], radius: 1.2 },
    { id: 'conversation-workshop', kind: 'conversation', position: [7, 0, 1.8], radius: 1.2 },
    { id: 'queue-lantern-counter', kind: 'queue', position: [-4.4, 0, -0.9], radius: 1 },
    { id: 'queue-relay-stations', kind: 'queue', position: [4.3, 0, -0.8], radius: 1 },
    { id: 'celebration-harbor-tower', kind: 'install', position: [0, 0, 3.6], radius: 1.5 },
    /*
     * Two offsets here exist to keep citizens out of solids, and both are
     * measured against CITIZEN_COLLISION_RADIUS_METERS (0.24) rather than
     * eyeballed.
     *
     * The lantern queue starts at x -3.95, not -5.2. At -5.2 the first citizen
     * spawned inside the market's collider, so it began its life stuck in a
     * wall. That was survivable while the harbor had almost no colliders and
     * is not now.
     *
     * The station workers stand at z -0.05, not -0.8. Their posts are at -0.8
     * and are now solid, so standing on the post means standing inside it.
     * They stand in front of it instead, which is also what a worker at a
     * station looks like.
     */
    ...Array.from({ length: 12 }, (_, index) => ({ id: `npc-spawn-${String(index + 1).padStart(2, '0')}`, kind: 'arrival', position: [index < 4 ? -3.95 + index * 0.6 : index < 8 ? 2.1 : 4.3 + (index - 8) * 1.25, 0, index < 4 ? 0.4 - index * 0.5 : index < 8 ? -1.3 - (index - 4) * 0.65 : -0.05], radius: 0.65 })),
  ],
  paths: [
    { id: 'arrival-to-keeper', points: [[0, 0, 6.2], [-1, 0, 0.5]], purpose: 'walk', speed: 1.8 },
    { id: 'keeper-to-counter', points: [[-1, 0, 0.5], [-4.4, 0, -0.9]], purpose: 'conversation', speed: 1.1 },
    { id: 'queue-lantern', points: [[-3.5, 0, -1.1], [-4.1, 0, -0.1], [-5.2, 0, 0.4]], purpose: 'queue', speed: 0.65 },
    { id: 'queue-installation', points: [[2.1, 0, -1.3], [4.3, 0, -0.8], [5.55, 0, -0.8], [6.8, 0, -2.95]], purpose: 'queue', speed: 0.65 },
    { id: 'restoration-loop', points: [[2.1, 0, -1.3], [0, 0, 3.6], [0, 0, -5.7]], purpose: 'celebration', speed: 1.4 },
  ],
  colliders: [
    { id: 'obstruction-market', shape: 'box', position: [-6.7, 1.25, 1], size: [4.7, 2.5, 3.4] },
    { id: 'obstruction-ferry', shape: 'box', position: [0, 1.15, -8.5], size: [5.2, 1.4, 2.2] },
    { id: 'obstruction-builder-workshop', shape: 'box', position: [7, 0.75, 1.8], size: [3.2, 1.5, 1.3] },
    { id: 'obstruction-tower', shape: 'capsule', position: [0, 2.4, 3.6], size: [2.4, 4.8, 2.4] },
    /*
     * A play test on a phone reported walking straight through the harbor.
     * Pay Harbor had four colliders against Beacon Commons' thirty-one, so
     * most of what the build script authors as solid was not solid at all.
     *
     * These are transcribed from the same literals in
     * art/atlas/environments/pay-harbor-v1/build_scene.py, which is where the
     * geometry is authored. They are checked against every anchor before being
     * added: a collider that swallows an anchor trades a cosmetic bug for an
     * unwinnable one.
     *
     * The rule applied is **body height blocks, low platforms do not**. The
     * lantern counter (1.7 m), the relay posts (1.4 m) and the keeper's marker
     * (2.35 m) are things you walk into. The docks (0.9 m) and the ferry
     * platform (0.7 m) are things you step onto, and `dock_right` carries the
     * station-5 and station-6 install anchors, so making it solid would put
     * two objectives inside a wall.
     */
    { id: 'obstruction-lantern-counter', shape: 'box', position: [-4.4, 0.85, -0.9], size: [2.0, 1.7, 1.0] },
    { id: 'obstruction-keeper-marker', shape: 'capsule', position: [-1.0, 1.28, 0.5], size: [0.28, 2.35, 0.28] },
    ...[0, 1, 2, 3, 4, 5].map((index) => ({
      id: `obstruction-relay-station-${index + 1}`,
      shape: 'capsule',
      position: [4.3 + (index % 3) * 1.25, 0.95, -0.8 - Math.floor(index / 3) * 2.15],
      size: [0.56, 1.4, 0.56],
    })),
  ],
  emitters: [
    { id: 'harbor-ambient', kind: 'ambient', position: [0, 3, -2], intensity: 0.8 },
    { id: 'lantern-counter-light', kind: 'lantern', position: [-4.4, 1.7, -0.9], intensity: 1 },
    { id: 'restoration-light', kind: 'restoration', position: [0, 4.8, 3.6], intensity: 0.7 },
    { id: 'harbor-water', kind: 'water', position: [0, 0, -10], intensity: 0.5 },
  ],
};

const currentScene = district === 'pay-harbor' ? payHarborScene : scene;

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    execFile(command, commandArgs, { cwd: root, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${command} ${commandArgs.join(' ')} failed: ${stderr || stdout || error.message}`));
    });
  });
}

async function resolvePython() {
  const localAppData = process.env.LOCALAPPDATA;
  const candidates = [
    { command: 'python.exe', args: ['--version'] },
    { command: 'python', args: ['--version'] },
    { command: 'py.exe', args: ['-3', '--version'] },
    { command: 'py', args: ['-3', '--version'] },
    ...(localAppData ? [{ command: join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe'), args: ['--version'] }] : []),
    { command: 'C:\\Users\\bless\\AppData\\Local\\Programs\\Python\\Python312\\python.exe', args: ['--version'] },
  ];
  for (const candidate of candidates) {
    try {
      await run(candidate.command, candidate.args);
      return candidate;
    } catch {
      // Try the next installed interpreter without changing the user's environment.
    }
  }
  throw new Error('Python 3.10 or newer is required to build the native procedural Atlas assets.');
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function stage(source, target) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function writeScene() {
  await mkdir(dirname(scenePath), { recursive: true });
  await writeFile(scenePath, `${JSON.stringify(currentScene, null, 2)}\n`, 'utf8');
}

async function stageRuntime() {
  await stage(join(characterSource, 'atlas-walker-v1.glb'), join(publicRoot, 'characters', 'atlas-walker-player.glb'));
  await stage(join(characterSource, 'atlas-walker-npc-lod1.glb'), join(publicRoot, 'characters', 'atlas-walker-npc-lod1.glb'));
  await stage(join(characterSource, 'atlas-walker-npc-lod2.glb'), join(publicRoot, 'characters', 'atlas-walker-npc-lod2.glb'));
  const source = district === 'pay-harbor' ? payHarborSource : environmentSource;
  await stage(join(source, district === 'pay-harbor' ? 'pay-harbor-v1.glb' : 'beacon-commons-v1.glb'), join(publicRoot, district, 'environment.glb'));
  await writeScene();
}

async function updateManifest() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const owned = [
    ['atlas-walker-player', join(publicRoot, 'characters', 'atlas-walker-player.glb'), 'art/atlas/characters/atlas-walker-v1/build_character.py'],
    ['atlas-walker-npc-lod1', join(publicRoot, 'characters', 'atlas-walker-npc-lod1.glb'), 'art/atlas/characters/atlas-walker-v1/build_character.py'],
    ['atlas-walker-npc-lod2', join(publicRoot, 'characters', 'atlas-walker-npc-lod2.glb'), 'art/atlas/characters/atlas-walker-v1/build_character.py'],
    [district === 'pay-harbor' ? 'pay-harbor-environment' : 'beacon-commons-environment', join(publicRoot, district, 'environment.glb'), district === 'pay-harbor' ? 'art/atlas/environments/pay-harbor-v1/build_scene.py' : 'art/atlas/environments/beacon-commons-v1/build_scene.py'],
    [`${district}-scene`, scenePath, 'scripts/build-atlas-3d.mjs'],
  ];
  const entries = [];
  for (const [id, path, sourceFile] of owned) {
    const bytes = await readFile(path);
    const relativePath = `/${relative(join(root, 'public'), path).split(String.fromCharCode(92)).join('/')}`;
    const sourcePath = join(root, sourceFile);
    entries.push({
      id,
      path: relativePath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      compressedBytes: bytes.length,
      mime: id.endsWith('-scene') ? 'application/json' : 'model/gltf-binary',
      width: 1,
      height: 1,
      bundle: id.includes('beacon-commons') ? 'atlas-beacon-commons' : id.includes('pay-harbor') ? 'atlas-pay-harbor' : 'atlas-character',
      ...(id.endsWith('-scene') ? {} : {
        quality: ['low', 'balanced', 'high'],
        sourceFile,
        sourceSha256: await sha256(sourcePath),
        sourceStatus: 'owner-approved-procedural',
      }),
    });
  }
  const ownedIds = new Set(owned.map(([id]) => id));
  manifest.assets = [...manifest.assets.filter((asset) => !ownedIds.has(asset.id)), ...entries];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function fileHashes() {
  const paths = [
    join(publicRoot, 'characters', 'atlas-walker-player.glb'),
    join(publicRoot, 'characters', 'atlas-walker-npc-lod1.glb'),
    join(publicRoot, 'characters', 'atlas-walker-npc-lod2.glb'),
    join(publicRoot, district, 'environment.glb'),
    scenePath,
  ];
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [relative(root, path), await sha256(path)])));
}

const skipPython = args.get('--skip-python') === true;
const python = skipPython ? null : await resolvePython();
const runHashes = [];
for (let iteration = 0; iteration < repeat; iteration += 1) {
  if (python) {
    await run(python.command, [...python.args.filter((value) => value !== '--version'), join('art', 'atlas', 'characters', 'atlas-walker-v1', 'build_character.py')]);
    await run(python.command, [...python.args.filter((value) => value !== '--version'), join('art', 'atlas', 'environments', district === 'pay-harbor' ? 'pay-harbor-v1' : 'beacon-commons-v1', 'build_scene.py')]);
  }
  await stageRuntime();
  runHashes.push(await fileHashes());
}

const firstHashes = JSON.stringify(runHashes[0]);
if (runHashes.some((value) => JSON.stringify(value) !== firstHashes)) throw new Error('Native 3D runtime exports are not byte-identical across repeated generation runs.');
await updateManifest();
if (!skipPython) await run(process.execPath, ['scripts/verify-atlas-3d.mjs', '--district', district]);
console.log(JSON.stringify({ district, repeat, hashes: runHashes[0] }, null, 2));
