// Renders the extension icons from the panel's favicon.svg (src/assets/shifter-app-icon.svg).
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const src = new URL('../src/assets/shifter-app-icon.svg', import.meta.url);
const out = new URL('../public/icon/', import.meta.url);
await mkdir(out, { recursive: true });

for (const size of [16, 32, 48, 96, 128]) {
  await sharp(fileURLToPath(src), { density: 384 }).resize(size, size).png().toFile(fileURLToPath(new URL(`${size}.png`, out)));
}
console.log('icons written to public/icon/');
