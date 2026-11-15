"""Paper2Sim: LLM-generated, validated, sandbox-run simulations behind `/api/sim/*`."""

from app.modules.sim.router import router

__all__ = ["router"]
