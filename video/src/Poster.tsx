import React from "react";
import { AbsoluteFill } from "remotion";
import { Backdrop, FilmFinish } from "./components/Backdrop";
import { LogoMark, Wordmark } from "./components/Brand";
import { c, fonts } from "./theme";

/** Thumbnail / poster frame for YouTube, LinkedIn, etc. */
export const Poster: React.FC = () => (
  <AbsoluteFill>
    <Backdrop particles={60} seed={61} intensity={1.2} />
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 34 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
        <LogoMark size={170} glow={0.5} id="poster" />
        <Wordmark size={150} />
      </div>
      <div style={{ fontFamily: fonts.sans, fontSize: 64, fontWeight: 600, letterSpacing: "-0.04em", color: c.fg, textAlign: "center", maxWidth: 1400 }}>
        Turn WhatsApp chats into <span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 400, backgroundImage: `linear-gradient(100deg, ${c.brand}, #7fb6e0 55%, ${c.brand2})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>clean, structured data.</span>
      </div>
    </AbsoluteFill>
    <FilmFinish />
  </AbsoluteFill>
);
