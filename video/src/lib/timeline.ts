import timeline from "../data/timeline.json";

export type TimelineLine = {
  id: string;
  text: string;
  file: string;
  /** start frame, relative to the scene */
  from: number;
  duration: number;
  /** start frame, absolute */
  absFrom: number;
};

export type TimelineScene = {
  id: string;
  act: string;
  from: number;
  duration: number;
  lines: TimelineLine[];
};

export type Timeline = {
  fps: number;
  width: number;
  height: number;
  bpm: number;
  barFrames: number;
  transitionFrames: number;
  durationInFrames: number;
  scenes: TimelineScene[];
};

export const TL = timeline as Timeline;
export const T = TL.transitionFrames;

export const getScene = (id: string): TimelineScene => {
  const s = TL.scenes.find((x) => x.id === id);
  if (!s) throw new Error(`Scene not in timeline: ${id}`);
  return s;
};

/** Cue helper bound to a scene: cue("ui-4") → local start frame of that narration line. */
export const cues = (scene: TimelineScene) => {
  const map = new Map(scene.lines.map((l) => [l.id, l]));
  const line = (id: string) => {
    const l = map.get(id);
    if (!l) throw new Error(`Line ${id} not in scene ${scene.id}`);
    return l;
  };
  return {
    line,
    at: (id: string) => line(id).from,
    end: (id: string) => line(id).from + line(id).duration,
    /** start of `phrase` inside line `id` (character-proportional estimate) */
    phrase: (id: string, phrase: string) => {
      const l = line(id);
      const i = l.text.indexOf(phrase);
      return l.from + (i < 0 ? 0 : Math.round((i / l.text.length) * l.duration));
    },
  };
};
