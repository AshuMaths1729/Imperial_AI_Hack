"""Scholarly search: Semantic Scholar with an automatic OpenAlex fallback."""

from app.tools.scholarly.models import Paper, dedupe_papers
from app.tools.scholarly.search import search_papers

__all__ = ["Paper", "dedupe_papers", "search_papers"]
