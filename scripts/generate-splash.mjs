#!/usr/bin/env node
// Generate iOS PWA launch images ("splash screens").
//
// Android/Chrome build a splash automatically from manifest.json
// (name + background_color + 512px icon). iOS does not — it shows a blank
// white screen unless you ship a PNG matching the device's EXACT pixel
// dimensions and reference it with <link rel="apple-touch-startup-image">.
//
// Each image is the brand indigo with the same rupee mark as the app icon,
// centred at ~30% of the shorter edge.
//
// Run with: node scripts/generate-splash.mjs

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const BRAND = "#4f46e5"; // matches theme_color / background_color
const OUT = path.join(process.cwd(), "public", "splash");

/** The rupee mark, drawn on a transparent 512-box (no rounded plate — the
 *  splash background already supplies the colour). */
const markSvg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <g fill="none" stroke="#ffffff" stroke-width="52" stroke-linecap="round" stroke-linejoin="round">
    <line x1="150" y1="140" x2="380" y2="140"/>
    <line x1="150" y1="220" x2="380" y2="220"/>
    <path d="M320 140 Q365 175 340 220 Q305 285 205 285 L160 285"/>
    <path d="M160 285 L360 420"/>
  </g>
</svg>`;

// [cssWidth, cssHeight, dpr] — portrait. Covers every iPhone still in use
// plus the common iPads; iOS falls back to white with no exact match, so the
// list is deliberately broad.
const DEVICES = [
  [320, 568, 2], // SE 1st gen
  [375, 667, 2], // 6/7/8, SE 2nd/3rd gen
  [414, 736, 3], // 8 Plus
  [375, 812, 3], // X, XS, 11 Pro, 12/13 mini
  [414, 896, 2], // XR, 11
  [414, 896, 3], // XS Max, 11 Pro Max
  [390, 844, 3], // 12, 13, 14
  [428, 926, 3], // 12/13 Pro Max, 14 Plus
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [430, 932, 3], // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  [402, 874, 3], // 16 Pro
  [440, 956, 3], // 16 Pro Max
  [768, 1024, 2], // iPad mini / 9.7"
  [810, 1080, 2], // iPad 10.2"
  [820, 1180, 2], // iPad Air 10.9"
  [834, 1194, 2], // iPad Pro 11"
  [1024, 1366, 2], // iPad Pro 12.9"
];

async function render(pxW, pxH, file) {
  // Mark at ~30% of the shorter edge keeps it comfortable on phone and tablet.
  const markSize = Math.round(Math.min(pxW, pxH) * 0.3);
  const mark = await sharp(Buffer.from(markSvg)).resize(markSize, markSize).png().toBuffer();
  await sharp({
    create: {
      width: pxW,
      height: pxH,
      channels: 4,
      background: BRAND,
    },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, file));
}

await fs.mkdir(OUT, { recursive: true });

const links = [];
for (const [w, h, dpr] of DEVICES) {
  for (const orientation of ["portrait", "landscape"]) {
    const isPortrait = orientation === "portrait";
    const pxW = (isPortrait ? w : h) * dpr;
    const pxH = (isPortrait ? h : w) * dpr;
    const file = `splash-${pxW}x${pxH}.png`;
    await render(pxW, pxH, file);
    links.push(
      `{ rel: "apple-touch-startup-image", media: "(device-width: ${w}px) and (device-height: ${h}px) ` +
        `and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: ${orientation})", url: "/splash/${file}" },`,
    );
  }
}

console.log(`Wrote ${DEVICES.length * 2} splash images to public/splash/\n`);
console.log("Link tags for app/layout.tsx:\n");
console.log(links.join("\n"));
