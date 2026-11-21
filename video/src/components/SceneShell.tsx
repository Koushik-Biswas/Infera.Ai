import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { EASE_IN_OUT, EASE_OUT, mix, prog } from "../lib/anim";
import { T } from "../lib/timeline";
import { c, fonts } from "../theme";

export type TransitionKind = "blur" | "zoom-in" | "zoom-out" | "slide-left" | "none";

/**
 * Wraps a scene and applies its entrance / exit transition. Scenes overlap by
 * T frames in the master timeline, so the outgoing exit and incoming entrance
 * play at the same time (a true cross-transition, not a dip to black).
 */
export const SceneShell: React.FC<{
  duration: number;
  enter?: TransitionKind;
  exit?: TransitionKind;
  children: React.ReactNode;
}> = ({ duration, enter = "blur", exit = "blur", children }) => {
  const f = useCurrentFrame();
  const pin = enter === "none" ? 1 : prog(f, 0, T + 4, EASE_OUT);
  const pout = exit === "none" ? 0 : prog(f, duration - T, T, EASE_IN_OUT);

  let scale = 1;
  let x = 0;
  let blur = 0;
  let opacity = 1;

  // entrance
  if (enter !== "none") {
    opacity *= pin;
    blur += (1 - pin) * 16;
    if (enter === "blur") scale *= mix(1.05, 1, pin);
    if (enter === "zoom-in") scale *= mix(0.86, 1, pin);
    if (enter === "zoom-out") scale *= mix(1.25, 1, pin);
    if (enter === "slide-left") x += (1 - pin) * 220;
  }
  // exit
  if (exit !== "none") {
    opacity *= 1 - pout;
    blur += pout * 16;
    if (exit === "blur") scale *= mix(1, 0.97, pout);
    if (exit === "zoom-in") scale *= mix(1, 1.3, pout);
    if (exit === "zoom-out") scale *= mix(1, 0.85, pout);
    if (exit === "slide-left") x -= pout * 220;
  }

  const active = blur > 0.05 || scale !== 1 || x !== 0;
  return (
    <AbsoluteFill
      style={{
        color: c.fg, // every scene inherits brand text colour + type
        fontFamily: fonts.sans,
        opacity,
        transform: active ? `translate3d(${x}px,0,0) scale(${scale})` : undefined,
        filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
