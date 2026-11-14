"""`/api/sim/*`: generate (LLM -> validate -> repair once), fetch, run."""

from __future__ import annotations

import base64
import re
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.core.errors import UpstreamError
from app.deps import get_llm, get_settings
from app.llm.client import LLMClient
from app.modules.sim import prompts
from app.modules.sim.models import (
    GenerateRequest,
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
from app.settings import Settings
from app.tools.sandbox import run_simulation, validate_code

router = APIRouter(prefix="/sim", tags=["sim"])

_ARXIV_RE = re.compile(r"^(\d{4}\.\d{4,5}|[a-z\-]+(\.[A-Za-z]{2})?/\d{7})(v\d+)?$")
MAX_PDF_BYTES = 25_000_000


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
    if hint:
        blocks = [*blocks, _text_block(f"User hint: {hint}")]
    draft = (
        await llm.parse(
            "sim.codegen",
            prompts.CODEGEN_PROMPT,
            blocks,
            SimDraft,
            prompt_version=prompts.PROMPT_VERSION,
        )
    ).output
    report = await validate_code(draft.code)
    attempts = 1
    if report.status != "passed":
        attempts = 2
        repair_text = (
            f"Previous title: {draft.title}\n\nPrevious code:\n```python\n{draft.code}\n```\n\n"
            "Validation report (JSON):\n"
            + report.model_dump_json(include={"status", "errors", "warnings"}, indent=1)
        )
        draft = (
            await llm.parse(
                "sim.repair",
                prompts.REPAIR_PROMPT,
                [_text_block(repair_text)],
                SimDraft,
                prompt_version=prompts.PROMPT_VERSION,
            )
        ).output
        report = await validate_code(draft.code)
    if report.status != "passed" or report.params is None or report.default_output is None:
        raise SimValidationFailed(
            "generated simulation failed validation",
            details={"validation": report.model_dump(mode="json"), "attempts": attempts},
        )
    spec = SimSpec(
        sim_id=make_sim_id(draft.code),
        title=draft.title,
        explanation=draft.explanation,
        assumptions=draft.assumptions,
        equation_latex=draft.equation_latex or None,
        paper_title=draft.title,
        arxiv_id=arxiv_id,
        params=report.params,
        default_output=report.default_output,
        python_code=draft.code,
        validation=report,
    )
    save_spec(settings, spec)
    return spec


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
