"""Inference backend abstraction — supports Claude API and local models (Ollama/vLLM).

Architecture:
    InferenceBackend (ABC)
    ├── ClaudeBackend  — wraps existing ClaudeClient
    └── OllamaBackend  — connects to local Ollama server (Qwen2.5-7B, Mistral, etc.)

Usage in services:
    # Stage 1 (divergence): use local 7B for volume
    fast_backend = get_fast_backend(tracker)
    result = await fast_backend.complete(system, messages, max_tokens=400)

    # Stage 2/3 (analysis): use Claude for quality
    strong_backend = get_strong_backend(tracker)
    async for chunk in strong_backend.stream(system, messages):
        ...
"""

import logging
from abc import ABC, abstractmethod
from typing import AsyncGenerator

from app.config import get_settings
from app.core.token_tracker import TokenTracker

logger = logging.getLogger(__name__)


class InferenceBackend(ABC):
    """Abstract interface for LLM inference — complete() and stream()."""

    @abstractmethod
    async def complete(
        self,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int = 2048,
        temperature: float = 0.7,
    ) -> str:
        """Non-streaming completion. Returns full response text."""
        ...

    @abstractmethod
    async def stream(
        self,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int = 2048,
        temperature: float = 0.7,
    ) -> AsyncGenerator[str, None]:
        """Streaming completion. Yields text chunks."""
        ...

    @abstractmethod
    def backend_name(self) -> str:
        """Human-readable name for logging/tracking."""
        ...


class ClaudeBackend(InferenceBackend):
    """Wraps the existing ClaudeClient as an InferenceBackend.

    Supports per-call model override via the `model` field.
    """

    def __init__(self, tracker: TokenTracker, model: str | None = None):
        from app.core.claude_client import ClaudeClient
        self._client = ClaudeClient(token_tracker=tracker)
        self._model = model  # None = use default from settings

    async def complete(
        self,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int = 2048,
        temperature: float = 0.7,
    ) -> str:
        return await self._client.complete(
            system_prompt, messages,
            max_tokens=max_tokens,
            temperature=temperature,
            model=self._model,
        )

    async def stream(
        self,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int = 2048,
        temperature: float = 0.7,
    ) -> AsyncGenerator[str, None]:
        async for chunk in self._client.stream(
            system_prompt, messages,
            max_tokens=max_tokens,
            temperature=temperature,
            model=self._model,
        ):
            yield chunk

    def backend_name(self) -> str:
        return f"claude:{self._model or 'default'}"


class OllamaBackend(InferenceBackend):
    """Connects to a local Ollama server for inference.

    Requires: `pip install httpx` (already available via anthropic SDK deps).
    Ollama API: POST /api/chat with streaming NDJSON.

    Config via environment:
        WHATIF_OLLAMA_BASE_URL=http://localhost:11434
        WHATIF_OLLAMA_MODEL=qwen2.5:7b
    """

    def __init__(
        self,
        tracker: TokenTracker,
        base_url: str = "http://localhost:11434",
        model: str = "qwen2.5:7b",
    ):
        self._tracker = tracker
        self._base_url = base_url.rstrip("/")
        self._model = model

    async def complete(
        self,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int = 2048,
        temperature: float = 0.7,
    ) -> str:
        import httpx

        ollama_messages = [{"role": "system", "content": system_prompt}]
        for m in messages:
            ollama_messages.append({"role": m["role"], "content": m["content"]})

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    f"{self._base_url}/api/chat",
                    json={
                        "model": self._model,
                        "messages": ollama_messages,
                        "stream": False,
                        "options": {
                            "num_predict": max_tokens,
                            "temperature": temperature,
                        },
                    },
                )
                resp.raise_for_status()
                data = resp.json()

            content = data.get("message", {}).get("content", "")

            # Track approximate tokens (Ollama provides eval counts)
            prompt_tokens = data.get("prompt_eval_count", 0)
            completion_tokens = data.get("eval_count", 0)
            self._tracker.record(
                input_tokens=prompt_tokens,
                output_tokens=completion_tokens,
                label=f"ollama:{self._model}",
            )

            return content

        except Exception as e:
            logger.error(f"Ollama complete error ({self._model}): {e}")
            raise

    async def stream(
        self,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int = 2048,
        temperature: float = 0.7,
    ) -> AsyncGenerator[str, None]:
        import httpx

        ollama_messages = [{"role": "system", "content": system_prompt}]
        for m in messages:
            ollama_messages.append({"role": m["role"], "content": m["content"]})

        prompt_tokens = 0
        completion_tokens = 0

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    f"{self._base_url}/api/chat",
                    json={
                        "model": self._model,
                        "messages": ollama_messages,
                        "stream": True,
                        "options": {
                            "num_predict": max_tokens,
                            "temperature": temperature,
                        },
                    },
                ) as resp:
                    resp.raise_for_status()
                    import json
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        chunk_data = json.loads(line)
                        if chunk_data.get("done"):
                            prompt_tokens = chunk_data.get("prompt_eval_count", 0)
                            completion_tokens = chunk_data.get("eval_count", 0)
                            break
                        msg = chunk_data.get("message", {})
                        text = msg.get("content", "")
                        if text:
                            yield text

        except Exception as e:
            logger.error(f"Ollama stream error ({self._model}): {e}")
            raise
        finally:
            self._tracker.record(
                input_tokens=prompt_tokens,
                output_tokens=completion_tokens,
                label=f"ollama-stream:{self._model}",
            )

    def backend_name(self) -> str:
        return f"ollama:{self._model}"


