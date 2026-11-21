import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { FilmFinish } from "./components/Backdrop";
import { TL, type TimelineScene } from "./lib/timeline";
import { S01Open } from "./scenes/S01Open";
import { S02Headlines } from "./scenes/S02Headlines";
import { S03Gap } from "./scenes/S03Gap";
import { S04Reveal } from "./scenes/S04Reveal";
import { S05Interface } from "./scenes/S05Interface";
import { S06Workflow } from "./scenes/S06Workflow";
import { S07Engine } from "./scenes/S07Engine";
import { S08Privacy } from "./scenes/S08Privacy";
import { S09Advantage } from "./scenes/S09Advantage";
import { S10Cta } from "./scenes/S10Cta";

/** Mix balance — voice is the reference (~-19 dBFS RMS); music bed sits well under it. */
const MUSIC_GAIN = 0.42;

const SCENES: Record<string, React.FC<{ scene: TimelineScene }>> = {
  open: S01Open,
  headlines: S02Headlines,
  gap: S03Gap,
  reveal: S04Reveal,
  interface: S05Interface,
  workflow: S06Workflow,
  engine: S07Engine,
  privacy: S08Privacy,
  advantage: S09Advantage,
  cta: S10Cta,
};

/**
 * Master composition. Scenes are placed on the narration-driven timeline
 * (src/data/timeline.json) and overlap by `transitionFrames` so their exit and
 * entrance transitions play simultaneously.
 */
export const InferaPromo: React.FC<{ muted?: boolean }> = ({ muted = false }) => (
  <AbsoluteFill style={{ background: "#000" }}>
    {TL.scenes.map((s) => {
      const Scene = SCENES[s.id];
      return (
        <Sequence key={s.id} from={s.from} durationInFrames={s.duration} name={`scene:${s.id}`}>
          <Scene scene={s} />
        </Sequence>
      );
    })}
    <FilmFinish />

    {!muted && (
      <>
        {/* score — already side-chain ducked under the narration */}
        <Audio src={staticFile("audio/music/score.wav")} volume={MUSIC_GAIN} name="music" />
        {TL.scenes.flatMap((s) =>
          s.lines.map((l) => (
            <Sequence key={l.id} from={l.absFrom} durationInFrames={l.duration + 15} name={`vo:${l.id}`} layout="none">
              <Audio src={staticFile(l.file)} volume={1} />
            </Sequence>
          )),
        )}
      </>
    )}
  </AbsoluteFill>
);
