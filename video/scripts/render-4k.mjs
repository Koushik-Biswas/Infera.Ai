/**
 * Production render: 4K (3840×2160) H.264 master with mastered audio.
 *
 *   node scripts/render-4k.mjs            → full pipeline (resumes finished chunks)
 *   node scripts/render-4k.mjs --1080     → also export a 1080p delivery copy
 *   CHUNK=900 CONCURRENCY=2 PRESET=medium node scripts/render-4k.mjs
 *
 * 1. Video is rendered in chunks (muted) at scale 2 → crash-safe and resumable.
 * 2. The full audio mix (narration + score + SFX) is rendered once as WAV,
 *    so there are no seams at chunk boundaries.
 * 3. FFmpeg (bundled with Remotion) concatenates the chunks losslessly,
 *    masters the audio with two-pass EBU R128 loudnorm (-14 LUFS, -1.5 dBTP)
 *    and muxes AAC 320 kbps with +faststart for web playback.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "out");
const chunksDir = path.join(out, "chunks");
fs.mkdirSync(chunksDir, { recursive: true });

const FFMPEG = path.join(root, "node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe");
const ffmpeg = fs.existsSync(FFMPEG) ? FFMPEG : "ffmpeg";
const CHUNK = Number(process.env.CHUNK ?? 450);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 1); // 4K tabs are RAM-hungry; raise on machines with >8 GB
const PRESET = process.env.PRESET ?? "medium";
const FINAL = path.join(out, "Infera-Presentation-4K.mp4");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

log("bundling…");
const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts"), publicDir: path.join(root, "public") });
const muted = await selectComposition({ serveUrl, id: "InferaPromo", inputProps: { muted: true } });
const total = muted.durationInFrames;
log(`composition ${muted.width}×${muted.height} @${muted.fps}fps, ${total} frames → rendering at ${muted.width * 2}×${muted.height * 2}`);

// ---------------------------------------------------------------- video
const chunks = [];
for (let start = 0, i = 0; start < total; start += CHUNK, i++) {
  const end = Math.min(total - 1, start + CHUNK - 1);
  const file = path.join(chunksDir, `chunk-${String(i).padStart(2, "0")}.mp4`);
  chunks.push(file);
  if (fs.existsSync(file + ".done")) {
    log(`chunk ${i} [${start}-${end}] already rendered`);
    continue;
  }
  const t0 = Date.now();
  let last = -1;
  for (let attempt = 1; ; attempt++) {
  try {
  await renderMedia({
    composition: muted,
    serveUrl,
    codec: "h264",
    outputLocation: file,
    inputProps: { muted: true },
    muted: true,
    frameRange: [start, end],
    scale: 2,
    crf: 16,
    x264Preset: PRESET,
    pixelFormat: "yuv420p",
    imageFormat: "jpeg",
    jpegQuality: 95,
    concurrency: CONCURRENCY,
    chromiumOptions: { gl: "angle" },
    timeoutInMilliseconds: 120000,
    onProgress: ({ renderedFrames, encodedFrames }) => {
      const pct = Math.floor((encodedFrames / (end - start + 1)) * 100);
      if (pct >= last + 10) {
        last = pct;
        log(`chunk ${i} ${pct}% (rendered ${renderedFrames}, encoded ${encodedFrames})`);
      }
    },
  });
  break;
  } catch (err) {
    // low-memory machines: a fresh browser on retry usually succeeds
    log(`chunk ${i} attempt ${attempt} failed: ${String(err.message ?? err).split(String.fromCharCode(10))[0]}`);
    if (attempt >= 4) throw err;
    last = -1;
    await new Promise((r) => setTimeout(r, 15000));
  }
  }
  fs.writeFileSync(file + ".done", "");
  const secs = (Date.now() - t0) / 1000;
  log(`chunk ${i} done in ${secs.toFixed(0)}s (${((end - start + 1) / secs).toFixed(2)} fps)`);
}

// ---------------------------------------------------------------- audio
const mixWav = path.join(out, "audio-mix.wav");
if (!fs.existsSync(mixWav + ".done")) {
  log("rendering audio mix…");
  const withAudio = await selectComposition({ serveUrl, id: "InferaPromo", inputProps: { muted: false } });
  await renderMedia({ composition: withAudio, serveUrl, codec: "wav", outputLocation: mixWav, inputProps: { muted: false }, scale: 0.25, concurrency: CONCURRENCY });
  fs.writeFileSync(mixWav + ".done", "");
}

// ---------------------------------------------------------------- mastering + mux
const list = path.join(chunksDir, "list.txt");
fs.writeFileSync(list, chunks.map((c) => `file '${c.replace(/\\/g, "/")}'`).join("\n"));
const videoOnly = path.join(out, "video-4k.mp4");
log("concatenating video chunks (stream copy)…");
execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", videoOnly], { stdio: "inherit" });

log("loudness analysis (pass 1)…");
const r = spawnSync(ffmpeg, ["-hide_banner", "-i", mixWav, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8" });
const stats = JSON.parse(r.stderr.slice(r.stderr.lastIndexOf("{"), r.stderr.lastIndexOf("}") + 1));
log(`measured: ${stats.input_i} LUFS, ${stats.input_tp} dBTP, LRA ${stats.input_lra}`);
const ln = `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true`;

log("muxing master…");
execFileSync(
  ffmpeg,
  ["-y", "-hide_banner", "-loglevel", "error", "-i", videoOnly, "-i", mixWav, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-af", `${ln},aresample=48000`, "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-ac", "2", "-shortest", "-movflags", "+faststart", "-metadata", "title=Infera.Ai — The intelligent inbox", FINAL],
  { stdio: "inherit" },
);
log(`master written: ${FINAL}`);

if (process.argv.includes("--1080")) {
  const hd = path.join(out, "Infera-Presentation-1080p.mp4");
  log("encoding 1080p delivery copy…");
  execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", FINAL, "-vf", "scale=1920:1080:flags=lanczos", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", hd], { stdio: "inherit" });
  log(`1080p written: ${hd}`);
}
