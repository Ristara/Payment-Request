#!/usr/bin/env node
// Generate PWA + favicon PNGs from a single SVG source.
// Run with: node scripts/generate-icons.mjs

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const svg = `
<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="96" fill="#4f46e5"/>
  <text
    x="256"
    y="350"
    font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif"
    font-size="320"
    font-weight="700"
    fill="white"
    text-anchor="middle"
  >₹</text>
</svg>
`.trim();

const sizes = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "favicon.ico", size: 32, isIco: true },
];

const publicDir = path.join(process.cwd(), "public");

for (const { name, size, isIco } of sizes) {
  const out = path.join(publicDir, name);
  const buf = Buffer.from(svg);
  if (isIco) {
    const png = await sharp(buf).resize(size, size).png().toBuffer();
    await fs.writeFile(out, png);
  } else {
    await sharp(buf).resize(size, size).png().toFile(out);
  }
  console.log(`✓ ${name}`);
}

// Also drop the source SVG for future regeneration
await fs.writeFile(path.join(publicDir, "icon.svg"), svg);
console.log("✓ icon.svg");
