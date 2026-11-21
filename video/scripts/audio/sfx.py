"""Synthesise the sound-design library (all original, no samples, no licensing).

Writes public/audio/sfx/<name>.wav (48 kHz stereo).
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from scipy import signal

sys.path.insert(0, str(Path(__file__).parent))
from common import SFX_DIR, SR, db, env_ad, fade, filt, midi_hz, noise, pingpong, reverb, softclip, stereo, t_axis, write_wav  # noqa: E402


def sweep_bandpass(x: np.ndarray, f_start: float, f_end: float, q: float = 1.4, blocks: int = 96) -> np.ndarray:
    """Time-varying band-pass by block processing (overlap-add, Hann)."""
    n = len(x)
    out = np.zeros(n)
    hop = max(256, n // blocks)
    win = 2 * hop
    w = np.hanning(win)
    for s in range(0, n, hop):
        seg = x[s : s + win]
        if len(seg) < 16:
            break
        p = min(1.0, s / max(1, n - 1))
        fc = f_start * (f_end / f_start) ** p
        lo, hi = max(30, fc / (1 + 1 / q)), min(SR / 2 - 200, fc * (1 + 1 / q))
        sos = signal.butter(2, [lo, hi], btype="band", fs=SR, output="sos")
        y = signal.sosfiltfilt(sos, np.pad(seg, (0, max(0, 64 - len(seg)))))[: len(seg)]
        out[s : s + len(seg)] += y * w[: len(seg)]
    return out


def whoosh(dur=1.1, f0=300, f1=4200, seed=1, pan_from=-0.7, pan_to=0.7, peak=0.62) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    nz = noise(n, seed)
    shape = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2.2
    shape = shape ** (1 - 0.5 * (t / dur))  # skew towards the end
    body = sweep_bandpass(nz, f0, f1, q=1.2) * shape
    air = filt(noise(n, seed + 10), "high", 5000) * shape**3 * 0.25
    mono = body + air
    pans = np.linspace(pan_from, pan_to, n)
    ang = (pans + 1) * np.pi / 4
    st = np.stack([mono * np.cos(ang), mono * np.sin(ang)], axis=1)
    st = reverb(st, wet=0.18, seconds=1.6, seed=seed)
    return fade(st / np.max(np.abs(st)) * peak, 0.002, 0.08)


def impact(dur=3.2, seed=3, sub=42, crack=0.5, peak=0.9) -> np.ndarray:
    t = t_axis(dur)
    f = sub + 70 * np.exp(-t * 18)
    ph = 2 * np.pi * np.cumsum(f) / SR
    boom = np.sin(ph) * np.exp(-t * 1.6)
    boom = softclip(boom * 1.6, 1.4)
    n = len(t)
    nz = noise(n, seed)
    hit = filt(nz, "band", [180, 3800]) * np.exp(-t * 22) * crack
    tail = filt(nz, "low", 900) * np.exp(-t * 3.5) * 0.18
    mono = boom + hit + tail
    st = reverb(mono, wet=0.32, seconds=2.8, seed=seed, damp_hz=4000)
    return fade(st / np.max(np.abs(st)) * peak, 0.0005, 0.4)


def riser(dur=4.0, seed=5, peak=0.55) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    p = t / dur
    nz = sweep_bandpass(noise(n, seed), 250, 9000, q=2.2, blocks=160)
    amp = p**2.4
    tones = np.zeros(n)
    for k, m in enumerate([50, 57, 62, 69]):
        f = midi_hz(m) * 2 ** (p * 1.0)  # rise one octave
        tones += np.sin(2 * np.pi * np.cumsum(f) / SR + k) * 0.12
    trem = 0.75 + 0.25 * np.sin(2 * np.pi * (2 + 14 * p**2) * t)
    mono = (nz * 1.0 + tones) * amp * trem
    st = reverb(mono, wet=0.3, seconds=2.2, seed=seed)
    st = st[:n]
    return fade(st / np.max(np.abs(st)) * peak, 0.05, 0.01)


def reverse_swell(dur=1.6, seed=9, peak=0.45) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    nz = filt(noise(n, seed), "band", [1500, 11000]) * np.exp(-t * 3.2)
    shimmer = sum(np.sin(2 * np.pi * midi_hz(m) * t) * np.exp(-t * 2.5) for m in (74, 78, 81, 86)) * 0.08
    st = reverb(nz * 0.6 + shimmer, wet=0.55, seconds=2.4, seed=seed)[:n]
    st = st[::-1]
    return fade(st / np.max(np.abs(st)) * peak, 0.02, 0.005)


def pop(seed=11, f=880, peak=0.5) -> np.ndarray:
    dur = 0.22
    t = t_axis(dur)
    fr = f * (1 + 0.9 * np.exp(-t * 60))
    tone = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t * 34)
    click = filt(noise(len(t), seed), "high", 3000) * np.exp(-t * 400) * 0.3
    st = reverb(tone + click, wet=0.15, seconds=0.8, seed=seed)
    return fade(st / np.max(np.abs(st)) * peak, 0.0005, 0.03)


def click(seed=13, peak=0.35, bright=4200) -> np.ndarray:
    dur = 0.08
    t = t_axis(dur)
    c = filt(noise(len(t), seed), "band", [bright * 0.5, bright * 1.8]) * np.exp(-t * 380)
    body = np.sin(2 * np.pi * 1900 * t) * np.exp(-t * 220) * 0.4
    st = stereo(c + body)
    return fade(st / np.max(np.abs(st)) * peak, 0.0002, 0.01)


def tick(seed=17, peak=0.28) -> np.ndarray:
    dur = 0.05
    t = t_axis(dur)
    c = np.sin(2 * np.pi * 3100 * t) * np.exp(-t * 300) + filt(noise(len(t), seed), "high", 6000) * np.exp(-t * 600) * 0.4
    return fade(stereo(c / np.max(np.abs(c)) * peak), 0.0002, 0.005)


def typing(dur=3.0, cps=17, seed=19, peak=0.3) -> np.ndarray:
    """Soft keyboard bed — individual key clicks with human jitter."""
    rng = np.random.default_rng(seed)
    out = np.zeros((int(dur * SR) + SR // 4, 2))
    t = 0.02
    k = 0
    while t < dur:
        c = click(seed=seed + k, peak=1.0, bright=rng.uniform(2600, 4600))
        pan = rng.uniform(-0.25, 0.25)
        g = rng.uniform(0.45, 1.0)
        s = int(t * SR)
        out[s : s + len(c)] += c * g * np.array([np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)]) * 1.4
        t += max(0.03, rng.normal(1 / cps, 0.022))
        if rng.random() < 0.08:
            t += rng.uniform(0.08, 0.2)  # a little pause, like a real typist
        k += 1
    out = filt(out, "low", 9000)
    return fade(out / np.max(np.abs(out)) * peak, 0.001, 0.05)


def glitch(dur=0.55, seed=23, peak=0.5) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    out = np.zeros(n)
    s = 0
    while s < n:
        L = int(rng.uniform(0.008, 0.05) * SR)
        kind = rng.integers(0, 3)
        t = np.arange(L) / SR
        if kind == 0:
            seg = np.sign(np.sin(2 * np.pi * rng.uniform(80, 1400) * t))
        elif kind == 1:
            seg = noise(L, int(rng.integers(0, 1e6)))
            seg = np.round(seg * 3) / 3  # bit-crush
        else:
            seg = np.zeros(L)
        out[s : s + L] = seg[: max(0, min(L, n - s))] * rng.uniform(0.3, 1)
        s += L
    out = filt(out, "band", [200, 7000])
    st = np.stack([out, np.roll(out, 37)], axis=1)
    return fade(st / np.max(np.abs(st)) * peak, 0.001, 0.03)


def shimmer(dur=2.4, seed=29, peak=0.4, root=74) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    out = np.zeros(n)
    notes = [root, root + 4, root + 7, root + 11, root + 12, root + 16, root + 19]
    for i in range(14):
        m = notes[rng.integers(0, len(notes))]
        s = int(rng.uniform(0, dur * 0.55) * SR)
        L = int(0.9 * SR)
        t = np.arange(L) / SR
        tone = (np.sin(2 * np.pi * midi_hz(m) * t) + 0.3 * np.sin(4 * np.pi * midi_hz(m) * t)) * np.exp(-t * 5)
        e = min(n, s + L)
        out[s:e] += tone[: e - s] * rng.uniform(0.3, 1)
    st = pingpong(out, 0.125, 0.45, 0.4)
    st = reverb(st, wet=0.5, seconds=2.6, seed=seed)
    return fade(st / np.max(np.abs(st)) * peak, 0.003, 0.5)


def blip(seed=31, f=1320, peak=0.25) -> np.ndarray:
    dur = 0.16
    t = t_axis(dur)
    tone = np.sin(2 * np.pi * f * t) * env_ad(len(t), 0.002, 0.08) + 0.4 * np.sin(2 * np.pi * f * 1.5 * t) * env_ad(len(t), 0.002, 0.05)
    st = pingpong(tone, 0.06, 0.35, 0.3, taps=3)
    return fade(st / np.max(np.abs(st)) * peak, 0.0005, 0.02)


def success(seed=37, peak=0.42) -> np.ndarray:
    dur = 1.4
    n = int(dur * SR)
    out = np.zeros(n)
    for k, (m, at) in enumerate([(79, 0.0), (83, 0.09), (86, 0.18)]):
        s = int(at * SR)
        t = np.arange(n - s) / SR
        tone = (np.sin(2 * np.pi * midi_hz(m) * t) + 0.25 * np.sin(4 * np.pi * midi_hz(m) * t)) * np.exp(-t * 4.5)
        out[s:] += tone * (0.9 - 0.15 * k)
    st = reverb(out, wet=0.3, seconds=1.8, seed=seed)
    return fade(st / np.max(np.abs(st)) * peak, 0.001, 0.2)


def scan(dur=1.2, seed=41, peak=0.3) -> np.ndarray:
    t = t_axis(dur)
    f = 600 + 1400 * (0.5 - 0.5 * np.cos(2 * np.pi * t / dur))
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.5
    tone = filt(tone + 0.2 * filt(noise(len(t), seed), "band", [2000, 6000]), "low", 5000)
    env = np.sin(np.pi * t / dur) ** 0.6
    st = reverb(tone * env, wet=0.25, seconds=1.2, seed=seed)
    return fade(st / np.max(np.abs(st)) * peak, 0.01, 0.05)


def message_in(seed=43, peak=0.38) -> np.ndarray:
    """Soft two-tone notification — original, deliberately unlike any app's alert."""
    dur = 0.7
    n = int(dur * SR)
    out = np.zeros(n)
    for m, at in [(81, 0.0), (88, 0.07)]:
        s = int(at * SR)
        t = np.arange(n - s) / SR
        out[s:] += np.sin(2 * np.pi * midi_hz(m) * t) * np.exp(-t * 9)
    st = reverb(out, wet=0.22, seconds=1.0, seed=seed)
    return fade(st / np.max(np.abs(st)) * peak, 0.0005, 0.1)


