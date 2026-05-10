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
        # Defensive: empty base_url → use loopback default. Empty string would
        # cause Request URL to be missing protocol later.
        url = (base_url or "").rstrip("/")
        if not url or not url.startswith(("http://", "https://")):
            url = "http://localhost:11434"
        self._base_url = url
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


class OpenAICompatibleBackend(InferenceBackend):
    """Generic OpenAI-style /v1/chat/completions client.

    Works with OpenAI proper, GLM (智谱 v4), DeepSeek, and any provider
    that exposes the OpenAI chat-completions schema. Streaming uses SSE
    `data: {...}\\n\\n` chunks.

    `provider_label` is the short tag shown in the UI (e.g. "openai", "glm",
    "deepseek"). It also forms the prefix on `backend_name()`.
    """

    def __init__(
        self,
        tracker: TokenTracker,
        provider_label: str,
        base_url: str,
        api_key: str,
        model: str,
    ):
        self._tracker = tracker
        self._provider = provider_label
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    def _build_messages(self, system_prompt: str, messages: list[dict]) -> list[dict]:
        out = [{"role": "system", "content": system_prompt}] if system_prompt else []
        for m in messages:
            out.append({"role": m["role"], "content": m["content"]})
        return out

    def _is_strict_openai(self) -> bool:
        """OpenAI's GPT-5 / o-series enforces stricter parameter rules:
        - `max_tokens` → must be `max_completion_tokens`
        - `temperature` → only the default 1 is allowed
        """
        return self._provider == "openai" and self._model.startswith(("gpt-5", "o1", "o3"))

    def _token_field(self) -> str:
        return "max_completion_tokens" if self._is_strict_openai() else "max_tokens"

    def _coerce_temperature(self, t: float) -> float:
        # GPT-5 / o-series rejects any non-default temperature.
        return 1.0 if self._is_strict_openai() else t

    async def complete(
        self,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int = 2048,
        temperature: float = 0.7,
    ) -> str:
        import httpx
        body: dict = {
            "model": self._model,
            "messages": self._build_messages(system_prompt, messages),
            self._token_field(): max_tokens,
            "temperature": self._coerce_temperature(temperature),
            "stream": False,
        }
        # GPT-5 / o-series spends a lot of tokens on hidden reasoning before
        # producing visible content — set reasoning_effort=low so most of the
        # max_tokens budget goes to the actual answer.
        if self._is_strict_openai():
            body["reasoning_effort"] = "low"
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                resp = await client.post(
                    f"{self._base_url}/chat/completions",
                    headers=self._headers(),
                    json=body,
                )
                if resp.status_code >= 400:
                    # Capture body before raising — providers often put the
                    # actual reason (bad model name, content policy, …) here.
                    err_body = resp.text[:600]
                    logger.error(
                        f"{self._provider} {self._model} HTTP {resp.status_code}: {err_body}"
                    )
                resp.raise_for_status()
                data = resp.json()
            msg = data.get("choices", [{}])[0].get("message", {}) or {}
            # Some providers (e.g. DeepSeek thinking mode) return the chain-of-thought
            # in reasoning_content and an empty/null content. Fall back to it.
            content = msg.get("content") or msg.get("reasoning_content") or ""
            usage = data.get("usage") or {}
            self._tracker.record(
                input_tokens=usage.get("prompt_tokens", 0),
                output_tokens=usage.get("completion_tokens", 0),
                label=f"{self._provider}:{self._model}",
            )
            return content
        except Exception as e:
            logger.error(f"{self._provider} complete error ({self._model}): {e}")
            raise

    async def stream(
        self,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int = 2048,
        temperature: float = 0.7,
    ) -> AsyncGenerator[str, None]:
        import httpx, json as _json
        body: dict = {
            "model": self._model,
            "messages": self._build_messages(system_prompt, messages),
            self._token_field(): max_tokens,
            "temperature": self._coerce_temperature(temperature),
            "stream": True,
        }
        if self._is_strict_openai():
            body["reasoning_effort"] = "low"
        prompt_tokens = 0
        completion_tokens = 0
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                async with client.stream(
                    "POST",
                    f"{self._base_url}/chat/completions",
                    headers=self._headers(),
                    json=body,
                ) as resp:
                    if resp.status_code >= 400:
                        err_body = (await resp.aread())[:600].decode("utf-8", errors="replace")
                        logger.error(
                            f"{self._provider} {self._model} stream HTTP {resp.status_code}: {err_body}"
                        )
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line:
                            continue
                        if not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if payload == "[DONE]":
                            break
                        try:
                            chunk = _json.loads(payload)
                        except _json.JSONDecodeError:
                            continue
                        delta = (
                            chunk.get("choices", [{}])[0]
                                 .get("delta", {})
                        ) or {}
                        # Stream both content and reasoning_content (thinking mode)
                        # so the user actually sees output even when the provider
                        # routes the visible answer to reasoning_content.
                        text = delta.get("content") or delta.get("reasoning_content") or ""
                        if text:
                            yield text
                        usage = chunk.get("usage")
                        if usage:
                            prompt_tokens = usage.get("prompt_tokens", prompt_tokens)
                            completion_tokens = usage.get("completion_tokens", completion_tokens)
        except Exception as e:
            logger.error(f"{self._provider} stream error ({self._model}): {e}")
            raise
        finally:
            self._tracker.record(
                input_tokens=prompt_tokens,
                output_tokens=completion_tokens,
                label=f"{self._provider}-stream:{self._model}",
            )

    def backend_name(self) -> str:
        return f"{self._provider}:{self._model}"


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
    """Strong backend (judge tier alias). Honors strong_backend_override=ollama."""
    settings = get_settings()
    if getattr(settings, "strong_backend_override", "") == "ollama" and getattr(settings, "ollama_base_url", ""):
        return OllamaBackend(
            tracker=tracker,
            base_url=settings.ollama_base_url,
            model=getattr(settings, "ollama_model", "qwen2.5:7b"),
        )
    if model:
        return ClaudeBackend(tracker=tracker, model=model)
    spec = getattr(settings, "tier_judge", "claude:claude-sonnet-4-6")
    return get_backend_from_spec(spec, tracker)


