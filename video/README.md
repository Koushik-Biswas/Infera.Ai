# Infera.Ai — cinematic product presentation

A 4:26 product film for Infera, built in code with **Remotion + React + TypeScript**. It renders as a **4K (3840×2160) H.264** master at 30 fps, with a local neural male voice-over, an original score and sound design, and two-pass mastered audio.

The story runs in four acts: **the gap → the solution → the engineering → why Infera**.

| # | Scene | What it shows |
|---|---|---|
| 1 | `open` | Cinematic opening: real demo chat messages fly through 3D space. "Every day, business happens in chats." |
| 2 | `headlines` | **Verified news and reports** on WhatsApp scale, Indian business messaging, voice notes and time lost to manual data work. Shown as 3D news clippings with animated stats, ending in a wall-of-headlines montage. |
| 3 | `gap` | The three pain points from the site (scrolling, copy-paste into Sheets, exporting to an AI assistant), plus the unstructured media that doesn't fit in a sheet. "WhatsApp was built for a world before AI." |
| 4 | `reveal` | A beat of silence, then the logo-hit impact, light rays and a particle burst. The logo draws itself and the real website screenshot rises in 3D. |
| 5 | `interface` | The live Orders collection: a payment screenshot marks Anjali's order Paid, a voice note adds a new row, and a click opens the source message. |
| 6 | `workflow` | How it works: scan the QR code → prompt → collection plan → Accept → ask a question → get a cited answer. |
| 7 | `engine` | **Under the hood**: a five-stage pipeline (Linked device → Understand → Agents → Extract → Collection) with flowing data packets, transcription, reading text from a screenshot, language understanding, scoping, typed-field extraction and source-linked auto-updates. |
| 8 | `privacy` | Encryption: phone → encrypted cloud (live cipher) → desktop, plus the four privacy guarantees. |
| 9 | `advantage` | "No more scrolling / copy-paste / exports", an old-way vs Infera comparison, one-click CSV export, and Windows · Mac · iOS · Android. |
| 10 | `cta` | Channels (WhatsApp live; Gmail, Slack and more in development), "Your first table in 60 seconds", first week free, and the final logo lockup. |

## Accuracy rules

The film is built so it can't invent anything:

- **Product content** comes straight from the website source. `src/data/product.ts` imports `../lib/data.ts` and `../lib/site.ts`. Every customer, order, message, status and figure on screen is the site's own demo data, and on-screen copy is quoted from the site's sections.
- **Capabilities** narrated or shown are limited to those stated on the site and in its FAQ: QR linking like WhatsApp Web, history backfill, voice transcription, reading text in images and documents, mixed-language chats, chats in scope, typed collection fields, rows linked to their source, auto-updates, CSV export, encryption, and the four platforms.
- **News** (`src/data/news.ts`): every headline and quote was checked against the live source page (2026-11-17) and is copied verbatim, with publisher, date and URL. Publishers appear as plain type only; no third-party logos are used. The Parseur figure is labelled as a survey of 500 US professionals.

## Project layout

```
video/
├─ src/
│  ├─ index.ts, Root.tsx        Remotion entry + compositions (InferaPromo, Poster)
│  ├─ Video.tsx                 master timeline: scenes, narration, score, film finish
│  ├─ theme.ts                  brand tokens (dark theme from app/globals.css) + fonts
│  ├─ lib/anim.ts               easing, springs, reveal, count-up, typewriter, virtual camera
│  ├─ lib/timeline.ts           typed access to timeline.json + narration cue helpers
│  ├─ components/               Backdrop/VFX (glows, particles, floor grid, flare, grain),
│  │                            SceneShell (transitions), Brand (logo, kinetic type), ui (product UI), Sfx
│  ├─ scenes/S01…S10            one component per scene
│  └─ data/                     script.json (narration), timeline.json, news.ts, product.ts
├─ public/
│  ├─ audio/narration/          one WAV per narration line (generated)
│  ├─ audio/music/score.wav     original score (generated)
│  ├─ audio/sfx/                sound-design library (generated)
│  ├─ images/screenshots/       real screenshots of the website (captured)
│  └─ textures/grain.png        film grain
├─ scripts/
│  ├─ audio/                    tts.py, timeline.py, sfx.py, music.py, build_all.py
│  ├─ capture/screenshots.mjs   captures the real website with headless Chrome
│  ├─ qc-stills.mjs             renders inspection stills at narration cues
│  └─ render-4k.mjs             chunked 4K render → FFmpeg mastering → final MP4
└─ out/                         renders, captions (.srt), stills
```

