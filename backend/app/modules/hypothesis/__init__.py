"""HypothesisGraph: topic -> papers -> claims -> contradiction graph.

Routes (under /api): POST /topics, GET /papers/{paper_id}. The graph is written to
`state_dir/graphs/{graph_id}.json`, served by the shared `GET /api/graphs/{id}`.
"""

from app.modules.hypothesis.router import router

__all__ = ["router"]
