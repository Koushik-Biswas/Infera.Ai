// Generates the PNG app icons used by the web app manifest and iOS.
// Run: node scripts/gen-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const mark = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b5cff"/><stop offset="1" stop-color="#14b874"/></linearGradient></defs>
<rect width="512" height="512" ${pad ? "" : 'rx="116"'} fill="url(#g)"/>
<g transform="translate(256 256) scale(${pad ? 0.72 : 1}) translate(-256 -256)">
<path d="M152 160h208M152 256h208M152 352h112" stroke="#fff" stroke-width="40" stroke-linecap="round"/>
<circle cx="356" cy="352" r="34" fill="#fff"/></g></svg>`;

mkdirSync("public/icons", { recursive: true });
const jobs = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["maskable-192.png", 192, true],
  ["maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true],
];
for (const [name, size, pad] of jobs) {
  await sharp(Buffer.from(mark(pad))).resize(size, size).png().toFile(`public/icons/${name}`);
  console.log("wrote", name);
}
