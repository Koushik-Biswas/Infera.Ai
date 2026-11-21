import React from "react";
import { Audio, Sequence, staticFile } from "remotion";

export type SfxName =
  | "whoosh"
  | "whoosh-soft"
  | "whoosh-fast"
  | "impact"
  | "impact-soft"
  | "riser"
  | "riser-short"
  | "swell"
  | "pop"
  | "pop-high"
  | "click"
  | "tick"
  | "typing"
  | "glitch"
  | "shimmer"
  | "blip"
  | "blip-low"
  | "success"
  | "scan"
  | "message"
  | "sub-drop"
  | "heartbeat"
  | "logo-hit";

/** Master SFX bus gain (keeps transitions and UI sounds under the narration). */
export const SFX_BUS = 0.7;

/** Places a sound effect exactly on the frame where its visual event happens. */
export const Sfx: React.FC<{ name: SfxName; at: number; volume?: number; duration?: number }> = ({ name, at, volume = 0.6, duration }) => (
  <Sequence from={Math.round(at)} durationInFrames={duration} layout="none" name={`sfx:${name}`}>
    <Audio src={staticFile(`audio/sfx/${name}.wav`)} volume={volume * SFX_BUS} />
  </Sequence>
);