def get_model_pool(tracker: TokenTracker) -> list[InferenceBackend]:
    """Get a pool of diverse models for multi-perspective persona generation.

    Resolution order:
      1. WHATIF_PERSONA_POOL  (mixed providers, e.g. "ollama:qwen2.5:7b,glm:glm-4-flash,openai:gpt-5-mini")
      2. WHATIF_OLLAMA_MODEL_POOL  (legacy, Ollama only)
      3. Single fast backend fallback
    """
    settings = get_settings()
    persona_pool_str = getattr(settings, "persona_pool", "")
    ollama_pool_str = getattr(settings, "ollama_model_pool", "")
    base_url = getattr(settings, "ollama_base_url", "")

    # 1) Mixed-provider pool (preferred)
    if persona_pool_str:
        specs = [s.strip() for s in persona_pool_str.split(",") if s.strip()]
        # provider:model where model itself can contain ":" (e.g. ollama:qwen2.5:7b),
        # so simple comma split is fine — we hand each spec to get_backend_from_spec.
        backends = []
        for s in specs:
            try:
                backends.append(get_backend_from_spec(s, tracker))
            except Exception as e:
                logger.warning(f"persona pool: skipping invalid spec '{s}': {e}")
        if backends:
            return backends

    # 2) Legacy ollama-only pool
    if ollama_pool_str and base_url:
        models = [m.strip() for m in ollama_pool_str.split(",") if m.strip()]
        if models:
            return [
                OllamaBackend(tracker=tracker, base_url=base_url, model=m)
                for m in models
            ]

    # 3) Fallback: single fast backend
    return [get_fast_backend(tracker)]


def get_backend_for_persona(
    tracker: TokenTracker, persona_index: int,
) -> InferenceBackend:
    """Get a specific backend for a persona by index (round-robin from pool)."""
    pool = get_model_pool(tracker)
    return pool[persona_index % len(pool)]


