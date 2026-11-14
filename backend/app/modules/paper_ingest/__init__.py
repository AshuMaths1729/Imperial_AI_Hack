"""Paper source ingestion for Paper2Sim (no LLM): arXiv LaTeX source / PDF / web page ->
`PaperSource` (method text + equations), persisted under `state_dir/paper_sources/`.

Frontend chain: `POST /api/ingest/paper` -> `POST /api/sim/generate {paper_text: method_text}`.
"""

from app.modules.paper_ingest.router import register, router

__all__ = ["register", "router"]