# ─── Factory Functions ────────────────────────────────────────

def _ollama_available() -> bool:
    """Check if Ollama is configured and reachable (sync check via settings)."""
    settings = get_settings()
    return bool(getattr(settings, "ollama_base_url", ""))


def get_fast_backend(tracker: TokenTracker) -> InferenceBackend:
    """Get the backend for high-volume, low-cost tasks (Stage 1 divergence).

    Returns OllamaBackend if configured, otherwise falls back to Claude Haiku.
    """
    settings = get_settings()

    if getattr(settings, "ollama_base_url", ""):
        return OllamaBackend(
            tracker=tracker,
            base_url=settings.ollama_base_url,
            model=getattr(settings, "ollama_model", "qwen2.5:7b"),
        )

    # Fallback: Claude Haiku
    return ClaudeBackend(tracker=tracker, model="claude-haiku-4-5-20251001")


def get_strong_backend(tracker: TokenTracker, model: str | None = None) -> InferenceBackend:
    """Get the backend for high-quality tasks (Stage 2/3, analysis).

    Uses Claude API by default. Set WHATIF_STRONG_BACKEND_OVERRIDE=ollama
    to route analysis through local models (lower quality, fully offline).
    """
    settings = get_settings()

    if getattr(settings, "strong_backend_override", "") == "ollama" and getattr(settings, "ollama_base_url", ""):
        return OllamaBackend(
            tracker=tracker,
            base_url=settings.ollama_base_url,
            model=getattr(settings, "ollama_model", "qwen2.5:7b"),
        )

    return ClaudeBackend(tracker=tracker, model=model)


def get_model_pool(tracker: TokenTracker) -> list[InferenceBackend]:
    """Get a pool of diverse models for multi-perspective generation.

    Returns multiple OllamaBackend instances (one per model in the pool),
    or falls back to a single fast backend if no pool is configured.

    Config: WHATIF_OLLAMA_MODEL_POOL="qwen2.5:7b,llama3.1:8b,mistral:7b,yi:6b,gemma2:9b"
    """
    settings = get_settings()
    pool_str = getattr(settings, "ollama_model_pool", "")
    base_url = getattr(settings, "ollama_base_url", "")

    if pool_str and base_url:
        models = [m.strip() for m in pool_str.split(",") if m.strip()]
        if models:
            return [
                OllamaBackend(tracker=tracker, base_url=base_url, model=m)
                for m in models
            ]

    # Fallback: single fast backend
    return [get_fast_backend(tracker)]


def get_backend_for_persona(
    tracker: TokenTracker, persona_index: int,
) -> InferenceBackend:
    """Get a specific backend for a persona by index (round-robin from pool)."""
    pool = get_model_pool(tracker)
    return pool[persona_index % len(pool)]
