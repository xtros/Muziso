import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createBMP(width, height, getPixelRGB) {
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize;

  const buffer = Buffer.alloc(fileSize);

  // File Header
  buffer.write('BM', 0);
  buffer.writeUInt32LE(fileSize, 2);
  buffer.writeUInt32LE(54, 10);

  // DIB Header
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26); // Planes
  buffer.writeUInt16LE(24, 28); // 24-bit BGR
  buffer.writeUInt32LE(0, 30); // Compression BI_RGB
  buffer.writeUInt32LE(pixelArraySize, 34);

  // Pixels (stored bottom to top)
  let offset = 54;
  for (let y = height - 1; y >= 0; y--) {
    const rowStart = offset + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const { r, g, b } = getPixelRGB(x, y, width, height);
      const pixelOffset = rowStart + x * 3;
      buffer.writeUInt8(b, pixelOffset);
      buffer.writeUInt8(g, pixelOffset + 1);
      buffer.writeUInt8(r, pixelOffset + 2);
    }
  }

  return buffer;
}

// Generate dark neon sidebar bitmap (164x314)
const sidebarBmp = createBMP(164, 314, (x, y, w, h) => {
  // Dark gradient background with neon yellow accent (#ccff00 = R:204, G:255, B:0)
  const ratio = y / h;
  const baseR = Math.floor(18 + ratio * 20);
  const baseG = Math.floor(18 + ratio * 20);
  const baseB = Math.floor(28 + ratio * 30);

  // Draw a subtle neon glow at the center
  const dx = x - w / 2;
  const dy = y - h / 3;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 45) {
    const glow = (1 - dist / 45);
    return {
      r: Math.min(255, Math.floor(baseR + glow * 180)),
      g: Math.min(255, Math.floor(baseG + glow * 220)),
      b: Math.floor(baseB * (1 - glow))
    };
  }

  return { r: baseR, g: baseG, b: baseB };
});

// Generate dark header bitmap (150x57)
const headerBmp = createBMP(150, 57, (x, y, w, h) => {
  const ratio = x / w;
  const r = Math.floor(15 + ratio * 15);
  const g = Math.floor(15 + ratio * 25);
  const b = Math.floor(25 + ratio * 20);
  return { r, g, b };
});

const sidebarPath = path.join(__dirname, '..', 'src-tauri', 'icons', 'nsis-sidebar.bmp');
const headerPath = path.join(__dirname, '..', 'src-tauri', 'icons', 'nsis-header.bmp');

fs.writeFileSync(sidebarPath, sidebarBmp);
fs.writeFileSync(headerPath, headerBmp);

console.log('NSIS 24-bit BMP graphics created successfully!');
