// Builds client/assets/manifest.json from the SVG sprites. Anchors come from the
// family table in art-source/svg/STYLE.md; run after adding or replacing art:
//   pnpm --filter @games/dominion manifest

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../client/assets/", import.meta.url).pathname;
const SPRITES = join(ROOT, "sprites");

/** Ground anchor in logical px, per family and viewBox. */
function anchor(family, w, h) {
  if (family === "terrain") return h === 104 ? [48, 72] : [48, 40];
  if (family === "cities") return [48, 88];
  if (family === "units") return w === 64 ? [32, 60] : [24, 60];
  if (family === "effects") return [24, 24];
  if (family === "vessels") return [32, 60];
  if (family === "icons" || family === "crests") return [w / 2, h / 2];
  return [48, 40]; // overlays: resources, features, improvements, roads
}

const sprites = {};
for (const family of readdirSync(SPRITES).sort()) {
  for (const file of readdirSync(join(SPRITES, family)).sort()) {
    if (!file.endsWith(".svg")) continue;
    const src = readFileSync(join(SPRITES, family, file), "utf8");
    const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(src);
    if (!m) throw new Error(`${file}: no viewBox`);
    const [w, h] = [Number(m[1]), Number(m[2])];
    const [ax, ay] = anchor(family, w, h);
    const id = file.slice(0, -4);
    sprites[id] = {
      url: relative(ROOT, join(SPRITES, family, file)),
      size: [w, h],
      anchor: [+(ax / w).toFixed(4), +(ay / h).toFixed(4)],
      bounds: [0, 0, w, h],
      ...(src.includes('<g id="owner">') && { ownerMask: "owner" }),
      ...(src.includes('<g id="props">') && { layers: ["ground", "props"] }),
    };
  }
}

const manifest = {
  schemaVersion: 1,
  assetVersion: "0.1.0",
  sprites,
  audio: {},
  licenses: [
    {
      scope: "sprites/**",
      author: "Dominion art track (hand-authored SVG, see art-source/)",
      license: "Original work for this repository",
    },
  ],
};
writeFileSync(join(ROOT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest.json: ${Object.keys(sprites).length} sprites`);
