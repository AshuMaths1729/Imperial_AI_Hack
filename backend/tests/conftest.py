from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings


@pytest.fixture
def settings() -> Settings:
    # never read a developer's .env in tests. _env_file=None isn't enough on its own: importing the lesson router
    # runs load_dotenv, which copies a real .env into os.environ, so the LiveKit credentials are blanked explicitly.
    return Settings(_env_file=None, livekit_url=None, livekit_api_key=None, livekit_api_secret=None)


@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c
