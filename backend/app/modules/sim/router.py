"""`/api/sim/*`: generate (LLM -> validate -> repair once -> docs), fetch, run."""

from __future__ import annotations

import base64
import json
import logging
import re
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.core.errors import AppError, UpstreamError
from app.deps import get_llm, get_settings
from app.llm.client import LLMClient
from app.modules.sim import prompts
from app.modules.sim.docs import plain_label, sanitize_docs
from app.modules.sim.models import (
    GenerateRequest,
    GraphDocsDraft,
    RepairDraft,
    RunRequest,
    RunResponse,
    SimDraft,
    SimSpec,
)
from app.modules.sim.service import (
    BadRequest,
    SimRunFailed,
    SimValidationFailed,
    code_hash,
    load_spec,
    make_sim_id,
    run_cache,
    save_spec,
)
from app.schemas.sim import ParamSpec, SimOutput
from app.settings import Settings
from app.tools.sandbox import run_simulation, validate_code

log = logging.getLogger(__name__)
router = APIRouter(prefix="/sim", tags=["sim"])

_ARXIV_RE = re.compile(r"^(\d{4}\.\d{4,5}|[a-z\-]+(\.[A-Za-z]{2})?/\d{7})(v\d+)?$")
MAX_PDF_BYTES = 25_000_000
# Code + docs + (always-on) thinking at high effort outgrow the client's 16k default; the
# client still doubles these once (capped at 64k) on a `max_tokens` stop.
CODEGEN_MAX_TOKENS = 32_000
DOCS_MAX_TOKENS = 32_000


def _pdf_block(data: bytes) -> dict[str, Any]:
    return {
        "type": "document",
        "source": {
            "type": "base64",
            "media_type": "application/pdf",
            "data": base64.standard_b64encode(data).decode("ascii"),
        },
    }


def _text_block(text: str) -> dict[str, Any]:
    return {"type": "text", "text": text}


async def _fetch_arxiv_pdf(arxiv_id: str, settings: Settings) -> bytes:
    if not _ARXIV_RE.match(arxiv_id):
        raise BadRequest(f"bad arXiv id {arxiv_id!r}")
    if settings.is_offline:
        raise UpstreamError("offline mode: cannot fetch arXiv PDFs")
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(f"https://arxiv.org/pdf/{arxiv_id}")
            resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise UpstreamError(f"could not fetch arXiv {arxiv_id}: {exc}") from exc
    if len(resp.content) > MAX_PDF_BYTES:
        raise BadRequest("PDF too large")
    return resp.content


async def _generate(
    blocks: list[dict[str, Any]],
    hint: str | None,
    arxiv_id: str | None,
    llm: LLMClient,
    settings: Settings,
) -> SimSpec:
    paper_blocks = blocks
    if hint:
        blocks = [*blocks, _text_block(f"User hint: {hint}")]
    draft = (
        await llm.parse(
            "sim.codegen",
            prompts.CODEGEN_PROMPT,
            blocks,
            SimDraft,
            prompt_version=prompts.PROMPT_VERSION,
            max_tokens=CODEGEN_MAX_TOKENS,
        )
    ).output
    # The repair call never sees the paper: what only the codegen draft can know stays.
    paper_title = draft.paper_title.strip()
    core_docs = draft.docs
    code, title, explanation = draft.code, draft.title, draft.explanation
    assumptions, equation_latex = draft.assumptions, draft.equation_latex
    report = await validate_code(code)
    attempts = 1
    if report.status != "passed":
        attempts = 2
        repair_text = (
            f"Previous title: {title}\n\nPrevious code:\n```python\n{code}\n```\n\n"
            "Validation report (JSON):\n"
            + report.model_dump_json(include={"status", "errors", "warnings"}, indent=1)
        )
        fixed = (
            await llm.parse(
                "sim.repair",
                prompts.REPAIR_PROMPT,
                [_text_block(repair_text)],
                RepairDraft,
                prompt_version=prompts.PROMPT_VERSION,
            )
        ).output
        code, title, explanation = fixed.code, fixed.title, fixed.explanation
        assumptions, equation_latex = fixed.assumptions, fixed.equation_latex
        report = await validate_code(code)
    if report.status != "passed" or report.params is None or report.default_output is None:
        raise SimValidationFailed(
            "generated simulation failed validation",
            details={"validation": report.model_dump(mode="json"), "attempts": attempts},
        )
    paper_title = paper_title or title
    # slider labels are shown as plain text too: no LaTeX ("$S_0$" -> "S₀")
    params = {
        k: p.model_copy(update={"label": plain_label(p.label)}) for k, p in report.params.items()
    }
    graph = await _graph_docs(
        paper_blocks, code, title, explanation, params, report.default_output, llm
    )
    spec = SimSpec(
        sim_id=make_sim_id(code),
        title=title,
        explanation=explanation,
        assumptions=assumptions,
        # checked against the FINAL validated params / series (they may differ after repair)
        docs=sanitize_docs(core_docs, graph, params, report.default_output, paper_title),
        equation_latex=equation_latex or None,
        paper_title=paper_title,
        arxiv_id=arxiv_id,
        params=params,
        default_output=report.default_output,
        python_code=code,
        validation=report,
    )
    save_spec(settings, spec)
    return spec


