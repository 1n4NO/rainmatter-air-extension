import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const sizes = [16, 32, 48, 128];
await fs.mkdir('icons', { recursive: true });

for (const size of sizes) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = size / 128;
  roundedRect(pixels, size, 4 * scale, 4 * scale, 120 * scale, 120 * scale, 28 * scale, [8, 17, 31, 255]);
  roundedRect(pixels, size, 14 * scale, 14 * scale, 100 * scale, 100 * scale, 22 * scale, [23, 42, 72, 255]);
  line(pixels, size, 28 * scale, 44 * scale, 91 * scale, 44 * scale, 8 * scale, [125, 169, 255, 255]);
  line(pixels, size, 37 * scale, 64 * scale, 101 * scale, 64 * scale, 8 * scale, [125, 169, 255, 255]);
  line(pixels, size, 26 * scale, 84 * scale, 78 * scale, 84 * scale, 8 * scale, [125, 169, 255, 255]);
  circle(pixels, size, 95 * scale, 85 * scale, 15 * scale, [52, 211, 153, 255]);
  await fs.writeFile(path.join('icons', `icon-${size}.png`), encodePng(size, size, pixels));
}

console.log(`Generated ${sizes.length} extension icons.`);

function roundedRect(pixels, size, x, y, width, height, radius, color) {
  for (let py = Math.floor(y); py < Math.ceil(y + height); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x + width); px++) {
      const cx = Math.max(x + radius, Math.min(px, x + width - radius));
      const cy = Math.max(y + radius, Math.min(py, y + height - radius));
      if ((px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2) setPixel(pixels, size, px, py, color);
    }
  }
}

function line(pixels, size, x1, y1, x2, y2, width, color) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  for (let step = 0; step <= steps; step++) {
    const amount = step / steps;
    circle(pixels, size, x1 + (x2 - x1) * amount, y1 + (y2 - y1) * amount, width / 2, color);
  }
}

function circle(pixels, size, cx, cy, radius, color) {
  for (let py = Math.floor(cy - radius); py <= Math.ceil(cy + radius); py++) {
    for (let px = Math.floor(cx - radius); px <= Math.ceil(cx + radius); px++) {
      if ((px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2) setPixel(pixels, size, px, py, color);
    }
  }
}

function setPixel(pixels, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const offset = (Math.floor(y) * size + Math.floor(x)) * 4;
  for (let channel = 0; channel < 4; channel++) pixels[offset + channel] = color[channel];
}

function encodePng(width, height, pixels) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([0]), pixels.subarray(y * width * 4, (y + 1) * width * 4));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), output.length - 4);
  return output;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
