import { Easing, interpolate, spring, type SpringConfig } from "remotion";

/** Reusable animation primitives. All are pure functions of the frame. */

export const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1); // site's signature curve
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
export const EASE_IN = Easing.bezier(0.55, 0, 1, 0.45);
export const EASE_SNAP = Easing.bezier(0.16, 1, 0.3, 1);

export const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 0→1 progress between `start` and `start + dur` (frames). */
export const prog = (frame: number, start: number, dur: number, easing = EASE_OUT) =>
  interpolate(frame, [start, start + Math.max(1, dur)], [0, 1], { ...CLAMP, easing });

/** Progress that rises at `start` and falls at `end`. */
export const window01 = (frame: number, start: number, end: number, inDur = 12, outDur = 12, easing = EASE_OUT) =>
  Math.min(prog(frame, start, inDur, easing), 1 - prog(frame, end - outDur, outDur, EASE_IN_OUT));

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export const springAt = (frame: number, fps: number, start: number, config: Partial<SpringConfig> = {}) =>
  spring({ frame: frame - start, fps, config: { damping: 18, stiffness: 140, mass: 0.9, ...config } });

/** Classic "blur-in" reveal (opacity + rise + blur), matching the website's Reveal. */
export const revealStyle = (p: number, rise = 22, blur = 10): React.CSSProperties => ({
  opacity: p,
  transform: `translate3d(0, ${(1 - p) * rise}px, 0)`,
  filter: p < 0.999 ? `blur(${(1 - p) * blur}px)` : undefined,
});

/** Counts up a number with easing — used for headline stats. */
export const countUp = (frame: number, start: number, dur: number, to: number, decimals = 0) => {
  const v = to * prog(frame, start, dur, Easing.bezier(0.16, 1, 0.3, 1));
  return v.toFixed(decimals);
};

/** Frame offset of a phrase inside a narration line, estimated by character position. */
export const phraseOffset = (text: string, phrase: string, durationFrames: number) => {
  const i = text.indexOf(phrase);
  if (i < 0) return 0;
  return Math.round((i / text.length) * durationFrames);
};

/** Deterministic pseudo random (stable across renders). */
export const rand = (seed: number) => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Typewriter: number of characters visible. */
export const typed = (text: string, frame: number, start: number, cps = 30, fps = 30) =>
  text.slice(0, Math.max(0, Math.min(text.length, Math.floor(((frame - start) / fps) * cps))));

export const typingDuration = (text: string, cps = 30, fps = 30) => Math.ceil((text.length / cps) * fps);

/* ------------------------------------------------------------------ */
/*  Virtual camera                                                      */
/* ------------------------------------------------------------------ */
export type CamKey = { t: number; x: number; y: number; s: number; rx?: number; ry?: number };

/**
 * Keyframed camera over a 1920×1080 layout. Each key says "at frame t, look at
 * point (x, y) with zoom s". Between keys we ease in-out, like a dolly move.
 * Returns a CSS transform for the content wrapper.
 */
export const camera = (frame: number, keys: CamKey[]) => {
  const ks = [...keys].sort((a, b) => a.t - b.t);
  let a = ks[0];
  let b = ks[ks.length - 1];
  for (let i = 0; i < ks.length - 1; i++) {
    if (frame >= ks[i].t && frame <= ks[i + 1].t) {
      a = ks[i];
      b = ks[i + 1];
      break;
    }
  }
  if (frame <= ks[0].t) b = a = ks[0];
  if (frame >= ks[ks.length - 1].t) a = b = ks[ks.length - 1];
  const p = a === b ? 1 : EASE_IN_OUT((frame - a.t) / (b.t - a.t));
  const x = mix(a.x, b.x, p);
  const y = mix(a.y, b.y, p);
  const s = mix(a.s, b.s, p);
  const rx = mix(a.rx ?? 0, b.rx ?? 0, p);
  const ry = mix(a.ry ?? 0, b.ry ?? 0, p);
  return {
    transform: `translate(960px, 540px) rotateX(${rx}deg) rotateY(${ry}deg) scale(${s}) translate(${-x}px, ${-y}px)`,
    transformOrigin: "0 0",
  } as React.CSSProperties;
};
