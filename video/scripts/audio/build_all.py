"""Full audio build: narration (cached) → timeline → SFX → score."""
import os
import subprocess
import sys
from pathlib import Path

here = Path(__file__).parent
env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
# run sequentially: the TTS model needs most of the RAM on small machines
for step in ["tts.py", "timeline.py", "sfx.py", "music.py"]:
    print(f"== {step}")
    subprocess.run([sys.executable, str(here / step), *sys.argv[1:] if step == "tts.py" else []], check=True, env=env)
