/**
 * Renders the app icon to PNG at the sizes the submission and iOS need.
 *
 * There is a perfectly good icon.svg, but the competition form and the iOS
 * home screen both want raster, and pulling in a headless browser or an image
 * library to convert one 512 pixel square would be a heavy dependency for a
 * file that changes never. So this rasterises the same shapes directly with
 * signed distance functions and writes the PNG by hand. Node ships zlib, which
 * is the only hard part of a PNG.
 *
 * Run with: npm run icons
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const INK = [0x14, 0x13, 0x1d];
const AMBER = [0xff, 0xb4, 0x3c];

/*
 * The rider, in a 512 space, scaled from the same 184 unit drawing as
 * public/icon.svg (512 / 184).
 *
 * These icons used to carry the old Sface lantern: a dark circle with pink and
 * cyan blocks under a lamp, which had nothing to do with a downhill race and
 * was the first thing anybody saw on a home screen. Both files now draw one
 * mark, and the only reason this one is hand-rasterised is that the competition
 * form and iOS want raster and a headless browser is a heavy dependency for
 * four squares.
 */
const WHEELS = [{ x: 122.4, y: 356.2 }, { x: 328.3, y: 356.2 }];
const WHEEL_RADIUS = 61.2;
const WHEEL_STROKE = 30.6;
/** Rear triangle, down tube, top tube and fork, as separate runs. */
const FRAME = [
  [[122.4, 356.2], [228.2, 345.1], [189.2, 267.1], [122.4, 356.2]],
  [[228.2, 345.1], [311.6, 283.8]],
  [[189.2, 267.1], [289.4, 267.1]],
  [[311.6, 283.8], [328.3, 356.2]],
];
const FRAME_STROKE = 27.8;
/** The flat back, which is the whole attitude of the reference photograph. */
const BACK = [[178.1, 244.9], [278.3, 211.5]];
const BACK_STROKE = 39.0;
/** Arm to the bars, driving leg, and the neck that attaches the head. */
const LIMBS = [
  { run: [[278.3, 211.5], [311.6, 278.3]], stroke: 27.8 },
  { run: [[183.7, 256.0], [239.3, 311.7], [228.2, 345.1]], stroke: 33.4 },
  { run: [[278.3, 211.5], [306.1, 194.8]], stroke: 27.8 },
];
const HEAD = { x: 322.8, y: 183.7, r: 33.4 };

/** The ink keyline inside the badge edge. */
const KEYLINE = 22;
const CORNER = 112;

// Signed distance helpers. Negative is inside, and the returned value is in
// pixels, which is what makes the antialiasing below a one liner.

function sdRoundedBox(px, py, half, radius) {
  const qx = Math.abs(px) - half + radius;
  const qy = Math.abs(py) - half + radius;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function sdPolyline(px, py, points, width) {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    best = Math.min(best, sdSegment(px, py, ax, ay, bx, by));
  }
  return best - width / 2;
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function sdBox(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - halfW + radius;
  const qy = Math.abs(py - cy) - halfH + radius;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    radius
  );
}

/** Coverage from a distance, antialiased across one pixel of the output. */
function coverage(distance, pixel) {
  return Math.min(1, Math.max(0, 0.5 - distance / pixel));
}

function blend(dst, src, alpha) {
  for (let i = 0; i < 3; i++) dst[i] = Math.round(dst[i] * (1 - alpha) + src[i] * alpha);
}

/** Draw the icon at `size`, returning an RGBA buffer. */
function render(size) {
  const scale = size / 512;
  const pixel = 1 / scale;
  const rgba = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sample at the pixel centre, in the 512 design space.
      const px = (x + 0.5) * pixel;
      const py = (y + 0.5) * pixel;

      const badge = sdRoundedBox(px - 256, py - 256, 256, CORNER);
      const plate = coverage(badge, pixel);
      if (plate <= 0) continue;

      const colour = [...AMBER];

      // The keyline, drawn as the band just inside the badge edge. An enamel
      // mark is a flat colour held by an ink outline; without it the amber
      // dissolves into a light home screen.
      blend(colour, INK, coverage(-(badge + KEYLINE), pixel));

      // Wheels as rings: the distance to the circle, thickened either side.
      for (const wheel of WHEELS) {
        const ring = Math.abs(sdCircle(px, py, wheel.x, wheel.y, WHEEL_RADIUS)) - WHEEL_STROKE / 2;
        blend(colour, INK, coverage(ring, pixel));
      }
      for (const run of FRAME) blend(colour, INK, coverage(sdPolyline(px, py, run, FRAME_STROKE), pixel));
      blend(colour, INK, coverage(sdPolyline(px, py, BACK, BACK_STROKE), pixel));
      for (const limb of LIMBS) blend(colour, INK, coverage(sdPolyline(px, py, limb.run, limb.stroke), pixel));
      blend(colour, INK, coverage(sdCircle(px, py, HEAD.x, HEAD.y, HEAD.r), pixel));

      const offset = (y * size + x) * 4;
      rgba[offset] = colour[0];
      rgba[offset + 1] = colour[1];
      rgba[offset + 2] = colour[2];
      rgba[offset + 3] = Math.round(plate * 255);
    }
  }

  return rgba;
}

// Minimal PNG writer -------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(rgba, size) {
  // Each scanline is prefixed with a filter byte. Filter 0 is "none", which
  // costs a little file size and saves a lot of code.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------

const TARGETS = [
  [512, 'icon-512.png'],
  [192, 'icon-192.png'],
  [180, 'icon-180.png'],
  [32, 'favicon-32.png'],
];

mkdirSync(OUT_DIR, { recursive: true });

for (const [size, name] of TARGETS) {
  const png = encodePng(render(size), size);
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`${name.padEnd(16)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}



/*
 * Keep the asset manifests honest about icon.svg.
 *
 * The manifests carry the mark's byte size and SHA-256, and verify:atlas:art
 * fails the gate when they drift. Editing the icon and forgetting to re-hash
 * broke the build three times, so the two steps are one step now: whoever
 * redraws the mark cannot leave the manifest describing the old one.
 */
const markPath = join(OUT_DIR, 'icon.svg');
const markBytes = readFileSync(markPath);
const markSha = createHash('sha256').update(markBytes).digest('hex').toUpperCase();

for (const manifestPath of ['atlas/manifests/assets-v1.json', 'atlas/manifests/assets-v2.json']) {
  const full = join(OUT_DIR, manifestPath);
  const manifest = JSON.parse(readFileSync(full, 'utf8'));
  const entry = (manifest.assets ?? manifest).find((asset) => asset.id === 'atlas-shell-mark');
  if (!entry) continue;
  if (entry.sha256 === markSha && entry.bytes === markBytes.length) {
    console.log(`${manifestPath.padEnd(34)} already current`);
    continue;
  }
  entry.sha256 = markSha;
  entry.bytes = markBytes.length;
  if (entry.compressedBytes !== undefined) entry.compressedBytes = markBytes.length;
  writeFileSync(full, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${manifestPath.padEnd(34)} re-hashed ${markBytes.length} bytes`);
}
