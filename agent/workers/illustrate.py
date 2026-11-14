"""Illustration worker: fal FLUX text-to-image -> a place_image board op."""
import asyncio
import logging

import fal_client

MODEL = "fal-ai/flux/schnell"
log = logging.getLogger(__name__)
FALLBACK = [{"op": "write_text", "text": "(sketch unavailable — let me describe it)", "place": "next"}]


async def illustrate(brief: str, *, client=None, timeout_s: float = 5.0) -> list[dict]:
    client = client or fal_client  # reads FAL_KEY from env
    try:
        res = await asyncio.wait_for(
            client.subscribe_async(
                MODEL,
                arguments={"prompt": brief, "image_size": "landscape_4_3", "num_inference_steps": 4},
            ),
            timeout_s,
        )
        url = res["images"][0]["url"]
        # board schema only allows https:// or data:image/
        if not isinstance(url, str) or not url.startswith("https://"):
            raise ValueError(f"unusable image url: {url!r}")
    except Exception:  # timeout, network, auth, odd payload: never block the tutor
        log.warning("illustrate failed", exc_info=True)
        return list(FALLBACK)
    return [{"op": "place_image", "url": url, "caption": brief[:60], "place": "next"}]
