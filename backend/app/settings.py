"""Environment contract for the backend (pydantic-settings).

Every setting can be provided as an environment variable (case-insensitive) or in a
`.env` file at the repo root or in `backend/`. Secrets are `SecretStr` so they never show
up in reprs or logs; read them with `.get_secret_value()` at the point of use.

`backend/` holds no secrets in git: see `.env.example` at the repo root for the variable
names.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent

CacheMode = Literal["live", "offline", "refresh"]
Effort = Literal["low", "medium", "high"]

DEFAULT_MODEL = "claude-opus-5-5"

# route name -> which MODEL_* / EFFORT_* setting applies. Routes are the names used in
# RoutePolicy / LLMClient calls (see the plan's per-track route lists).
_ROUTE_MODEL: dict[str, str] = {
    "lecture.extract": "model_extract",
    "hypothesis.claims": "model_extract",
    "hypothesis.compare": "model_extract",
    "hypothesis.research": "model_extract",
    "quiz.gen": "model_quiz",
    "sim.codegen": "model_codegen",
    "sim.repair": "model_codegen",
    "ask": "model_ask",
}
_ROUTE_EFFORT: dict[str, str] = {
    "lecture.extract": "effort_extract",
    "hypothesis.claims": "effort_extract",
    "hypothesis.compare": "effort_compare",
    "hypothesis.research": "effort_research",
    "quiz.gen": "effort_quiz",
    "sim.codegen": "effort_codegen",
    "sim.repair": "effort_codegen",
    "ask": "effort_ask",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # later files override earlier ones; real environment variables beat both
        env_file=(REPO_ROOT / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        # fields named model_* are intentional (MODEL_EXTRACT ...)
        protected_namespaces=("settings_",),
    )

    # --- secrets (server-side only) -------------------------------------------------
    anthropic_api_key: SecretStr | None = None
    tavily_api_key: SecretStr | None = None
    # One key name in .env: ELEVENLABS_API_KEY (the agent passes it to its LiveKit ElevenLabs plugin explicitly).
    elevenlabs_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("elevenlabs_api_key", "ELEVENLABS_API_KEY", "ELEVENLABS_API_KEY"),
    )
    fal_key: SecretStr | None = None
    synthesia_api_key: SecretStr | None = None
    s2_api_key: SecretStr | None = None
    openalex_mailto: str | None = None  # contact email for the OpenAlex polite pool

    # --- live tutor (LiveKit room + agent dispatch) ---------------------------------
    livekit_url: str | None = None
    livekit_api_key: SecretStr | None = None
    livekit_api_secret: SecretStr | None = None
    tutor_agent_name: str = "scholartwin-tutor"  # must match the agent worker's TUTOR_AGENT_NAME

    # --- cache / offline / presets --------------------------------------------------
    cache_mode: CacheMode = "live"
    offline: bool = False  # alias: OFFLINE=1 is the same as CACHE_MODE=offline
    preset: str | None = None  # name of the Demo Preset that is loaded, if any
    cache_dir: Path = BACKEND_DIR / "cache"
    state_dir: Path = BACKEND_DIR / "state"
    presets_dir: Path = REPO_ROOT / "presets"
    fixtures_dir: Path = REPO_ROOT / "fixtures"

    # --- backends / feature flags ---------------------------------------------------
    extractor_backend: Literal["frontier", "finetuned"] = "frontier"
    ask_backend: Literal["canned", "claude", "auto"] = "auto"  # auto = claude when a key is set
    fal_mcp_enabled: bool = False
    research_agent: bool = False

    # --- per-route models and effort ------------------------------------------------
    model_extract: str = DEFAULT_MODEL
    model_codegen: str = DEFAULT_MODEL
    model_ask: str = DEFAULT_MODEL
    model_quiz: str = DEFAULT_MODEL
    effort_extract: Effort = "medium"
    effort_compare: Effort = "high"
    effort_codegen: Effort = "high"
    effort_ask: Effort = "low"
    effort_quiz: Effort = "low"
    effort_research: Effort = "medium"

    # --- HTTP -----------------------------------------------------------------------
    # comma-separated in the environment: CORS_ORIGINS=http://localhost:3000,https://x.dev
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @model_validator(mode="after")
    def _offline_alias(self) -> Settings:
        if self.offline:
            self.cache_mode = "offline"
        return self

    # --- helpers --------------------------------------------------------------------
    @property
    def is_offline(self) -> bool:
        return self.cache_mode == "offline"

    def model_for(self, route: str) -> str:
        """Model id for a route (falls back to the default model for unknown routes)."""
        return str(getattr(self, _ROUTE_MODEL.get(route, ""), DEFAULT_MODEL))

    def effort_for(self, route: str) -> Effort:
        """`output_config.effort` for a route (falls back to medium)."""
        return getattr(self, _ROUTE_EFFORT.get(route, ""), "medium")


@lru_cache
def load_settings() -> Settings:
    """Process-wide settings (cached). Tests build `Settings(_env_file=None, ...)` directly.

    Request handlers should depend on `app.deps.get_settings`, not call this.
    """
    return Settings()
