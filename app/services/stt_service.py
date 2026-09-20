"""
Speech-to-Text — student voice input for Sia / AI Teacher
---------------------------------------------------------
Audio is captured in the client (MediaRecorder) and sent here as a file.
Providers, in order:
  1. Groq Whisper (whisper-large-v3) — fast + cheap
  2. OpenAI Whisper (whisper-1)
Returns the plain transcript text, or "" when no provider is configured.
"""

from __future__ import annotations

import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
OPENAI_STT_URL = "https://api.openai.com/v1/audio/transcriptions"

MAX_AUDIO_BYTES = 25 * 1024 * 1024  # Whisper API limit


async def transcribe_audio(audio_bytes: bytes, filename: str = "clip.webm", language: str = "en") -> str:
    """Transcribe recorded audio to text. Returns "" on any failure."""
    if not audio_bytes:
        return ""
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        logger.warning("STT: audio too large (%d bytes)", len(audio_bytes))
        return ""

    providers = []
    if settings.GROQ_API_KEY:
        providers.append(
            (
                "groq",
                GROQ_STT_URL,
                settings.GROQ_API_KEY,
                "whisper-large-v3",
            )
        )
    if settings.OPENAI_API_KEY:
        providers.append(
            (
                "openai",
                OPENAI_STT_URL,
                settings.OPENAI_API_KEY,
                "whisper-1",
            )
        )

    for name, url, api_key, model in providers:
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    url,
                    headers={"Authorization": f"Bearer {api_key}"},
                    files={"file": (filename, audio_bytes)},
                    data={"model": model, "language": language or "en"},
                )
            if resp.status_code == 200:
                data = resp.json()
                text = (data.get("text") or "").strip()
                if text:
                    return text
                logger.warning("STT[%s]: empty transcript", name)
                return ""
            logger.warning("STT[%s] failed: %s %s", name, resp.status_code, resp.text[:200])
        except Exception as e:  # noqa: BLE001 — fall through to the next provider
            logger.warning("STT[%s] error: %s", name, e)

    logger.warning("STT: no transcription provider configured (set GROQ_API_KEY or OPENAI_API_KEY)")
    return ""
