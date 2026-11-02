// Generates PWA / home-screen icons from the pixel-art gun (nearest-neighbour upscale).
// Usage: node tools/gen_icons.mjs   (Node built-ins only)
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'icons');

// ---------- PNG decode (8-bit RGBA / RGB, non-interlaced) ----------
function decodePng(buf) {
  let pos = 8, width = 0, height = 0, colorType = 0, bitDepth = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) throw new Error('unsupported PNG format');
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    raw.copy(cur, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = cur[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = cur[x * bpp]; out[o + 1] = cur[x * bpp + 1]; out[o + 2] = cur[x * bpp + 2]; out[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    cur.copy(prev);
  }
  return { width, height, data: out };
}

// ---------- PNG encode (RGBA) ----------
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(b) { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- compose ----------
const BG_TOP = [0x2a, 0x34, 0x7a], BG_BOTTOM = [0x14, 0x18, 0x36];
function makeIcon(src, size, { contentRatio, rounded }) {
  const out = Buffer.alloc(size * size * 4);
  const radius = rounded ? size * 0.18 : 0;
  for (let y = 0; y < size; y++) {
    const k = y / (size - 1);
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      let inside = true;
      if (radius) {
        const cx = Math.min(Math.max(x, radius), size - 1 - radius), cy = Math.min(Math.max(y, radius), size - 1 - radius);
        inside = (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
      }
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(BG_TOP[c] * (1 - k) + BG_BOTTOM[c] * k);
      out[o + 3] = inside ? 255 : 0;
    }
  }
  const scale = Math.max(1, Math.floor((size * contentRatio) / src.width));
  const dw = src.width * scale, dh = src.height * scale;
  const ox = Math.floor((size - dw) / 2), oy = Math.floor((size - dh) / 2);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const s = (Math.floor(y / scale) * src.width + Math.floor(x / scale)) * 4;
    const a = src.data[s + 3] / 255;
    if (!a) continue;
    const o = ((oy + y) * size + ox + x) * 4;
    if (!out[o + 3]) continue;
    for (let c = 0; c < 3; c++) out[o + c] = Math.round(src.data[s + c] * a + out[o + c] * (1 - a));
  }
  return encodePng(size, size, out);
}

const gun = decodePng(fs.readFileSync(path.join(root, 'assets/gun_r7.png')));
fs.mkdirSync(outDir, { recursive: true });
const jobs = [
  ['icon-192.png', 192, { contentRatio: 0.8, rounded: true }],
  ['icon-512.png', 512, { contentRatio: 0.8, rounded: true }],
  ['maskable-192.png', 192, { contentRatio: 0.6, rounded: false }], // safe zone = inner 80%
  ['maskable-512.png', 512, { contentRatio: 0.6, rounded: false }],
  ['apple-touch-icon.png', 180, { contentRatio: 0.75, rounded: false }], // iOS rounds corners itself
  ['favicon-32.png', 32, { contentRatio: 1, rounded: false }],
];
for (const [name, size, opt] of jobs) {
  fs.writeFileSync(path.join(outDir, name), makeIcon(gun, size, opt));
  console.log(`icons/${name} ${size}x${size}`);
}
