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
  const rows = Buffer.alloc((size * 4 + 1) * size);
  const center = size / 2;
  const outer = size * .29;
  const ring = size * .043;
  const hub = size * .07;
  const needleEnd = { x: center + size * .2, y: center - size * .15 };

  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    rows[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const dx = x - center, dy = y - center;
      const distance = Math.hypot(dx, dy);
      const lineDistance = Math.abs((needleEnd.y - center) * x - (needleEnd.x - center) * y + needleEnd.x * center - needleEnd.y * center) / Math.hypot(needleEnd.y - center, needleEnd.x - center);
      const alongNeedle = x >= center - size * .015 && x <= needleEnd.x + size * .015 && y <= center + size * .015 && y >= needleEnd.y - size * .015;
      const light = Math.abs(distance - outer) < ring / 2 || distance < hub || (alongNeedle && lineDistance < size * .015);
      const color = light ? [239, 237, 231, 255] : [43, 42, 40, 255];
      const pixel = row + 1 + x * 4;
      rows.set(color, pixel);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

for (const size of [192, 512]) writeFileSync(resolve(root, `assets/icon-${size}.png`), createIcon(size));
