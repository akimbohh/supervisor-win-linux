// Generate the home-screen / favicon PNG family for Supervisor.
// Pure Node — no native dep. Renders the same dark-rounded-square + amber
// "layers" icon as web/icons/icon.svg into PNGs at the sizes iOS / Android /
// browsers actually want.
//
//   node tools/gen-icons.js
//
// Outputs:  web/icons/icon-{180,192,256,384,512}.png  +  favicon.png

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// ── PNG encoder (8-bit RGBA, single IDAT, no interlace) ──────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  // Apply filter byte 0 (none) at the start of each scanline.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── Drawing helpers (with sub-pixel coverage AA) ──────────────────────

function blend(rgba, x, y, w, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= w || a === 0) return;
  const i = (y * w + x) * 4;
  const sa = a / 255;
  const da = rgba[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  rgba[i]     = Math.round((r * sa + rgba[i]     * da * (1 - sa)) / oa);
  rgba[i + 1] = Math.round((g * sa + rgba[i + 1] * da * (1 - sa)) / oa);
  rgba[i + 2] = Math.round((b * sa + rgba[i + 2] * da * (1 - sa)) / oa);
  rgba[i + 3] = Math.round(oa * 255);
}

// Coverage of pixel (x,y) by a 4×4 sub-pixel sampler — fn(sx,sy)→bool inside?
function coveragePixel(x, y, fn) {
  let hits = 0;
  const STEPS = 4;
  for (let sy = 0; sy < STEPS; sy++) {
    for (let sx = 0; sx < STEPS; sx++) {
      const px = x + (sx + 0.5) / STEPS;
      const py = y + (sy + 0.5) / STEPS;
      if (fn(px, py)) hits++;
    }
  }
  return hits / (STEPS * STEPS);
}

function fillShape(rgba, w, h, color, fn) {
  const [r, g, b, a] = color;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cov = coveragePixel(x, y, fn);
      if (cov > 0) blend(rgba, x, y, w, [r, g, b, Math.round(a * cov)]);
    }
  }
}

function fillRoundRect(rgba, w, h, x0, y0, rectW, rectH, radius, color) {
  const x1 = x0 + rectW, y1 = y0 + rectH;
  const inside = (px, py) => {
    if (px < x0 || px > x1 || py < y0 || py > y1) return false;
    // Corners
    const r = radius;
    if (px < x0 + r && py < y0 + r) return Math.hypot(px - (x0 + r), py - (y0 + r)) <= r;
    if (px > x1 - r && py < y0 + r) return Math.hypot(px - (x1 - r), py - (y0 + r)) <= r;
    if (px < x0 + r && py > y1 - r) return Math.hypot(px - (x0 + r), py - (y1 - r)) <= r;
    if (px > x1 - r && py > y1 - r) return Math.hypot(px - (x1 - r), py - (y1 - r)) <= r;
    return true;
  };
  fillShape(rgba, w, h, color, inside);
}

// Wide rhombus (diamond) — tip up/down, sides centered.
function fillRhombus(rgba, w, h, cx, cy, halfW, halfH, color) {
  const inside = (px, py) =>
    Math.abs(px - cx) / halfW + Math.abs(py - cy) / halfH <= 1;
  fillShape(rgba, w, h, color, inside);
}

// ── Compose the icon ──────────────────────────────────────────────────

function renderIcon(size) {
  const w = size, h = size;
  const rgba = Buffer.alloc(w * h * 4);   // transparent

  // Dark rounded background.
  const bgRadius = Math.round(size * 0.1875);
  fillRoundRect(rgba, w, h, 0, 0, w, h, bgRadius, [0x0a, 0x0a, 0x0b, 0xff]);

  // Three stacked amber rhombuses (the "layers" feel).
  const accent = [0xf5, 0x9e, 0x0b, 0xff];
  const cx = w / 2;
  const halfW = size * 0.30;       // 60% wide
  const halfH = size * 0.075;      // 15% tall each
  const gap = size * 0.04;         // gap between
  // Stack vertical centers.
  const totalH = halfH * 6 + gap * 2;   // (halfH*2 each) * 3 + 2 gaps
  const topCy = (h - totalH) / 2 + halfH;
  for (let i = 0; i < 3; i++) {
    const cy = topCy + i * (halfH * 2 + gap);
    fillRhombus(rgba, w, h, cx, cy, halfW, halfH, accent);
  }

  return rgba;
}

// ── Run ───────────────────────────────────────────────────────────────

const OUT = path.join(__dirname, '..', 'web', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const sizes = [180, 192, 256, 384, 512];   // 180 = iOS apple-touch-icon
for (const s of sizes) {
  const rgba = renderIcon(s);
  const png = encodePng(s, s, rgba);
  fs.writeFileSync(path.join(OUT, 'icon-' + s + '.png'), png);
  console.log('wrote icon-' + s + '.png  (' + png.length + ' bytes)');
}
// favicon at 64
const fav = encodePng(64, 64, renderIcon(64));
fs.writeFileSync(path.join(OUT, 'favicon.png'), fav);
console.log('wrote favicon.png  (' + fav.length + ' bytes)');
