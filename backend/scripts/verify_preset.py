"""Check that a preset really works offline.

    cd backend && uv run python scripts/verify_preset.py <name>

Loads the preset into temp state/cache dirs, boots the app (CACHE_MODE=offline) with a
TestClient and checks, printing PASS/FAIL/SKIP per artifact:
  - every graph  -> GET /api/graphs/{id}   (state/graphs/<id>.json)
  - every sim    -> GET /api/sim/{id}      (state/sims/<id>.json)
  - every media / page-image file exists and is non-empty
  - manifest counts match the files on disk
  - no file contains something that looks like an API key
A route family whose route is not mounted in this app yet is SKIPped (other lanes own them).
Exit code 0 when nothing FAILed.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient  # noqa: E402

from app.core.errors import AppError  # noqa: E402
from app.main import create_app  # noqa: E402
from app.modules.presets import service  # noqa: E402
from app.settings import Settings  # noqa: E402

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}


class Report:
    def __init__(self) -> None:
        self.counts = {"PASS": 0, "FAIL": 0, "SKIP": 0}

    def line(self, status: str, what: str, note: str = "") -> None:
        self.counts[status] += 1
        print(f"{status:<4} {what}" + (f"  ({note})" if note else ""))


def has_route(app, prefix: str) -> bool:
    """Is a parametrised GET route under `prefix` mounted? (OpenAPI sees nested routers.)"""
    return any(
        path.startswith(prefix) and "{" in path and "get" in ops
        for path, ops in app.openapi().get("paths", {}).items()
    )


def check_family(rep: Report, client, app, label: str, route: str, ids: list[str]) -> None:
    if not ids:
        rep.line("SKIP", f"{label}: none in preset")
        return
    if not has_route(app, route.split("{")[0]):
        rep.line("SKIP", f"{label}: app has no {route} route (lane not merged yet)")
        return
    for i in ids:
        r = client.get(route.format(id=i))
        if r.status_code == 200:
            rep.line("PASS", f"{label} {i}")
        else:
            rep.line("FAIL", f"{label} {i}", f"GET {route.format(id=i)} -> {r.status_code}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("name")
    args = ap.parse_args()

    base = Settings()
    rep = Report()
    with tempfile.TemporaryDirectory(prefix="verify_preset_") as tmp:
        tmp_path = Path(tmp)
        settings = base.model_copy(
            update={
                "cache_mode": "offline",
                "state_dir": tmp_path / "state",
                "cache_dir": tmp_path / "cache",
            }
        )
        try:
            res = service.load_preset(settings, args.name)
        except AppError as e:
            print(f"FAIL: cannot load preset '{args.name}': {e.message}")
            return 1
        rep.line("PASS", f"load '{args.name}'", f"{res['files']} files in {res['ms']} ms")

        pdir = service.preset_path(settings, args.name)
        manifest = json.loads((pdir / service.MANIFEST).read_text(encoding="utf-8"))

        # manifest vs disk
        actual = service._counts(
            [
                (p.relative_to(pdir).as_posix(), 0)
                for sub in ("state", "cache")
                if (pdir / sub).is_dir()
                for p in service.walk_files(pdir / sub)
            ]
        )
        for key, want in sorted((manifest.get("counts") or {}).items()):
            got = actual.get(key, 0)
            rep.line("PASS" if got == want else "FAIL", f"manifest count {key}", f"{got}/{want}")

        # secrets
        files = [p for p in service.walk_files(pdir)]
        hits = service.scan_secrets(files)
        if hits:
            for p in hits:
                rep.line(
                    "FAIL", f"secret scan {p.relative_to(pdir).as_posix()}", "looks like a key"
                )
        else:
            rep.line("PASS", f"secret scan ({len(files)} files)")

        # media / page images
        media = (
            [p for p in service.walk_files(settings.state_dir / "media")]
            if (settings.state_dir / "media").is_dir()
            else []
        )
        pages = (
            [
                p
                for p in service.walk_files(settings.state_dir / "docs")
                if p.suffix.lower() in IMAGE_SUFFIXES
            ]
            if (settings.state_dir / "docs").is_dir()
            else []
        )
        if not media and not pages:
            rep.line("SKIP", "media / page images: none in preset")
        for p in media + pages:
            ok = p.is_file() and p.stat().st_size > 0
            rep.line(
                "PASS" if ok else "FAIL", f"file {p.relative_to(settings.state_dir).as_posix()}"
            )

        # routes
        def ids(sub: str) -> list[str]:
            d = settings.state_dir / sub
            return sorted(p.stem for p in d.glob("*.json")) if d.is_dir() else []

        app = create_app(settings)
        with TestClient(app) as client:
            check_family(rep, client, app, "graph", "/api/graphs/{id}", ids("graphs"))
            check_family(rep, client, app, "sim", "/api/sim/{id}", ids("sims"))

    c = rep.counts
    print(f"\nSUMMARY: {c['PASS']} passed, {c['FAIL']} failed, {c['SKIP']} skipped")
    return 1 if c["FAIL"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
