import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function createIcon(size) {
  const sampleScale = 3;
  const sampleSize = size * sampleScale;
  const samples = new Uint8Array(sampleSize * sampleSize * 4);
  const palette = {
    background: [41, 40, 38, 255],
    body: [51, 50, 48, 255],
    display: [36, 35, 33, 255],
    light: [235, 232, 224, 255],
    muted: [170, 166, 158, 255],
    dim: [145, 141, 133, 255]
  };

  const scale = sampleSize / 512;
  const roundedRect = (x, y, left, top, right, bottom, radius) => {
    const nearestX = Math.max(left + radius, Math.min(x, right - radius));
    const nearestY = Math.max(top + radius, Math.min(y, bottom - radius));
    return Math.hypot(x - nearestX, y - nearestY) <= radius;
  };
  const line = (x, y, x1, y1, x2, y2, width) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    const position = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
    return Math.hypot(x - (x1 + position * dx), y - (y1 + position * dy)) <= width / 2;
  };
  const circle = (x, y, centerX, centerY, radius) => Math.hypot(x - centerX, y - centerY) <= radius;

  function paint(x, y) {
    let color = palette.background;

    if (line(x, y, 122, 156, 187, 91, 18)) color = palette.muted;

    if (roundedRect(x, y, 70, 150, 442, 402, 48)) color = palette.light;
    if (roundedRect(x, y, 88, 168, 424, 384, 30)) color = palette.body;

    if (roundedRect(x, y, 104, 187, 408, 239, 13)) color = palette.dim;
    if (roundedRect(x, y, 111, 194, 401, 232, 6)) color = palette.display;

    if (roundedRect(x, y, 108, 266, 310, 362, 18)) color = palette.display;
    for (const speakerY of [290, 314, 338]) {
      if (line(x, y, 135, speakerY, 283, speakerY, 9)) color = palette.muted;
    }

    if (circle(x, y, 361, 314, 44)) color = palette.light;
    if (circle(x, y, 361, 314, 30)) color = palette.display;
    return color;
  }

  for (let y = 0; y < sampleSize; y += 1) {
    for (let x = 0; x < sampleSize; x += 1) {
      const color = paint((x + .5) / scale, (y + .5) / scale);
      samples.set(color, (y * sampleSize + x) * 4);
    }
  }

  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    rows[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const pixel = row + 1 + x * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        let total = 0;
        for (let sampleY = 0; sampleY < sampleScale; sampleY += 1) {
          for (let sampleX = 0; sampleX < sampleScale; sampleX += 1) {
            const sourceX = x * sampleScale + sampleX;
            const sourceY = y * sampleScale + sampleY;
            total += samples[(sourceY * sampleSize + sourceX) * 4 + channel];
          }
        }
        rows[pixel + channel] = Math.round(total / (sampleScale * sampleScale));
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

for (const size of [180, 192, 512]) writeFileSync(resolve(root, `assets/icon-${size}.png`), createIcon(size));
