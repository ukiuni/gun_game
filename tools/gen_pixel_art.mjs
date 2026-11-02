import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

// Deterministic, dependency-free RGBA pixel art and PNG encoder.
const output = new URL('../assets/', import.meta.url);
mkdirSync(output, { recursive: true });
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type), result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); tag.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([tag, data])), data.length + 8);
  return result;
}
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ink = '#171b2b';
function rgba(hex) {
  if (Array.isArray(hex)) return hex;
  return [...hex.slice(1).match(/../g).map(x => parseInt(x, 16)), 255];
}
function canvas(w, h) {
  const pixels = Buffer.alloc(w * h * 4);
  const p = (x, y, color) => {
    if (x >= 0 && y >= 0 && x < w && y < h) pixels.set(rgba(color), (y * w + x) * 4);
  };
  const rect = (x, y, width, height, color) => {
    for (let j = y; j < y + height; j++) for (let i = x; i < x + width; i++) p(i, j, color);
  };
  const ellipse = (x, y, rx, ry, color) => {
    for (let j = Math.ceil(y - ry); j <= y + ry; j++)
      for (let i = Math.ceil(x - rx); i <= x + rx; i++)
        if (((i - x) / rx) ** 2 + ((j - y) / ry) ** 2 <= 1) p(i, j, color);
  };
  const outline = () => {
    const copy = Buffer.from(pixels);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (copy[(y * w + x) * 4 + 3]) continue;
      if ([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => {
        const a = x + dx, b = y + dy;
        return a >= 0 && b >= 0 && a < w && b < h && copy[(b * w + a) * 4 + 3];
      })) p(x, y, ink);
    }
  };
  return { w, h, pixels, p, rect, ellipse, outline };
}
const produced = [];
function save(name, c) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(c.w); header.writeUInt32BE(c.h, 4);
  header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(c.h * (c.w * 4 + 1));
  for (let y = 0; y < c.h; y++) c.pixels.copy(rows, y * (c.w * 4 + 1) + 1, y * c.w * 4, (y + 1) * c.w * 4);
  writeFileSync(new URL(name, output), Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
  produced.push([name, c.w, c.h]);
}
function sparkle(c, x, y, color = '#fff4ba') {
  c.rect(x - 2, y, 5, 1, color); c.rect(x, y - 2, 1, 5, color);
}
const themes = [
  ['#778596','#cbd5df','#465265'], ['#409552','#a0ed82','#225139'],
  ['#367fce','#8bdcff','#23466f'], ['#9254cc','#e2a6ff','#512d7d'],
  ['#eb8a31','#ffe18b','#934624'], ['#d6474d','#ffaaa0','#7c263c'],
  ['#e6b638','#fff2a0','#936122'],
];
for (let rank = 1; rank <= 7; rank++) {
  const c = canvas(32, 32), [main, light, dark] = themes[rank - 1];
  // Right-facing turret: rotating pedestal, armored receiver, extended barrel.
  c.rect(7, 26, 17, 3, dark); c.rect(9, 25, 13, 1, light);
  c.rect(12, 21, 7, 4, '#536273'); c.rect(13, 21, 2, 4, '#a6b7c5');
  c.rect(6, 13, 14, 8, main); c.rect(8, 11, 10, 2, main);
  c.rect(8, 12, 9, 1, light); c.rect(7, 14, 2, 5, light);
  c.rect(9, 19, 11, 2, dark); c.rect(18, 14, 11, 4, dark);
  c.rect(19, 14, 10, 1, light); c.rect(28, 14, 1, 4, '#394556');
  c.ellipse(13, 16, 3, 3, ink); c.ellipse(13, 16, 2, 2, dark); c.p(12, 15, light);
  if (rank >= 2) { c.rect(5, 15, 2, 4, dark); c.rect(10, 9, 5, 2, dark); c.rect(11, 9, 3, 1, light); }
  if (rank >= 3) { c.rect(21, 13, 2, 6, main); c.rect(25, 13, 2, 6, main); c.p(21, 13, light); c.p(25, 13, light); }
  if (rank >= 4) { c.rect(16, 8, 3, 4, dark); c.rect(17, 8, 1, 2, light); c.rect(5, 11, 2, 3, main); }
  if (rank >= 5) { c.rect(19, 10, 10, 2, main); c.rect(20, 10, 8, 1, light); c.rect(10, 22, 2, 3, main); c.rect(20, 22, 2, 3, main); }
  if (rank >= 6) { c.rect(3, 13, 2, 7, dark); c.rect(3, 13, 1, 5, light); c.rect(20, 20, 7, 2, main); c.rect(21, 20, 5, 1, light); }
  if (rank === 7) { c.rect(8, 7, 7, 2, main); c.rect(8, 5, 1, 2, light); c.rect(11, 4, 1, 3, light); c.rect(14, 5, 1, 2, light); }
  c.outline();
  if (rank === 7) { sparkle(c, 25, 5); sparkle(c, 4, 25); }
  save(`gun_r${rank}.png`, c);
}
{
  const c = canvas(16, 16);
  c.ellipse(7.5, 7.5, 6.5, 6.5, '#a86720'); c.ellipse(7, 7, 5.5, 5.5, '#f1b936');
  c.ellipse(7, 7, 4, 4, '#b97e24'); c.ellipse(7, 7, 3, 3, '#ffd65a');
  c.rect(7, 5, 1, 5, '#fff1a2'); c.rect(6, 5, 2, 1, '#fff1a2'); c.rect(6, 9, 3, 1, '#fff1a2');
  c.outline(); c.rect(4, 3, 3, 1, '#fff7c7'); c.p(3, 4, '#fff7c7'); save('coin.png', c);
}
{
  const c = canvas(256, 32);
  for (let f = 0; f < 8; f++) {
    const frame = canvas(32, 32), radius = [3, 6, 10, 13, 13, 12, 11, 10][f];
    if (f < 5) {
      frame.ellipse(15, 16, radius, radius * .85, f < 4 ? '#d34528' : '#9e5141');
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4 + f * .3;
        frame.ellipse(Math.round(15 + Math.cos(a) * radius * .65), Math.round(16 + Math.sin(a) * radius * .65), Math.max(1, radius * .32), Math.max(1, radius * .32), '#f17b2d');
      }
      frame.ellipse(15, 16, Math.max(1, radius * .65), Math.max(1, radius * .55), '#ffcc49');
      frame.ellipse(14, 15, Math.max(1, radius * .32), Math.max(1, radius * .36), '#fff4b5');
    }
    if (f >= 4) {
      const alpha = [220, 170, 105, 45][f - 4];
      for (let k = 0; k < 5; k++) {
        const x = 7 + ((k * 7) % 17), y = 8 + ((k * 5 + f) % 15) - (f - 4);
        frame.ellipse(x, y, 4 + (k % 2), 4, [91 + k * 8, 87 + k * 8, 94 + k * 8, alpha]);
        frame.ellipse(x - 1, y - 1, 2, 2, [145, 140, 147, alpha]);
      }
    }
    for (let y = 0; y < 32; y++) frame.pixels.copy(c.pixels, (y * 256 + f * 32) * 4, y * 128, (y + 1) * 128);
  }
  save('explosion.png', c);
}
{
  const c = canvas(16, 16);
  c.rect(1, 6, 10, 4, '#ef8d29'); c.rect(5, 3, 3, 10, '#ef8d29');
  c.rect(8, 5, 5, 6, '#ffbf3e'); c.rect(12, 7, 3, 2, '#ffbf3e');
  c.rect(3, 6, 7, 4, '#ffe874'); c.rect(6, 4, 1, 8, '#ffe874'); c.rect(1, 7, 10, 2, '#fffbe0');
  c.p(10, 2, '#f4a336'); c.p(11, 12, '#f4a336'); save('muzzle.png', c);
}
for (const [name, main, light, dark] of [['enemy_badge.png','#d94954','#ffabb0','#7b283c'], ['player_badge.png','#398ad7','#a2e4ff','#254a85']]) {
  const c = canvas(16, 16);
  c.rect(3, 2, 10, 7, main); c.rect(4, 9, 8, 2, main); c.rect(5, 11, 6, 1, main); c.rect(6, 12, 4, 1, main); c.rect(7, 13, 2, 1, main);
  c.rect(8, 3, 4, 6, dark); c.rect(8, 9, 3, 2, dark); c.p(8, 11, dark);
  c.rect(4, 3, 7, 1, light); c.rect(4, 4, 1, 4, light);
  c.rect(7, 5, 2, 5, '#f4f1dd'); c.rect(6, 6, 4, 2, '#f4f1dd'); c.outline(); save(name, c);
}
{
  const font = {
    G: ['01110','11001','11000','11011','11001','11001','01110'],
    U: ['11001','11001','11001','11001','11001','11001','01110'],
    N: ['11001','11101','11101','11011','11011','11001','11001'],
    M: ['10001','11011','11111','10101','10001','10001','10001'],
    E: ['11111','11000','11000','11110','11000','11000','11111'],
    R: ['11110','11001','11001','11110','11100','11010','11001'],
  };
  const c = canvas(128, 32); let x = 13;
  for (const ch of 'GUN MERGE') {
    if (ch === ' ') { x += 8; continue; }
    font[ch].forEach((row, y) => [...row].forEach((v, dx) => {
      if (v === '1') c.rect(x + dx * 2 + 1, 10 + y * 2 + 2, 2, 2, '#79462a');
    }));
    font[ch].forEach((row, y) => [...row].forEach((v, dx) => {
      if (v === '1') c.rect(x + dx * 2, 8 + y * 2, 2, 2, y < 2 ? '#fff0a0' : y < 4 ? '#f6c44d' : '#e79031');
    }));
    x += 12;
  }
  c.outline(); save('logo.png', c);
}
// Read every output back: validate signature, header, all CRCs, and pixel data.
for (const [name, w, h] of produced) {
  const data = readFileSync(new URL(name, output));
  if (!data.subarray(0, 8).equals(signature) || data.toString('ascii', 12, 16) !== 'IHDR' || data.readUInt32BE(16) !== w || data.readUInt32BE(20) !== h || data[24] !== 8 || data[25] !== 6) throw new Error(`Invalid PNG: ${name}`);
  let offset = 8, idat = [], ended = false;
  while (offset < data.length) {
    const size = data.readUInt32BE(offset), type = data.toString('ascii', offset + 4, offset + 8);
    if (crc32(data.subarray(offset + 4, offset + 8 + size)) !== data.readUInt32BE(offset + 8 + size)) throw new Error(`CRC failed: ${name}`);
    if (type === 'IDAT') idat.push(data.subarray(offset + 8, offset + 8 + size));
    if (type === 'IEND') ended = true;
    offset += size + 12;
  }
  if (!ended || inflateSync(Buffer.concat(idat)).length !== h * (w * 4 + 1)) throw new Error(`Invalid pixels: ${name}`);
  console.log(`assets/${name}: ${w}x${h}`);
}
