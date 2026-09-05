// Development-only rasterization of the repository-owned SVG; never needed by the app.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = process.env.SHARP_PATH ? require(process.env.SHARP_PATH) : require('sharp');
const svg = await readFile(new URL('../icons/icon.svg', import.meta.url));
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180], ['maskable-512.png', 512]]) {
  await writeFile(new URL(`../icons/${name}`, import.meta.url), await sharp(svg).resize(size, size).flatten({ background: '#183d35' }).png().toBuffer());
}