def sub_drop(dur=2.2, seed=47, peak=0.75) -> np.ndarray:
    t = t_axis(dur)
    f = 85 * np.exp(-t * 1.1) + 28
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.2)
    s = softclip(s * 1.4, 1.2)
    st = stereo(s)
    return fade(st / np.max(np.abs(st)) * peak, 0.003, 0.3)


def heartbeat(seed=53, peak=0.55) -> np.ndarray:
    dur = 1.0
    out = np.zeros(int(dur * SR))
    for at, g in [(0.0, 1.0), (0.22, 0.7)]:
        t = t_axis(0.35)
        f = 55 + 40 * np.exp(-t * 30)
        b = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 14) * g
        s = int(at * SR)
        out[s : s + len(b)] += b
    st = reverb(out, wet=0.15, seconds=1.0, seed=seed)
    return fade(st / np.max(np.abs(st)) * peak, 0.001, 0.1)


def logo_hit(seed=59, peak=0.85) -> np.ndarray:
    """Impact + bright major-9 bloom for the brand reveal."""
    dur = 4.5
    n = int(dur * SR)
    imp = impact(3.0, seed=seed, sub=40, crack=0.35, peak=1.0)
    bloom = np.zeros(n)
    t = np.arange(n) / SR
    for m in (50, 57, 62, 66, 69, 76):  # D major add9 voicing
        for det in (-0.06, 0.06):
            bloom += np.sin(2 * np.pi * midi_hz(m + det) * t) * (0.12 if m < 60 else 0.08)
    bloom *= np.minimum(1, t / 0.04) * np.exp(-t * 0.9)
    bl = reverb(bloom, wet=0.5, seconds=3.4, seed=seed)
    out = bl.copy()
    out[: len(imp)] += imp * 0.9
    return fade(out / np.max(np.abs(out)) * peak, 0.0005, 0.8)


