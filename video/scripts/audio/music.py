"""Original cinematic underscore, composed procedurally against timeline.json.

The score follows the story:
  open / headlines / gap   → D minor, dark pads, ticking clock pulse, heartbeat; riser into …
  reveal                   → silence, then a D-major bloom (the "hope" moment)
  interface / workflow     → plucked arpeggios, soft four-on-the-floor
  engine                   → driving sequenced bass, hats, claps — the most energetic section
  privacy                  → pulls back to pads + arps
  advantage                → full groove
  cta                      → lift, final sustained D-major chord that rings out

Music is ducked under every narration line (side-chain style) and written to
public/audio/music/score.wav.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from common import (  # noqa: E402
    BAR_FRAMES,
    BEAT_FRAMES,
    FPS,
    MUSIC_DIR,
    SR,
    TIMELINE_JSON,
    db,
    fade,
    filt,
    load_json,
    midi_hz,
    noise,
    pingpong,
    reverb,
    softclip,
    write_wav,
)

BEAT = BEAT_FRAMES / FPS  # 0.5 s
BAR = BAR_FRAMES / FPS  # 2 s

# chord symbols → MIDI voicings (pad voicing around D3–A4)
CHORDS = {
    "Dm": [50, 57, 62, 65, 69],
    "Bb": [46, 58, 62, 65, 70],
    "F": [53, 57, 60, 65, 69],
    "C": [48, 55, 60, 64, 67],
    "Gm": [43, 55, 58, 62, 67],
    "A": [45, 57, 61, 64, 69],
    "Asus": [45, 57, 62, 64, 69],
    "D": [50, 57, 62, 66, 69, 76],
    "Bm": [47, 54, 62, 66, 71],
    "G": [43, 55, 59, 62, 67, 74],
    "Em": [40, 55, 59, 64, 67],
}

# per-section arrangement
SECTIONS = {
    "open": dict(prog=["Dm", "Bb", "F", "C"], pad=0.55, bright=0.35, bass="drone", arp=0, kick=0, hats=0, clap=0, ticks=0, air=0.5),
    "headlines": dict(prog=["Dm", "Bb", "F", "C"], pad=0.5, bright=0.4, bass="pulse8", arp=0, kick="half", hats=0, clap=0, ticks=1, air=0.35),
    "gap": dict(prog=["Dm", "Gm", "Bb", "A"], pad=0.55, bright=0.3, bass="drone", arp=0, kick="heart", hats=0, clap=0, ticks=0.5, air=0.5, riser=True),
    "reveal": dict(prog=["D", "Bm", "G", "A"], pad=0.75, bright=0.6, bass="drone", arp=0.6, kick=0, hats=0, clap=0, ticks=0, air=0.3, hold=1.0),
    "interface": dict(prog=["D", "A", "Bm", "G"], pad=0.5, bright=0.5, bass="pulse4", arp=1.0, kick="four", hats=0.4, clap=0, ticks=0, air=0.2),
    "workflow": dict(prog=["G", "D", "A", "Bm"], pad=0.5, bright=0.55, bass="pulse4", arp=1.0, kick="four", hats=0.6, clap=0.5, ticks=0, air=0.2),
    "engine": dict(prog=["Bm", "G", "D", "A"], pad=0.5, bright=0.6, bass="seq16", arp=1.0, kick="four", hats=1.0, clap=1.0, ticks=0, air=0.25),
    "privacy": dict(prog=["G", "D", "Em", "A"], pad=0.65, bright=0.45, bass="drone", arp=0.8, kick=0, hats=0, clap=0, ticks=0, air=0.35),
    "advantage": dict(prog=["D", "A", "Bm", "G"], pad=0.55, bright=0.6, bass="seq8", arp=1.0, kick="four", hats=0.8, clap=0.9, ticks=0, air=0.2),
    "cta": dict(prog=["G", "A", "D", "D"], pad=0.7, bright=0.65, bass="pulse4", arp=0.8, kick="four", hats=0.5, clap=0.5, ticks=0, air=0.3, finale=True),
}


# ---------------------------------------------------------------------------
# instruments
# ---------------------------------------------------------------------------
def pad_note(m: float, dur: float, bright: float, seed: int) -> np.ndarray:
    """Warm additive 'string pad': detuned partial pairs, slow swell, stereo."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    L = np.zeros(n)
    R = np.zeros(n)
    f0 = midi_hz(m)
    for k in range(1, 9):
        fk = f0 * k
        if fk > 9000:
            break
        amp = (1 / k ** (1.9 - 0.9 * bright)) * (0.9 if k == 1 else 1)
        for det, side in ((-0.09, 0), (0.09, 1), (0.0, 2)):
            ph = rng.uniform(0, 2 * np.pi)
            vib = 0.0015 * np.sin(2 * np.pi * rng.uniform(0.15, 0.35) * t + ph)
            s = np.sin(2 * np.pi * fk * (1 + det / 100 * k ** 0.3) * t * (1 + vib) + ph) * amp
            if side == 0:
                L += s
            elif side == 1:
                R += s
            else:
                L += s * 0.5
                R += s * 0.5
    att, rel = min(1.2, dur * 0.35), min(1.6, dur * 0.4)
    env = np.minimum(1, t / att) * np.minimum(1, (dur - t) / rel).clip(0, 1)
    swell = 0.85 + 0.15 * np.sin(2 * np.pi * 0.11 * t + seed)
    return np.stack([L, R], axis=1) * (env * swell)[:, None]


