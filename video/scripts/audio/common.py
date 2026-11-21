"""Shared helpers for the Infera audio pipeline (TTS, SFX, music, timeline).

Everything here is deterministic: the same inputs always produce the same
audio, so renders are reproducible.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
from scipy import signal

ROOT = Path(__file__).resolve().parents[2]  # video/
SCRIPT_JSON = ROOT / "src" / "data" / "script.json"
MANIFEST_JSON = ROOT / "src" / "data" / "narration-manifest.json"
TIMELINE_JSON = ROOT / "src" / "data" / "timeline.json"
PUBLIC = ROOT / "public"
NARRATION_DIR = PUBLIC / "audio" / "narration"
SFX_DIR = PUBLIC / "audio" / "sfx"
MUSIC_DIR = PUBLIC / "audio" / "music"

SR = 48_000  # project sample rate
FPS = 30
BPM = 120  # 1 beat = 0.5 s = 15 frames — scene cuts land on the grid
BEAT_FRAMES = FPS * 60 // BPM  # 15
BAR_FRAMES = BEAT_FRAMES * 4  # 60


def load_json(p: Path):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def save_json(p: Path, data) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def write_wav(path: Path, audio: np.ndarray, sr: int = SR) -> None:
    """Write float audio (mono [n] or stereo [n, 2]) as 24-bit PCM WAV."""
    import soundfile as sf

    path.parent.mkdir(parents=True, exist_ok=True)
    audio = np.asarray(audio, dtype=np.float64)
    peak = np.max(np.abs(audio)) if audio.size else 0.0
    if peak > 0.999:
        audio = audio * (0.999 / peak)
    sf.write(str(path), audio.astype(np.float32), sr, subtype="PCM_24")


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    import soundfile as sf

    data, sr = sf.read(str(path), dtype="float64", always_2d=False)
    return data, sr


# ---------------------------------------------------------------------------
# DSP building blocks
# ---------------------------------------------------------------------------
def db(x: float) -> float:
    return 10 ** (x / 20)


def t_axis(seconds: float, sr: int = SR) -> np.ndarray:
    return np.arange(int(round(seconds * sr))) / sr


def butter(kind: str, freq, sr: int = SR, order: int = 2):
    return signal.butter(order, freq, btype=kind, fs=sr, output="sos")


def filt(x: np.ndarray, kind: str, freq, order: int = 2, sr: int = SR) -> np.ndarray:
    return signal.sosfilt(butter(kind, freq, sr, order), x, axis=0)


def biquad_peak(x: np.ndarray, f0: float, gain_db: float, q: float = 1.0, sr: int = SR) -> np.ndarray:
    a = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / sr
    alpha = np.sin(w0) / (2 * q)
    b = [1 + alpha * a, -2 * np.cos(w0), 1 - alpha * a]
    den = [1 + alpha / a, -2 * np.cos(w0), 1 - alpha / a]
    return signal.lfilter(np.array(b) / den[0], np.array(den) / den[0], x, axis=0)


def biquad_shelf(x: np.ndarray, f0: float, gain_db: float, kind: str = "high", sr: int = SR) -> np.ndarray:
    a = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / sr
    cosw, sinw = np.cos(w0), np.sin(w0)
    alpha = sinw / 2 * np.sqrt(2)
    sq = 2 * np.sqrt(a) * alpha
    if kind == "high":
        b = [a * ((a + 1) + (a - 1) * cosw + sq), -2 * a * ((a - 1) + (a + 1) * cosw), a * ((a + 1) + (a - 1) * cosw - sq)]
        den = [(a + 1) - (a - 1) * cosw + sq, 2 * ((a - 1) - (a + 1) * cosw), (a + 1) - (a - 1) * cosw - sq]
    else:
        b = [a * ((a + 1) - (a - 1) * cosw + sq), 2 * a * ((a - 1) - (a + 1) * cosw), a * ((a + 1) - (a - 1) * cosw - sq)]
        den = [(a + 1) + (a - 1) * cosw + sq, -2 * ((a - 1) + (a + 1) * cosw), (a + 1) + (a - 1) * cosw - sq]
    return signal.lfilter(np.array(b) / den[0], np.array(den) / den[0], x, axis=0)


def env_ad(n: int, attack: float, decay: float, sr: int = SR, curve: float = 4.0) -> np.ndarray:
    """Attack (linear) then exponential decay envelope, length n samples."""
    t = np.arange(n) / sr
    a = np.clip(t / max(attack, 1e-5), 0, 1)
    d = np.exp(-curve * np.clip(t - attack, 0, None) / max(decay, 1e-5))
    return a * d


def fade(x: np.ndarray, fin: float = 0.005, fout: float = 0.02, sr: int = SR) -> np.ndarray:
    x = x.copy()
    n = len(x)
    i = min(int(fin * sr), n)
    o = min(int(fout * sr), n)
    if i > 0:
        ramp = np.linspace(0, 1, i)
        x[:i] *= ramp if x.ndim == 1 else ramp[:, None]
    if o > 0:
        ramp = np.linspace(1, 0, o)
        x[n - o :] *= ramp if x.ndim == 1 else ramp[:, None]
    return x


def noise(n: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).standard_normal(n)


def stereo(mono: np.ndarray, pan: float = 0.0) -> np.ndarray:
    """Equal-power pan: -1 left … +1 right."""
    ang = (pan + 1) * np.pi / 4
    return np.stack([mono * np.cos(ang), mono * np.sin(ang)], axis=1)


def make_ir(seconds: float = 3.2, seed: int = 7, damp_hz: float = 6500, predelay: float = 0.018, sr: int = SR) -> np.ndarray:
    """Synthetic stereo hall impulse response (decorrelated decaying noise)."""
    n = int(seconds * sr)
    t = np.arange(n) / sr
    decay = np.exp(-6.9 * t / seconds)  # -60 dB at `seconds`
    chans = []
    for c in range(2):
        nz = noise(n, seed + c) * decay
        nz = filt(nz, "low", damp_hz, order=1)
        # progressively darker tail
        dark = filt(nz, "low", damp_hz * 0.35, order=1)
        mix = np.linspace(0, 1, n) ** 0.7
        nz = nz * (1 - mix) + dark * mix
        nz = np.concatenate([np.zeros(int(predelay * sr)), nz])
        chans.append(nz)
    ir = np.stack(chans, axis=1)
    return ir / np.sqrt(np.sum(ir**2, axis=0, keepdims=True))


def reverb(x: np.ndarray, wet: float = 0.3, seconds: float = 3.2, seed: int = 7, damp_hz: float = 6500) -> np.ndarray:
    """Convolution reverb. x mono or stereo → stereo."""
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    ir = make_ir(seconds, seed, damp_hz)
    wet_sig = np.stack([signal.oaconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], axis=1)
    return x * (1 - wet) + wet_sig * wet * 1.4


def pingpong(x: np.ndarray, delay_s: float, feedback: float = 0.38, mix: float = 0.25, taps: int = 6) -> np.ndarray:
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    out = x.copy()
    d = int(delay_s * SR)
    for k in range(1, taps + 1):
        g = mix * feedback ** (k - 1)
        ch = k % 2
        shifted = np.zeros(len(x))
        if d * k < len(x):
            shifted[d * k :] = x[: len(x) - d * k, ch]
        out[:, 1 - ch] += shifted * g
    return out


def softclip(x: np.ndarray, drive: float = 1.0) -> np.ndarray:
    return np.tanh(x * drive) / np.tanh(drive)


def add_at(buf: np.ndarray, clip: np.ndarray, start_s: float, gain: float = 1.0) -> None:
    """Mix `clip` into `buf` (both stereo) at time `start_s`."""
    s = int(round(start_s * SR))
    if s >= len(buf):
        return
    if s < 0:
        clip = clip[-s:]
        s = 0
    e = min(len(buf), s + len(clip))
    if clip.ndim == 1:
        clip = np.stack([clip, clip], axis=1)
    buf[s:e] += clip[: e - s] * gain


def midi_hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def frames_to_s(f: int) -> float:
    return f / FPS


def env_follow(x: np.ndarray, attack: float, release: float, sr: int = SR) -> np.ndarray:
    """Vectorised-ish envelope follower on |x| (mono)."""
    rect = np.abs(x)
    a = np.exp(-1 / (attack * sr))
    r = np.exp(-1 / (release * sr))
    # one-pole smoothing with release coefficient, then fast attack via max with attack-smoothed
    slow = signal.lfilter([1 - r], [1, -r], rect)
    fast = signal.lfilter([1 - a], [1, -a], rect)
    return np.maximum(slow, fast)


os.makedirs(NARRATION_DIR, exist_ok=True)
os.makedirs(SFX_DIR, exist_ok=True)
os.makedirs(MUSIC_DIR, exist_ok=True)
