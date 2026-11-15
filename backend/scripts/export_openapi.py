"""Write the app's OpenAPI document to `<repo>/schemas/openapi.json`.

The frontend generates its TypeScript types from that file (`npm run gen:types`), so run this
after any change to routes or shared schemas:

    cd backend && uv run python scripts/export_openapi.py          # write
    cd backend && uv run python scripts/export_openapi.py --check  # exit 1 if out of date

Deterministic: settings come from defaults (no .env), keys are sorted.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app  # noqa: E402
from app.settings import Settings  # noqa: E402

OUT = BACKEND_DIR.parent / "schemas" / "openapi.json"


def render() -> str:
    spec = create_app(Settings(_env_file=None)).openapi()
    return json.dumps(spec, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="fail if the file is out of date")
    args = parser.parse_args()

    text = render()
    if args.check:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != text:
            print(f"{OUT} is out of date: run `uv run python scripts/export_openapi.py`")
            return 1
        print(f"{OUT} is up to date")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