def pluck(m: float, seed: int, length: float = 0.5, tone: float = 0.6) -> np.ndarray:
    n = int(length * SR)
    t = np.arange(n) / SR
    f = midi_hz(m)
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) * np.exp(-t * 14) + 0.12 * np.sin(6 * np.pi * f * t) * np.exp(-t * 22)
    s *= np.exp(-t * (6.5 - 2.5 * tone)) * np.minimum(1, t / 0.002)
    return s


def kick(seed: int = 0) -> np.ndarray:
    t = np.arange(int(0.45 * SR)) / SR
    f = 46 + 110 * np.exp(-t * 32)
    b = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)
    c = filt(noise(len(t), 99 + seed), "band", [1500, 5000]) * np.exp(-t * 300) * 0.25
    return softclip((b + c) * 1.3, 1.1)


def hat(seed: int, open_: bool = False) -> np.ndarray:
    t = np.arange(int((0.18 if open_ else 0.05) * SR)) / SR
    h = filt(noise(len(t), seed), "high", 7500, order=2) * np.exp(-t * (18 if open_ else 80))
    return h


def clap(seed: int) -> np.ndarray:
    t = np.arange(int(0.3 * SR)) / SR
    nz = filt(noise(len(t), seed), "band", [900, 4200])
    env = np.zeros(len(t))
    for d in (0.0, 0.011, 0.022):
        env += np.exp(-np.clip(t - d, 0, None) * 120) * (t >= d)
    env += np.exp(-np.clip(t - 0.03, 0, None) * 14) * (t >= 0.03) * 0.5
    return nz * env


def tick_click(seed: int, accent: bool) -> np.ndarray:
    t = np.arange(int(0.03 * SR)) / SR
    s = np.sin(2 * np.pi * (3400 if accent else 2600) * t) * np.exp(-t * 420)
    s += filt(noise(len(t), seed), "high", 6000) * np.exp(-t * 700) * 0.5
    return s


def riser(dur: float) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    p = t / dur
    nz = filt(noise(n, 4242), "band", [400, 8000])
    nz = filt(nz, "high", 300)
    tones = sum(np.sin(2 * np.pi * np.cumsum(midi_hz(m) * 2 ** p) / SR) for m in (38, 45, 50, 57)) * 0.18
    return (nz * 0.35 + tones) * p**2.6


def place(buf: np.ndarray, clip: np.ndarray, at_s: float, gain: float, pan: float = 0.0) -> None:
    s = int(round(at_s * SR))
    if s >= len(buf) or s < 0:
        return
    e = min(len(buf), s + len(clip))
    c = clip[: e - s]
    if c.ndim == 1:
        ang = (pan + 1) * np.pi / 4
        c = np.stack([c * np.cos(ang), c * np.sin(ang)], axis=1) * 1.414
    buf[s:e] += c * gain


