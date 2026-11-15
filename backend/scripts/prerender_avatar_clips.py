"""Pre-render Synthesia avatar clips into the clip cache so the demo plays them offline.

    cd backend && uv run python scripts/prerender_avatar_clips.py --from-fixtures
    cd backend && uv run python scripts/prerender_avatar_clips.py --scripts scripts.json
    cd backend && uv run python scripts/prerender_avatar_clips.py --from-fixtures --final --yes

`--scripts` is a JSON list of strings or {title, script} objects. `--from-fixtures` adds every
segment `text` / `spoken_answer` in `fixtures/ask_spatial_*.json`. Renders are TEST MODE (free,
watermarked) unless `--final`, which needs `--yes`. Goes through `app.modules.synthesia.service`
so clip ids match the runtime ones. The API key comes from the environment / `.env` (never
printed).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import httpx  # noqa: E402

from app.modules.synthesia import service  # noqa: E402
from app.settings import Settings, load_settings  # noqa: E402


def collect_fixture_scripts(fixtures_dir: Path) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for path in sorted(fixtures_dir.glob("ask_spatial_*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        segments = [s.get("text", "") for s in data.get("segments", [])]
        texts = [data.get("spoken_answer", ""), *segments]
        for i, text in enumerate(texts):
            if text and text.strip():
                items.append({"title": f"{path.stem} #{i}", "script": text.strip()})
    return items


def load_scripts_file(path: Path) -> list[dict[str, str]]:
    items = []
    for entry in json.loads(path.read_text(encoding="utf-8")):
        if isinstance(entry, str):
            items.append({"title": entry[:60], "script": entry.strip()})
        else:
            script = str(entry["script"]).strip()
            items.append({"title": str(entry.get("title") or script[:60]), "script": script})
    return items


def dedupe(items: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: dict[str, dict[str, str]] = {}
    for item in items:
        seen.setdefault(item["script"], item)
    return list(seen.values())


async def run(
    settings: Settings,
    items: list[dict[str, str]],
    *,
    test: bool,
    timeout: float,
    interval: float,
    client: httpx.AsyncClient | None = None,
) -> list[dict]:
    """Submit every script, poll until all complete / failed / timeout. Returns result rows."""
    async with client or httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as http:
        start = time.monotonic()
        rows: dict[str, dict] = {}
        for item in items:
            try:
                rec, created = await service.create_clip(
                    settings, http, item["script"], title=item["title"], test=test
                )
            except Exception as exc:
                rows[item["script"]] = {
                    "clip_id": "-",
                    "title": item["title"],
                    "status": f"FAIL: {getattr(exc, 'message', type(exc).__name__)}",
                    "seconds": 0.0,
                    "record": None,
                    "done": True,
                }
                continue
            rows[item["script"]] = {
                "clip_id": rec["clip_id"],
                "title": item["title"],
                "status": rec["status"],
                "seconds": 0.0,
                "record": rec,
                "done": rec["status"] != "in_progress",
            }
            print(f"{'submitted' if created else 'cached   '} {rec['clip_id']}  {item['title']}")

        while True:
            pending = [r for r in rows.values() if not r["done"]]
            if not pending:
                break
            if time.monotonic() - start > timeout:
                print(f"timeout after {timeout:.0f}s with {len(pending)} clip(s) unfinished")
                break
            for row in pending:
                rec = await service.refresh_clip(settings, http, row["record"])
                row["record"], row["status"] = rec, rec["status"]
                if rec["status"] != "in_progress":
                    row["done"] = True
                    row["seconds"] = time.monotonic() - start
                    print(f"{rec['status']:<10} {rec['clip_id']}  {row['title']}")
            if any(not r["done"] for r in rows.values()):
                await asyncio.sleep(interval)
        for row in rows.values():
            if not row["done"]:
                row["seconds"] = time.monotonic() - start
        return list(rows.values())


def print_table(rows: list[dict]) -> None:
    print(f"\n{'clip_id':<18}{'status':<14}{'seconds':>8}  title")
    for r in rows:
        print(f"{r['clip_id']:<18}{r['status'][:13]:<14}{r['seconds']:>8.0f}  {r['title'][:50]}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--scripts", type=Path, help="JSON list of strings or {title, script}")
    parser.add_argument("--from-fixtures", action="store_true", help="ask_spatial_*.json texts")
    parser.add_argument("--timeout", type=float, default=900.0, help="seconds (default 900)")
    parser.add_argument("--interval", type=float, default=15.0, help="poll seconds (default 15)")
    parser.add_argument("--final", action="store_true", help="real renders (test mode off, costs)")
    parser.add_argument("--yes", action="store_true", help="confirm --final submission")
    args = parser.parse_args()

    settings = load_settings()
    items: list[dict[str, str]] = []
    if args.scripts:
        items += load_scripts_file(args.scripts)
    if args.from_fixtures:
        items += collect_fixture_scripts(settings.fixtures_dir)
    items = dedupe(items)
    if not items:
        parser.error("nothing to render: pass --scripts and/or --from-fixtures")
    too_long = [i for i in items if len(i["script"]) > service.MAX_SCRIPT_CHARS]
    if too_long:
        parser.error(f"{len(too_long)} script(s) longer than {service.MAX_SCRIPT_CHARS} chars")

    test = not args.final
    mode = "TEST (free, watermarked)" if test else "FINAL (billed)"
    print(f"{len(items)} video(s), mode {mode} -> {service.clips_dir(settings)}")
    if args.final and not args.yes:
        print(f"Refusing to submit {len(items)} FINAL render(s) without --yes")
        sys.exit(2)

    rows = asyncio.run(
        run(settings, items, test=test, timeout=args.timeout, interval=args.interval)
    )
    print_table(rows)
    sys.exit(0 if all(r["status"] == "complete" for r in rows) else 1)


if __name__ == "__main__":
    main()
