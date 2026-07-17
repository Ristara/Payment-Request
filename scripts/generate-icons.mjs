#!/usr/bin/env node
// Generate PWA + favicon icons from a single SVG source.
// Renders a chunky white ₹ on the app's indigo (#4f46e5) rounded square.
// The rupee is drawn as SVG paths so it renders identically on every
// system (no font-fallback surprises).
//
// Run with: node scripts/generate-icons.mjs

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const BRAND = "#4f46e5"; // indigo-600, matches theme_color in manifest.json

// 512×512 icon, 112px corner radius. Rupee glyph rendered as strokes:
//   - two horizontal top bars (=)
//   - a curved head from top-right that arcs down-left into the stem
//   - a diagonal descender from the stem down to the bottom-right
const svg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="112" fill="${BRAND}"/>
  <g fill="none" stroke="#ffffff" stroke-width="52" stroke-linecap="round" stroke-linejoin="round">
    <line x1="150" y1="140" x2="380" y2="140"/>
    <line x1="150" y1="220" x2="380" y2="220"/>
    <path d="M320 140 Q365 175 340 220 Q305 285 205 285 L160 285"/>
    <path d="M160 285 L360 420"/>
  </g>
</svg>
`.trim();

const publicDir = path.join(process.cwd(), "public");
const buf = Buffer.from(svg);

const targets = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "favicon-32.png", size: 32 },
];

for (const { name, size } of targets) {
  const out = path.join(publicDir, name);
  await sharp(buf).resize(size, size).png().toFile(out);
  console.log(`✓ ${name}`);
}

// favicon.ico — Sharp writes PNG-in-ICO at 32×32; browsers accept it.
const icoBuf = await sharp(buf).resize(32, 32).png().toBuffer();
await fs.writeFile(path.join(publicDir, "favicon.ico"), icoBuf);
console.log("✓ favicon.ico");

// Also drop the source SVG for future regeneration
await fs.writeFile(path.join(publicDir, "icon.svg"), svg);
console.log("✓ icon.svg");
