"""Generates the built-in Japanese voices (audio/<voice>/<hash>.mp3) with Kokoro-82M (Apache-2.0).

    node tools/voices/texts.mjs > tools/.cache/texts.json
    python tools/voices/generate.py tools/.cache/texts.json [voice ...]   # one process per voice runs in parallel

Only missing clips are generated, so re-running after adding content is cheap; clips no longer used are deleted.
Needs: pip install torch kokoro "misaki[ja]" soundfile (see README, "Voces incluidas").
"""
import json, sys
from pathlib import Path
import numpy as np
import soundfile as sf
from kokoro import KPipeline

VOICES = sys.argv[2:] or ["jf_alpha", "jm_kumo", "jf_gongitsune"]  # keep in sync with BUILT_IN in js/voices.js
RATE = 24000

texts = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
pipe = KPipeline(lang_code="j", repo_id="hexgrad/Kokoro-82M")
for voice in VOICES:
    out = Path("audio") / voice
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.mp3"):  # clips of texts the app no longer says
        if old.stem not in texts:
            old.unlink()
    todo = {h: t for h, t in texts.items() if not (out / f"{h}.mp3").exists()}
    print(f"{voice}: {len(todo)} de {len(texts)} por generar", flush=True)
    for n, (h, text) in enumerate(todo.items(), 1):
        chunks = [r.audio.numpy() for r in pipe(text, voice=voice, speed=0.9) if r.audio is not None]
        if not chunks:
            print(f"  sin audio: {text}", flush=True)
            continue
        sf.write(out / f"{h}.mp3", np.concatenate(chunks), RATE, format="MP3", compression_level=0.9)
        if n % 100 == 0:
            print(f"  {n}/{len(todo)}", flush=True)