# ---------------------------------------------------------------------------
# arrangement
# ---------------------------------------------------------------------------
def build(timeline: dict) -> np.ndarray:
    total_s = timeline["durationInFrames"] / FPS + 6.0
    n = int(total_s * SR)
    pads = np.zeros((n, 2))
    bass = np.zeros((n, 2))
    arps = np.zeros((n, 2))
    drums = np.zeros((n, 2))
    fx = np.zeros((n, 2))

    scenes = timeline["scenes"]
    k_kick = kick()
    for si, sc in enumerate(scenes):
        cfg = SECTIONS[sc["id"]]
        start = sc["from"] / FPS
        end = scenes[si + 1]["from"] / FPS if si + 1 < len(scenes) else timeline["durationInFrames"] / FPS
        bars = int(round((end - start) / BAR))
        hold = cfg.get("hold", 0.0)  # silence at section start (reveal)
        finale = cfg.get("finale", False)
        cta3 = None
        if finale:
            cta3 = start + sc["lines"][-1]["from"] / FPS

        for b in range(bars):
            bar_t = start + b * BAR
            if hold and bar_t < start + hold:
                pass
            chord_name = cfg["prog"][(b // 2) % len(cfg["prog"])]
            if finale and cta3 is not None and bar_t >= cta3 - BAR:
                chord_name = "D"
            notes = CHORDS[chord_name]

            # --- pad: one note-event per 2 bars (re-struck on chord change) ---
            if b % 2 == 0:
                seg_start = bar_t + (hold if b == 0 else 0)
                seg_len = min(2 * BAR, end - bar_t) - (hold if b == 0 else 0) + 1.4
                if finale and cta3 is not None and bar_t >= cta3 - BAR:
                    seg_len = (end - bar_t) + 4.5  # ring out past the end
                for j, m in enumerate(notes):
                    p = pad_note(m, seg_len, cfg["bright"], seed=si * 100 + b * 7 + j)
                    place(pads, p, seg_start, cfg["pad"] * 0.055)
                    if finale and bar_t >= (cta3 or 1e9) - BAR:
                        place(pads, pad_note(m + 12, seg_len, cfg["bright"], seed=999 + j), seg_start, 0.022)

            root = notes[0]
            while root > 45:
                root -= 12
            # --- bass ---
            mode = cfg["bass"]
            if mode == "drone" and b % 2 == 0:
                dur = min(2 * BAR, end - bar_t) + 0.3
                tt = np.arange(int(dur * SR)) / SR
                s = np.sin(2 * np.pi * midi_hz(root) * tt) * np.minimum(1, tt / 0.4) * np.minimum(1, (dur - tt) / 0.5).clip(0, 1)
                place(bass, softclip(s * 1.2, 1.1), bar_t + (hold if b == 0 else 0), 0.16)
            elif mode in ("pulse8", "pulse4", "seq8", "seq16"):
                steps = {"pulse8": 8, "pulse4": 4, "seq8": 8, "seq16": 16}[mode]
                step_len = BAR / steps
                for k in range(steps):
                    if mode == "seq16" and k % 4 == 0:
                        continue  # leave room for the kick
                    m = root + (12 if mode == "seq16" and k % 8 in (6, 7) else 0)
                    ln = step_len * (0.9 if mode != "pulse4" else 0.7)
                    tt = np.arange(int(ln * SR)) / SR
                    saw = sum(np.sin(2 * np.pi * midi_hz(m) * h * tt) / h for h in range(1, 7))
                    s = saw * np.exp(-tt * (9 if mode != "pulse4" else 4)) * np.minimum(1, tt / 0.003)
                    place(bass, s, bar_t + k * step_len, 0.07 if mode != "pulse4" else 0.09)

            # --- arpeggio (16ths, two octaves) ---
            if cfg["arp"]:
                arp_notes = sorted(set([n_ + 12 for n_ in notes[1:]] + [n_ + 24 for n_ in notes[1:3]]))
                pattern = [0, 2, 1, 3, 2, 4, 3, 1]
                for k in range(16):
                    t0 = bar_t + k * BEAT / 4
                    if hold and t0 < start + hold + 2 * BAR:
                        continue  # let the bloom breathe before the arp enters
                    m = arp_notes[pattern[k % len(pattern)] % len(arp_notes)]
                    vel = 0.75 if k % 4 == 0 else 0.5
                    place(arps, pluck(m, seed=k, tone=cfg["bright"]), t0, cfg["arp"] * 0.05 * vel, pan=0.35 * np.sin(k * 0.8))

            # --- drums ---
            kmode = cfg["kick"]
            for beat in range(4):
                bt = bar_t + beat * BEAT
                if kmode == "four":
                    place(drums, k_kick, bt, 0.32)
                elif kmode == "half" and beat in (0, 2):
                    place(drums, k_kick, bt, 0.24)
                elif kmode == "heart" and beat == 0:
                    place(drums, k_kick, bt, 0.3)
                    place(drums, k_kick, bt + 0.24, 0.17)
                if cfg["clap"] and beat in (1, 3):
                    place(drums, clap(seed=b * 4 + beat), bt, cfg["clap"] * 0.12, pan=0.1)
                if cfg["hats"]:
                    for sub in range(4 if cfg["hats"] >= 0.8 else 2):
                        st = bt + sub * BEAT / (4 if cfg["hats"] >= 0.8 else 2)
                        acc = sub == (2 if cfg["hats"] >= 0.8 else 1)
                        place(drums, hat(seed=b * 64 + beat * 4 + sub, open_=acc and cfg["hats"] >= 0.8), st, cfg["hats"] * (0.05 if acc else 0.028), pan=0.3)
                if cfg["ticks"]:
                    for sub in range(4):
                        st = bt + sub * BEAT / 4
                        place(drums, tick_click(seed=b * 16 + beat * 4 + sub, accent=sub == 0), st, cfg["ticks"] * (0.06 if sub == 0 else 0.03), pan=-0.25)

        # --- air / atmosphere bed ---
        if cfg["air"]:
            dur = end - start + 1.0
            nz = filt(noise(int(dur * SR), 777 + si), "band", [300, 2400])
            tt = np.arange(len(nz)) / SR
            env = np.minimum(1, tt / 1.0) * np.minimum(1, (dur - tt) / 1.0).clip(0, 1) * (0.7 + 0.3 * np.sin(2 * np.pi * 0.07 * tt))
            place(fx, nz * env, start, cfg["air"] * 0.018)

        # --- riser into the reveal ---
        if cfg.get("riser"):
            r_len = 4.0
            place(fx, riser(r_len), end - r_len, 0.12)

    # reverb sends
    pads = reverb(pads, wet=0.42, seconds=4.2, seed=11, damp_hz=5200)
    arps = pingpong(arps, BEAT * 0.75, 0.42, 0.33, taps=5)
    arps = reverb(arps, wet=0.35, seconds=2.8, seed=12)
    drums = reverb(drums, wet=0.1, seconds=1.2, seed=13)
    fx = reverb(fx, wet=0.3, seconds=3.0, seed=14)

    mix = pads + bass + arps * 0.9 + drums + fx

    # hard drop: a beat of near-silence right before the reveal hit
    rev = next(s for s in scenes if s["id"] == "reveal")
    rs = rev["from"] / FPS
    g = np.ones(n)
    a, b_ = int((rs - 0.05) * SR), int((rs + 1.0) * SR)
    g[a:b_] = 0.04
    g[max(0, a - 2400) : a] = np.linspace(1, 0.04, min(2400, a))
    g[b_ : b_ + 4800] = np.linspace(0.04, 1, len(g[b_ : b_ + 4800]))
    mix *= g[:, None]

    # gentle bus glue
    mix = filt(mix, "high", 28)
    mix = softclip(mix * 1.15, 1.05)
    return mix


def duck_envelope(timeline: dict, n: int, depth_db: float = -9.0) -> np.ndarray:
    """Side-chain style ducking under narration (pre-attack 0.2 s, release 0.6 s)."""
    target = np.zeros(n)
    for sc in timeline["scenes"]:
        for ln in sc["lines"]:
            s = int((ln["absFrom"] / FPS - 0.2) * SR)
            e = int(((ln["absFrom"] + ln["duration"]) / FPS + 0.15) * SR)
            target[max(0, s) : min(n, e)] = 1.0
    # smooth: ~0.2 s attack / ~0.6 s release
    from scipy import signal

    k_att = np.exp(-1 / (0.07 * SR))
    k_rel = np.exp(-1 / (0.25 * SR))
    up = signal.lfilter([1 - k_att], [1, -k_att], target)
    down = signal.lfilter([1 - k_rel], [1, -k_rel], target)
    sm = np.maximum(up, down).clip(0, 1)
    return db(depth_db) ** sm  # 1 → depth


def main() -> None:
    timeline = load_json(TIMELINE_JSON)
    print("composing score …")
    mix = build(timeline)
    duck = duck_envelope(timeline, len(mix))
    mix *= duck[:, None]
    end_s = timeline["durationInFrames"] / FPS
    mix = mix[: int((end_s + 0.0) * SR)]
    mix = fade(mix, 0.5, 2.5)
    rms = np.sqrt(np.mean(mix**2))
    mix *= db(-20) / max(rms, 1e-9)  # bed level; final loudness is set at mastering
    out = MUSIC_DIR / "score.wav"
    write_wav(out, mix)
    print(f"music: {out.name}  {len(mix) / SR:.1f}s  peak {20 * np.log10(np.max(np.abs(mix))):.1f} dBFS")


if __name__ == "__main__":
    main()
