"""Build a HypothesisGraph for a topic through the real app container (real LLM once wired).

    uv run python scripts/build_topic_preset.py --query "solid-state battery electrolytes" --n 12

Writes the graph to state/graphs/<graph_id>.json and the papers to state/papers/ (same as the
API), prints a summary, and with --out also dumps {graph, papers} for use as a Demo Preset.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _write(out: Path, payload: dict) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


async def run(query: str, n: int, out: Path | None) -> int:
    sys.path.insert(0, str(BACKEND_DIR))
    from app.main import create_app
    from app.modules.hypothesis.service import build_topic_graph, load_paper

    container = create_app().state.container
    result = await build_topic_graph(query, n, llm=container.llm, settings=container.settings)

    s = result.stats
    print(f"graph_id:    {result.graph_id}")
    print(f"papers:      {s.papers_found} found, {s.papers_with_claims} in the graph")
    print(f"claims:      {s.claims} (in {s.clusters} clusters)")
    print(f"edges:       {s.supports} supports, {s.contradicts} contradicts, {s.gaps} gap")
    print(f"stored at:   {container.settings.state_dir / 'graphs' / (result.graph_id + '.json')}")

    if out:
        paper_ids = [x.id for x in result.graph.nodes if x.kind == "paper"]
        papers = [load_paper(container.settings, pid).model_dump() for pid in paper_ids]
        payload = {"graph": result.graph.model_dump(mode="json"), "papers": papers}
        await asyncio.to_thread(_write, out, payload)
        print(f"preset file: {out}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--query", required=True)
    ap.add_argument("--n", type=int, default=12, help="max papers (default 12)")
    ap.add_argument("--out", type=Path, default=None, help="also write {graph, papers} JSON here")
    args = ap.parse_args()
    return asyncio.run(run(args.query, args.n, args.out))


if __name__ == "__main__":
    raise SystemExit(main())
