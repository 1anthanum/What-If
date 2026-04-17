"""Claude API client wrapper with streaming, retry, and token tracking."""

import anthropic
from typing import AsyncGenerator
from app.config import get_settings
from app.core.token_tracker import TokenTracker


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
        system_prompt: str,
        messages: list[dict],
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> str:
        """Non-streaming completion. Returns full response text."""
        response = await self.async_client.messages.create(
            model=self.model,
            max_tokens=max_tokens or self.max_tokens,
            temperature=temperature if temperature is not None else self.temperature,
            system=system_prompt,
            messages=messages,
        )

        # Track token usage
        self.tracker.record(
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            label="complete",
        )

        return response.content[0].text

    async def stream(
        self,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> AsyncGenerator[str, None]:
        """Streaming completion. Yields text chunks as they arrive."""
        input_tokens = 0
        output_tokens = 0

        async with self.async_client.messages.stream(
            model=self.model,
            max_tokens=max_tokens or self.max_tokens,
            temperature=temperature if temperature is not None else self.temperature,
            system=system_prompt,
            messages=messages,
        ) as stream:
            async for event in stream:
                if hasattr(event, "type"):
                    if event.type == "content_block_delta" and hasattr(event.delta, "text"):
                        yield event.delta.text
                    elif event.type == "message_start" and hasattr(event.message, "usage"):
                        input_tokens = event.message.usage.input_tokens
                    elif event.type == "message_delta" and hasattr(event.usage, "output_tokens"):
                        output_tokens = event.usage.output_tokens

        self.tracker.record(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            label="stream",
        )

    def get_usage_summary(self) -> dict:
        """Return current session's token usage and cost estimate."""
        return self.tracker.summary()