async def _graph_docs(
    paper_blocks: list[dict[str, Any]],
    code: str,
    title: str,
    explanation: str,
    params: dict[str, ParamSpec],
    output: SimOutput,
    llm: LLMClient,
) -> GraphDocsDraft | None:
    """Second call: concept graph + equations for the validated module. Best effort: on any
    LLM failure the spec still ships, with the core docs and a synthesised minimal graph."""
    sliders = {
        key: {"label": p.label, "unit": p.unit, "min": p.min, "max": p.max, "default": p.default}
        for key, p in params.items()
    }
    series = [s.name for s in output.series]
    sim_text = (
        f"<simulation>\nTitle: {title}\nExplanation: {explanation}\n"
        f"PARAMS (the sliders): {json.dumps(sliders, ensure_ascii=False)}\n"
        f"Series names: {json.dumps(series, ensure_ascii=False)}\n"
        f"Code:\n```python\n{code}\n```\n</simulation>"
    )
    try:
        return (
            await llm.parse(
                "sim.docs",
                prompts.DOCS_PROMPT,
                [*paper_blocks, _text_block(sim_text)],
                GraphDocsDraft,
                prompt_version=prompts.PROMPT_VERSION,
                max_tokens=DOCS_MAX_TOKENS,
            )
        ).output
    except AppError as exc:
        log.warning("sim.docs failed (%s); shipping the sim with a minimal concept graph", exc)
        return None


@router.post("/generate", response_model=SimSpec)
async def generate(
    req: GenerateRequest,
    llm: LLMClient = Depends(get_llm),
    settings: Settings = Depends(get_settings),
) -> SimSpec:
    blocks: list[dict[str, Any]] = []
    if req.arxiv_id:
        blocks.append(_pdf_block(await _fetch_arxiv_pdf(req.arxiv_id.strip(), settings)))
    if req.paper_text:
        blocks.append(_text_block(f"<paper>\n{req.paper_text}\n</paper>"))
    if not blocks:
        raise BadRequest("provide paper_text or arxiv_id")
    return await _generate(blocks, req.hint, req.arxiv_id, llm, settings)


@router.post("/generate-pdf", response_model=SimSpec)
async def generate_from_pdf(
    file: UploadFile = File(...),
    hint: str = Form(""),
    llm: LLMClient = Depends(get_llm),
    settings: Settings = Depends(get_settings),
) -> SimSpec:
    data = await file.read()
    if not data or len(data) > MAX_PDF_BYTES:
        raise BadRequest("empty or too large PDF")
    return await _generate([_pdf_block(data)], hint or None, None, llm, settings)


@router.post("/run", response_model=RunResponse)
async def run(req: RunRequest, settings: Settings = Depends(get_settings)) -> RunResponse:
    spec = await load_spec(settings, req.sim_id)
    code = spec.python_code or ""
    clamped = {
        name: min(max(req.params.get(name, ps.default), ps.min), ps.max)
        for name, ps in spec.params.items()
    }
    key = (code_hash(code), tuple(sorted(clamped.items())))
    hit = run_cache.get(key)
    if hit is not None:
        return RunResponse(
            output=hit[0], runner="subprocess", ms=hit[1], cached=True, params=clamped
        )
    t0 = time.perf_counter()
    outcome = await run_simulation(code, clamped)
    ms = (time.perf_counter() - t0) * 1000.0
    if not outcome.ok or outcome.output is None:
        issue = outcome.issue.model_dump() if outcome.issue else None
        raise SimRunFailed("simulation failed", details={"issue": issue})
    run_cache.put(key, (outcome.output, ms))
    return RunResponse(
        output=outcome.output, runner="subprocess", ms=ms, cached=False, params=clamped
    )


@router.get("/{sim_id}", response_model=SimSpec)
async def get_sim(sim_id: str, settings: Settings = Depends(get_settings)) -> SimSpec:
    return await load_spec(settings, sim_id)