def get_backend_from_spec(spec: str, tracker: TokenTracker) -> InferenceBackend:
    """Parse a `provider:model` spec and return the appropriate backend.

    Supported providers:
        claude:<model>     → Anthropic
        ollama:<model>     → local Ollama
        openai:<model>     → OpenAI
        glm:<model>        → 智谱 GLM (OpenAI-compatible)
        deepseek:<model>   → DeepSeek (OpenAI-compatible)

    Falls back to Claude/default on any unrecognized spec.
    """
    settings = get_settings()
    if ":" not in spec:
        return ClaudeBackend(tracker=tracker, model=spec)
    provider, _, model = spec.partition(":")
    provider = provider.strip().lower()
    model = model.strip()

    if provider == "claude":
        return ClaudeBackend(tracker=tracker, model=model)
    if provider == "ollama":
        return OllamaBackend(
            tracker=tracker,
            base_url=getattr(settings, "ollama_base_url", "http://localhost:11434"),
            model=model or getattr(settings, "ollama_model", "qwen2.5:7b"),
        )
    if provider == "openai":
        return OpenAICompatibleBackend(
            tracker=tracker,
            provider_label="openai",
            base_url=getattr(settings, "openai_base_url", "https://api.openai.com/v1"),
            api_key=getattr(settings, "openai_api_key", ""),
            model=model,
        )
    if provider == "glm":
        return OpenAICompatibleBackend(
            tracker=tracker,
            provider_label="glm",
            base_url=getattr(settings, "glm_base_url", "https://open.bigmodel.cn/api/paas/v4"),
            api_key=getattr(settings, "glm_api_key", ""),
            model=model,
        )
    if provider == "deepseek":
        return OpenAICompatibleBackend(
            tracker=tracker,
            provider_label="deepseek",
            base_url=getattr(settings, "deepseek_base_url", "https://api.deepseek.com/v1"),
            api_key=getattr(settings, "deepseek_api_key", ""),
            model=model,
        )
    logger.warning(f"Unknown backend provider '{provider}' — falling back to Claude")
    return ClaudeBackend(tracker=tracker, model=model)


def get_cheap_backend(tracker: TokenTracker) -> InferenceBackend:
    """Tier-1 — cheap/fast for tagging, label generation, injection variants."""
    settings = get_settings()
    spec = getattr(settings, "tier_cheap", "claude:claude-haiku-4-5-20251001")
    return get_backend_from_spec(spec, tracker)


def get_judge_backend(tracker: TokenTracker) -> InferenceBackend:
    """Tier-2 — per-round evaluation, synthesis. Sonnet by default."""
    settings = get_settings()
    if getattr(settings, "strong_backend_override", "") == "ollama" and getattr(settings, "ollama_base_url", ""):
        return OllamaBackend(tracker=tracker, base_url=settings.ollama_base_url, model=getattr(settings, "ollama_model", "qwen2.5:7b"))
    spec = getattr(settings, "tier_judge", "claude:claude-sonnet-4-6")
    return get_backend_from_spec(spec, tracker)


def get_decider_backend(tracker: TokenTracker) -> InferenceBackend:
    """Tier-3 — final calls / meta-synthesis. Opus by default. Used sparingly."""
    settings = get_settings()
    spec = getattr(settings, "tier_decider", "claude:claude-opus-4-7")
    return get_backend_from_spec(spec, tracker)


def get_summarizer_backend(tracker: TokenTracker) -> InferenceBackend:
    """Local-model backend for cheap, high-volume per-statement summaries.

    Picks ollama_summarizer_model (typically a larger local model like
    qwen3.5:27b) if configured; otherwise reuses the default fast backend.
    """
    settings = get_settings()
    base_url = getattr(settings, "ollama_base_url", "")
    summarizer_model = getattr(settings, "ollama_summarizer_model", "") or getattr(settings, "ollama_model", "")

    if base_url and summarizer_model:
        return OllamaBackend(tracker=tracker, base_url=base_url, model=summarizer_model)
    return get_fast_backend(tracker)
