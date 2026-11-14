"""Freeze the current state/ + cache/ into `presets/<name>/` (same logic as POST /api/presets).

    cd backend && uv run python scripts/freeze_preset.py <name> [--overwrite] [--include ...]

Refuses (exit 1) if any file looks like it contains an API key; lists file names only.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.core.errors import AppError  # noqa: E402
from app.modules.presets import service  # noqa: E402
from app.settings import Settings  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("name")
    ap.add_argument("--overwrite", action="store_true")
    ap.add_argument("--include", nargs="*", default=None, help="state subdirs (and/or 'cache')")
    args = ap.parse_args()

    settings = Settings()
    try:
        m = service.freeze_preset(settings, args.name, args.include, args.overwrite)
    except AppError as e:
        print(f"FAIL: {e.message}", file=sys.stderr)
        for f in (e.details or {}).get("files", []):
            print(f"  - {f}", file=sys.stderr)
        return 1
    print(f"frozen '{m['name']}': {m['files']} files, {m['bytes']} bytes -> {settings.presets_dir}")
    print("counts:", ", ".join(f"{k}={v}" for k, v in sorted(m["counts"].items())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
