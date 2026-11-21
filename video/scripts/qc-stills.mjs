/**
 * Quality control: bundle once, then render stills at narration cue points
 * (or explicit frames) so every scene can be inspected without a full render.
 *   node scripts/qc-stills.mjs                 → 2 stills per narration line
 *   node scripts/qc-stills.mjs 120 900 2400    → explicit frames
 *   SCALE=0.5 node scripts/qc-stills.mjs ...   → faster, smaller stills
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tl = JSON.parse(fs.readFileSync(path.join(root, "src/data/timeline.json"), "utf8"));
const outDir = path.join(root, "out/stills");
fs.mkdirSync(outDir, { recursive: true });

let frames = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
if (!frames.length) {
  for (const s of tl.scenes) for (const l of s.lines) frames.push(l.absFrom + 20, l.absFrom + Math.round(l.duration * 0.85));
}
frames = [...new Set(frames)].sort((a, b) => a - b);

const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts"), publicDir: path.join(root, "public") });
const composition = await selectComposition({ serveUrl, id: "InferaPromo", inputProps: { muted: true } });
const scale = Number(process.env.SCALE ?? 0.5);
for (const frame of frames) {
  const scene = tl.scenes.filter((s) => frame >= s.from).pop();
  const file = path.join(outDir, `f${String(frame).padStart(5, "0")}-${scene.id}.jpg`);
  const t = Date.now();
  await renderStill({ composition, serveUrl, output: file, frame, scale, imageFormat: "jpeg", jpegQuality: 85, inputProps: { muted: true }, chromiumOptions: { gl: "angle" } });
  console.log(`still ${frame} (${scene.id}) ${Date.now() - t}ms`);
}
