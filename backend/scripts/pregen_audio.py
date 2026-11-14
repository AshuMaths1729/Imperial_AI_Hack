"""Pre-generate TTS audio into the media cache so the demo works offline.

    cd backend && uv run python scripts/pregen_audio.py                # fixtures ask_spatial_*
    cd backend && uv run python scripts/pregen_audio.py texts.json       # JSON list of strings
    cd backend && uv run python scripts/pregen_audio.py --voice-id <id>

Goes through `app.modules.voice.service.synthesize`, so cache keys match the runtime ones.
The ElevenLabs key comes from the environment / `.env` (never printed).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import httpx  # noqa: E402

from app.modules.voice import service  # noqa: E402
from app.settings import Settings, load_settings  # noqa: E402


def collect_texts(fixtures_dir: Path) -> list[str]:
    """`spoken_answer` and segment texts of every `ask_spatial_*.json` (deduplicated)."""
    texts: list[str] = []
    for path in sorted(fixtures_dir.glob("ask_spatial_*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        texts.append(data.get("spoken_answer", ""))
        texts.extend(seg.get("text", "") for seg in data.get("segments", []))
    return list(dict.fromkeys(t.strip() for t in texts if t and t.strip()))


async def pregen(settings: Settings, texts: list[str], voice_id: str | None) -> int:
    failures = 0
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
        for text in texts:
            try:
                result = await service.synthesize(settings, client, text, voice_id)
            except Exception as exc:  # report and continue with the remaining texts
                failures += 1
                print(f"FAIL  {text[:50]!r}: {getattr(exc, 'message', type(exc).__name__)}")
                continue
            state = "cached" if result.cached else "new   "
            print(f"{state} {result.media_id}  {text[:60]!r}")
    return failures


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", nargs="?", type=Path, help="JSON list of strings")
    parser.add_argument("--voice-id", default=None)
    args = parser.parse_args()

    settings = load_settings()
    if args.input:
        texts = [str(t) for t in json.loads(args.input.read_text(encoding="utf-8"))]
    else:
        texts = collect_texts(settings.fixtures_dir)
    print(f"{len(texts)} texts -> {service.media_dir(settings)}")
    sys.exit(1 if asyncio.run(pregen(settings, texts, args.voice_id)) else 0)


if __name__ == "__main__":
    main()
