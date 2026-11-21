"""Generate the narration with Kokoro (local, offline neural TTS).

Reads   src/data/script.json
Writes  public/audio/narration/<line-id>.wav   (48 kHz, 24-bit, mono)
        src/data/narration-manifest.json       (durations, used by the timeline)

Nothing is sent to any external service: the model runs on this machine.
Model files are expected in  $INFERA_TTS_DIR  (default ~/.cache/infera-tts/kokoro-v1.0):
    kokoro-v1.0.onnx, voices-v1.0.bin
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
from pathlib import Path

import numpy as np
from scipy import signal

sys.path.insert(0, str(Path(__file__).parent))
from common import (  # noqa: E402
    MANIFEST_JSON,
    NARRATION_DIR,
    SCRIPT_JSON,
    SR,
    biquad_peak,
    biquad_shelf,
    db,
    env_follow,
    filt,
    load_json,
    save_json,
    write_wav,
)

MODEL_DIR = Path(os.environ.get("INFERA_TTS_DIR", Path.home() / ".cache" / "infera-tts" / "kokoro-v1.0"))


def load_engine():
    from kokoro_onnx import Kokoro

    onnx = MODEL_DIR / "kokoro-v1.0.onnx"
    voices = MODEL_DIR / "voices-v1.0.bin"
    if not onnx.exists() or not voices.exists():
        sys.exit(f"Kokoro model files not found in {MODEL_DIR}. See README → Narration.")
    return Kokoro(str(onnx), str(voices))


def voice_style(engine, spec: dict):
    """spec = {"blend": {"am_michael": 0.6, "am_fenrir": 0.4}}  or  {"name": "am_michael"}"""
    if "blend" in spec:
        style = None
        for name, w in spec["blend"].items():
            v = engine.get_voice_style(name) * float(w)
            style = v if style is None else style + v
        return style
    return spec["name"]


def trim_silence(x: np.ndarray, sr: int, thresh_db: float = -46, pad_s: float = 0.035) -> np.ndarray:
    win = max(1, int(0.01 * sr))
    e = np.sqrt(np.convolve(x**2, np.ones(win) / win, mode="same"))
    idx = np.where(e > db(thresh_db))[0]
    if not len(idx):
        return x
    pad = int(pad_s * sr)
    return x[max(0, idx[0] - pad) : min(len(x), idx[-1] + pad)]


def master_voice(x: np.ndarray, sr_in: int) -> np.ndarray:
    """Broadcast-style voice chain: resample → HPF → EQ → gentle compression → level."""
    if sr_in != SR:
        from math import gcd

        g = gcd(SR, sr_in)
        x = signal.resample_poly(x, SR // g, sr_in // g)
    x = filt(x, "high", 75, order=2)
    x = biquad_shelf(x, 160, 1.5, "low")  # warmth / chest
    x = biquad_peak(x, 320, -1.5, q=1.1)  # de-box
    x = biquad_peak(x, 3400, 2.2, q=0.9)  # presence & clarity
    x = biquad_shelf(x, 9500, 1.0, "high")  # a little air
    x = filt(x, "low", 15500, order=2)

    # gentle compression (ratio ~2.5:1 above -24 dBFS), smooth gain
    env = env_follow(x, 0.004, 0.12)
    thr = db(-24)
    gain = np.ones_like(env)
    over = env > thr
    gain[over] = (thr * (env[over] / thr) ** (1 / 2.5)) / env[over]
    gain = signal.lfilter([1 - np.exp(-1 / (0.006 * SR))], [1, -np.exp(-1 / (0.006 * SR))], gain)
    x = x * gain

    # level: speech RMS → -19 dBFS, then peak-safe
    voiced = x[np.abs(x) > db(-40)]
    rms = np.sqrt(np.mean(voiced**2)) if len(voiced) else 1e-9
    x = x * (db(-19) / rms)
    peak = np.max(np.abs(x))
    if peak > db(-1.5):
        x = np.tanh(x / db(-1.5)) * db(-1.5)
    return x


def line_hash(text: str, voice: dict, speed: float) -> str:
    h = hashlib.sha1()
    h.update(repr((text, sorted(voice.items()) if isinstance(voice, dict) else voice, speed, "chain-v2")).encode())
    return h.hexdigest()[:16]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-synthesise every line")
    ap.add_argument("--only", nargs="*", help="line ids to (re)generate")
    args = ap.parse_args()

    script = load_json(SCRIPT_JSON)
    vcfg = script["voice"]
    old = load_json(MANIFEST_JSON) if MANIFEST_JSON.exists() else {"lines": {}}
    manifest = {"voice": vcfg, "sampleRate": SR, "lines": {}}

    engine = None
    style = None
    for scene in script["scenes"]:
        for line in scene["lines"]:
            lid = line["id"]
            text = line.get("tts", line["text"])
            speed = float(line.get("speed", vcfg.get("speed", 1.0)))
            h = line_hash(text, vcfg["style"], speed)
            out = NARRATION_DIR / f"{lid}.wav"
            prev = old["lines"].get(lid)
            regen = args.force or (args.only and lid in args.only) or not out.exists() or not prev or prev.get("hash") != h
            if not regen:
                manifest["lines"][lid] = prev
                continue
            if engine is None:
                engine = load_engine()
                style = voice_style(engine, vcfg["style"])
            print(f"  tts  {lid:<14} {text[:70]}")
            samples, sr = engine.create(text, voice=style, speed=speed, lang=vcfg.get("lang", "en-us"))
            x = trim_silence(np.asarray(samples, dtype=np.float64), sr)
            x = master_voice(x, sr)
            write_wav(out, x)
            manifest["lines"][lid] = {"file": f"audio/narration/{lid}.wav", "duration": round(len(x) / SR, 4), "hash": h}
            # save after every line so an interrupted run (e.g. low memory) keeps its progress
            save_json(MANIFEST_JSON, {**manifest, "lines": {**old["lines"], **manifest["lines"]}})

    save_json(MANIFEST_JSON, manifest)
    total = sum(v["duration"] for v in manifest["lines"].values())
    print(f"narration: {len(manifest['lines'])} lines, {total:.1f}s of speech")


if __name__ == "__main__":
    main()
