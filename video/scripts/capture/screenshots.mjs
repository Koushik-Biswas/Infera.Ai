/**
 * Captures real screenshots of the Infera website for the video.
 *
 *   1. In the repo root:  npm run build && npx next start -p 3100
 *   2. In video/:         npm run capture   (SITE_URL=http://localhost:3100 by default)
 *
 * Uses the locally installed Chrome/Edge (puppeteer-core, no browser download),
 * dark theme, deviceScaleFactor 2 so the images stay sharp in the 4K master.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../../public/images/screenshots");
const SITE = process.env.SITE_URL ?? "http://localhost:3100";
const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => fs.existsSync(p));
if (!executablePath) throw new Error("No Chrome/Edge found — set CHROME_PATH");

const SHOTS = [
  { file: "hero.png", hash: "", scrollTo: 0, height: 1250 },
  { file: "collections.png", selector: "#collections" },
  { file: "how-it-works.png", selector: "#how-it-works" },
  { file: "encryption.png", selector: "#encryption" },
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--hide-scrollbars", "--force-color-profile=srgb"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "dark" },
    { name: "prefers-reduced-motion", value: "no-preference" },
  ]);
  await page.evaluateOnNewDocument(() => localStorage.setItem("infera-theme", "dark"));
  await page.goto(SITE, { waitUntil: "networkidle0", timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);

  for (const s of SHOTS) {
    if (s.selector) {
      // scroll gradually so every scroll-reveal animation fires
      const top = await page.$eval(s.selector, (el) => el.getBoundingClientRect().top + window.scrollY);
      for (let y = 0; y <= top; y += 400) await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.evaluate((v) => window.scrollTo(0, v), top);
      await new Promise((r) => setTimeout(r, 2500));
      const box = await page.$eval(s.selector, (el) => {
        const r = el.getBoundingClientRect();
        return { x: 0, y: r.top + window.scrollY, width: window.innerWidth, height: Math.min(r.height, 1400) };
      });
      await page.screenshot({ path: path.join(OUT, s.file), clip: box, captureBeyondViewport: true });
    } else {
      await page.evaluate(() => window.scrollTo(0, 0));
      await new Promise((r) => setTimeout(r, 2500));
      await page.screenshot({ path: path.join(OUT, s.file), clip: { x: 0, y: 0, width: 1600, height: s.height }, captureBeyondViewport: true });
    }
    console.log("captured", s.file);
  }
} finally {
  await browser.close();
}
