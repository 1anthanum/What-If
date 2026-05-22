"""Claude API client wrapper with streaming, retry, and token tracking."""

import logging
import time
from typing import AsyncGenerator, Union

import anthropic

from app.config import get_settings
from app.core.token_tracker import TokenTracker

logger = logging.getLogger(__name__)

# A system prompt is either a plain string (no caching) or a list of
# Anthropic content blocks. Blocks can carry `cache_control: {"type":
# "ephemeral"}` to mark a cache breakpoint — content from the start of
# `system` through the marker becomes a single cache prefix that
# subsequent requests can reuse at ~10% of the cost.
SystemPrompt = Union[str, list[dict]]


def cached_system(text: str) -> list[dict]:
    """Wrap a stable system prompt in a cache-marked block list.

    Use whenever the same system text is reused across multiple calls
    (e.g. persona prompts within a multi-round debate). Below the
    provider's minimum cacheable size, Anthropic silently skips caching
    — so the helper is always safe to apply.
    """
    return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]


def _flatten_system(system: SystemPrompt) -> str:
    """Concatenate a block-list system prompt back into plain text.
    Used by non-Anthropic backends (Ollama, etc.) that don't speak blocks."""
    if isinstance(system, str):
        return system
    parts: list[str] = []
    for block in system:
        if isinstance(block, dict):
            parts.append(block.get("text", ""))
    return "\n\n".join(p for p in parts if p)

# Claude API constraints we have hit empirically:
#   - `temperature > 1.0` → HTTP 400 ("temperature: range: 0..1") for most models.
#   - Opus 4.7 → HTTP 400 ("temperature is deprecated for this model")
#     when temperature is supplied at all, regardless of value.
# Both clamp/omit decisions live here so callers can keep passing temperature
# without thinking about provider-specific rules.
_TEMP_CLAMP_WARNED = False
_TEMP_OMIT_WARNED: set[str] = set()


# Model-name prefixes that reject the `temperature` field entirely. Update
# this list when Anthropic ships new "deprecated temperature" models —
# behavior is identical to OpenAI's o-series / gpt-5 strict mode.
_TEMP_UNSUPPORTED_PREFIXES: tuple[str, ...] = (
    "claude-opus-4-7",
)


def _supports_temperature(model: str | None) -> bool:
    if not model:
        return True
    return not any(model.startswith(p) for p in _TEMP_UNSUPPORTED_PREFIXES)


def _clamp_temperature(t: float | None) -> float | None:
    global _TEMP_CLAMP_WARNED
    if t is None:
        return None
    if t > 1.0:
        if not _TEMP_CLAMP_WARNED:
            logger.warning(
                "ClaudeClient: temperature=%.2f clamped to 1.0 "
                "(Anthropic API hard-rejects > 1; further occurrences suppressed)",
                t,
            )
            _TEMP_CLAMP_WARNED = True
        return 1.0
    if t < 0.0:
        return 0.0
    return t


def _log_temp_omit_once(model: str) -> None:
    if model not in _TEMP_OMIT_WARNED:
        logger.warning(
            "ClaudeClient: model %s rejects the `temperature` field; "
            "request will omit it (further occurrences for this model suppressed).",
            model,
        )
        _TEMP_OMIT_WARNED.add(model)


class ClaudeClient:
    """Wrapper around the Anthropic SDK with built-in token tracking."""

    def __init__(self, token_tracker: TokenTracker | None = None):
        settings = get_settings()
        self.client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        self.async_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        self.model = settings.claude_model
        self.max_tokens = settings.claude_max_tokens
        self.temperature = settings.claude_temperature
        self.tracker = token_tracker or TokenTracker()

    async def complete(
        self,
        system_prompt: SystemPrompt,
        messages: list[dict],
        max_tokens: int | None = None,
        temperature: float | None = None,
        model: str | None = None,
        tier: str | None = None,
    ) -> str:
        """Non-streaming completion. Returns full response text.

        Args:
            system_prompt: A string (no caching) or a list of content
                blocks (use ``cached_system`` to mark cacheable parts).
            model: Override the default model (e.g. "claude-haiku-4-5-20251001").
            tier: Tier label propagated to TokenTracker for per-tier cost reporting.
        """
        use_model = model or self.model
        effective_temp = _clamp_temperature(
            temperature if temperature is not None else self.temperature,
        )
        kwargs: dict = {
            "model": use_model,
            "max_tokens": max_tokens or self.max_tokens,
            "system": system_prompt,
            "messages": messages,
        }
        if _supports_temperature(use_model):
            kwargs["temperature"] = effective_temp
        else:
            _log_temp_omit_once(use_model)
        t0 = time.perf_counter()
        try:
            response = await self.async_client.messages.create(**kwargs)
        except Exception as e:
            self.tracker.record(
                input_tokens=0, output_tokens=0,
                label=f"complete:{use_model}",
                backend_spec=f"claude:{use_model}",
                tier=tier,
                latency_ms=(time.perf_counter() - t0) * 1000,
                error=type(e).__name__,
            )
            raise
        latency_ms = (time.perf_counter() - t0) * 1000

        cache_create = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
        cache_read = getattr(response.usage, "cache_read_input_tokens", 0) or 0
        self.tracker.record(
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            label=f"complete:{use_model}",
            cached_input_tokens=cache_read,
            backend_spec=f"claude:{use_model}",
            tier=tier,
            latency_ms=latency_ms,
        )

        return response.content[0].text

    async def stream(
        self,
        system_prompt: SystemPrompt,
        messages: list[dict],
        max_tokens: int | None = None,
        temperature: float | None = None,
        model: str | None = None,
        tier: str | None = None,
    ) -> AsyncGenerator[str, None]:
        """Streaming completion. Yields text chunks as they arrive.

        Args:
            system_prompt: A string (no caching) or a list of content
                blocks (use ``cached_system`` to mark cacheable parts).
            model: Override the default model (e.g. "claude-haiku-4-5-20251001").
            tier: Tier label propagated to TokenTracker for per-tier cost reporting.
        """
        use_model = model or self.model
        effective_temp = _clamp_temperature(
            temperature if temperature is not None else self.temperature,
        )
        stream_kwargs: dict = {
            "model": use_model,
            "max_tokens": max_tokens or self.max_tokens,
            "system": system_prompt,
            "messages": messages,
        }
        if _supports_temperature(use_model):
            stream_kwargs["temperature"] = effective_temp
        else:
            _log_temp_omit_once(use_model)
        input_tokens = 0
        output_tokens = 0
        cache_read = 0

        t0 = time.perf_counter()
        err: str | None = None
        try:
            async with self.async_client.messages.stream(**stream_kwargs) as stream:
                async for event in stream:
                    if hasattr(event, "type"):
                        if event.type == "content_block_delta" and hasattr(event.delta, "text"):
                            yield event.delta.text
                        elif event.type == "message_start" and hasattr(event.message, "usage"):
                            input_tokens = event.message.usage.input_tokens
                            cache_read = getattr(event.message.usage, "cache_read_input_tokens", 0) or 0
                        elif event.type == "message_delta" and hasattr(event.usage, "output_tokens"):
                            output_tokens = event.usage.output_tokens
        except Exception as e:
            err = type(e).__name__
            raise
        finally:
            self.tracker.record(
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                label=f"stream:{use_model}",
                cached_input_tokens=cache_read,
                backend_spec=f"claude:{use_model}",
                tier=tier,
                latency_ms=(time.perf_counter() - t0) * 1000,
                error=err,
            )

    def get_usage_summary(self) -> dict:
        """Return current session's token usage and cost estimate."""
        return self.tracker.summary()
