"""Build the master timeline from the script + measured narration durations.

Every scene "slot" (its length minus the cross-transition overlap) is rounded up
to whole bars at 120 BPM (60 frames), so every scene starts on a musical
downbeat.  Remotion, the music score and the captions all read timeline.json.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import BAR_FRAMES, BPM, FPS, MANIFEST_JSON, ROOT, SCRIPT_JSON, TIMELINE_JSON, load_json, save_json  # noqa: E402


def srt_time(frames: int) -> str:
    ms = int(round(frames / FPS * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def main() -> None:
    script = load_json(SCRIPT_JSON)
    manifest = load_json(MANIFEST_JSON)["lines"]
    overlap = int(round(script["transitionSeconds"] * FPS))

    scenes = []
    cursor = 0
    for i, sc in enumerate(script["scenes"]):
        t = sc["leadIn"]
        lines = []
        for j, ln in enumerate(sc["lines"]):
            m = manifest.get(ln["id"])
            if not m:
                sys.exit(f"missing narration for {ln['id']} — run tts.py first")
            start = int(round(t * FPS))
            dur = int(math.ceil(m["duration"] * FPS))
            lines.append({"id": ln["id"], "text": ln["text"], "file": m["file"], "from": start, "duration": dur, "absFrom": cursor + start})
            t += m["duration"]
            if j < len(sc["lines"]) - 1:
                t += ln.get("pauseAfter", sc["gap"])
        raw = int(math.ceil((t + sc["tail"]) * FPS))
        last = i == len(script["scenes"]) - 1
        slot = int(math.ceil((raw - (0 if last else overlap)) / BAR_FRAMES) * BAR_FRAMES)
        length = slot + (0 if last else overlap)
        scenes.append({"id": sc["id"], "act": sc.get("act", ""), "from": cursor, "duration": length, "lines": lines})
        cursor += slot

    total = cursor
    timeline = {
        "fps": FPS,
        "width": 1920,
        "height": 1080,
        "bpm": BPM,
        "barFrames": BAR_FRAMES,
        "transitionFrames": overlap,
        "durationInFrames": total,
        "scenes": scenes,
    }
    save_json(TIMELINE_JSON, timeline)

    # captions (SRT) — handy for social uploads and accessibility
    out = ROOT / "out"
    out.mkdir(exist_ok=True)
    n = 1
    rows = []
    for sc in scenes:
        for ln in sc["lines"]:
            rows.append(f"{n}\n{srt_time(ln['absFrom'])} --> {srt_time(ln['absFrom'] + ln['duration'])}\n{ln['text']}\n")
            n += 1
    (out / "infera-presentation.srt").write_text("\n".join(rows), encoding="utf-8")

    print(f"timeline: {len(scenes)} scenes, {total} frames = {total / FPS:.1f}s ({int(total / FPS // 60)}:{int(total / FPS % 60):02})")
    for sc in scenes:
        print(f"  {sc['id']:<10} from {sc['from'] / FPS:7.2f}s  len {sc['duration'] / FPS:6.2f}s  lines {len(sc['lines'])}")


if __name__ == "__main__":
    main()