SFX = {
    "whoosh": lambda: whoosh(1.1, 300, 4200, seed=1),
    "whoosh-soft": lambda: whoosh(1.4, 200, 2400, seed=2, peak=0.4),
    "whoosh-fast": lambda: whoosh(0.55, 500, 6500, seed=4, pan_from=0.6, pan_to=-0.6, peak=0.5),
    "impact": lambda: impact(3.2, seed=3),
    "impact-soft": lambda: impact(2.2, seed=6, sub=48, crack=0.25, peak=0.6),
    "riser": lambda: riser(4.0, seed=5),
    "riser-short": lambda: riser(2.0, seed=8, peak=0.45),
    "swell": lambda: reverse_swell(1.6, seed=9),
    "pop": lambda: pop(11, 880),
    "pop-high": lambda: pop(12, 1320, peak=0.42),
    "click": lambda: click(13),
    "tick": lambda: tick(17),
    "typing": lambda: typing(3.2, seed=19),
    "glitch": lambda: glitch(0.55, seed=23),
    "shimmer": lambda: shimmer(2.4, seed=29),
    "blip": lambda: blip(31, 1320),
    "blip-low": lambda: blip(32, 880, peak=0.22),
    "success": lambda: success(37),
    "scan": lambda: scan(1.2, seed=41),
    "message": lambda: message_in(43),
    "sub-drop": lambda: sub_drop(2.2, seed=47),
    "heartbeat": lambda: heartbeat(53),
    "logo-hit": lambda: logo_hit(59),
}


def main() -> None:
    only = set(sys.argv[1:])
    for name, fn in SFX.items():
        if only and name not in only:
            continue
        x = fn()
        if x.ndim == 1:
            x = stereo(x)
        write_wav(SFX_DIR / f"{name}.wav", x)
        print(f"  sfx  {name:<12} {len(x) / SR:5.2f}s  peak {20 * np.log10(np.max(np.abs(x)) + 1e-9):5.1f} dBFS")


if __name__ == "__main__":
    main()
