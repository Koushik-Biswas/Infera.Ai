import React from "react";
import { Composition, Still } from "remotion";
import { InferaPromo } from "./Video";
import { TL } from "./lib/timeline";
import { Poster } from "./Poster";

export const Root: React.FC = () => (
  <>
    {/* Designed at 1920×1080; rendered at 4K (3840×2160) with --scale=2 so all type and vectors stay razor sharp. */}
    <Composition id="InferaPromo" component={InferaPromo} durationInFrames={TL.durationInFrames} fps={TL.fps} width={TL.width} height={TL.height} defaultProps={{ muted: false }} />
    <Still id="Poster" component={Poster} width={1920} height={1080} />
  </>
);