## Setup

Requirements: Node 20+ (tested with 24), Python 3.10+, and Chrome or Edge installed.

```bash
cd video
npm install
python -m pip install kokoro-onnx soundfile numpy scipy pillow
```

**Narration voice (local, offline).** The voice-over uses [Kokoro](https://github.com/thewh1teagle/kokoro-onnx), an open neural TTS model that runs on your machine, so no script text is sent anywhere. Download the two model files into `~/.cache/infera-tts/kokoro-v1.0/` (or set `INFERA_TTS_DIR`):

```bash
mkdir -p ~/.cache/infera-tts/kokoro-v1.0 && cd ~/.cache/infera-tts/kokoro-v1.0
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

The voice is a confident male blend: `am_michael` 60% + `am_fenrir` 40%, at 0.96× speed. You can change it in `src/data/script.json → voice`.

## Workflow

```bash
# 1. audio: narration → timeline → SFX → score (narration lines are cached by content hash)
npm run audio

# 2. (optional) refresh the website screenshots
#    in the repo root:  npm run build && npx next start -p 3100
npm run capture

# 3. preview and edit interactively
npm run studio

# 4. inspect stills at every narration cue
node scripts/qc-stills.mjs

# 5. final 4K master (+ a 1080p copy)
node scripts/render-4k.mjs --1080
```

### Editing the narration

Edit `src/data/script.json`, then run `npm run audio`:

- `text` is the caption text.
- `tts` is an optional pronunciation override. "Infera" is spelled `Infurra` there so it is pronounced *in-FUR-uh*, as in "infer". Change it if the brand says it differently.
- `pauseAfter` sets the gap after a line, in seconds.

Only changed lines are re-synthesised. Every scene re-times itself automatically, because visuals key off narration cues (`cues(scene).at("ui-4")`, `.phrase("ui-4", "marked paid")`) instead of hard-coded frames.

### Timing and music

`timeline.py` rounds every scene slot to whole bars at 120 BPM (60 frames), so scene cuts land on musical downbeats. The score (`music.py`) follows the story:

- D-minor tension with a ticking pulse and a heartbeat through the problem.
- A riser and a hard drop into silence before the reveal.
- A D-major bloom for the reveal, then plucked arpeggios for the product scenes.
- A driving sequenced groove for the engine scene, ending on a final sustained chord.

The score is side-chain ducked by about 9 dB under every narration line.

### Render output

`render-4k.mjs` renders 450-frame chunks at `--scale=2` (CRF 16, JPEG 95 frames), one browser tab at a time by default (4K tabs need a lot of RAM), retrying a failed chunk up to 4 times. Chunks are resumable: delete `out/chunks/*.done` to force a re-render. It then:

- renders the audio mix once as WAV,
- concatenates the chunks with stream copy,
- masters the audio with two-pass EBU R128 loudness normalisation (−14 LUFS, −1.5 dBTP),
- writes `out/Infera-Presentation-4K.mp4` (H.264 High, yuv420p, AAC 320 kbps, faststart).

It uses the FFmpeg bundled with Remotion, so no separate install is needed. Captions are written to `out/infera-presentation.srt`.

**Render time.** On a 2-core i3 laptop a 4K render takes several hours. Use `CONCURRENCY` on bigger machines, e.g. `CONCURRENCY=8 node scripts/render-4k.mjs`.
