"""Tests for SSE streaming utilities."""

import json
import pytest
from app.core.streaming import sse_event, _sse_wrapper


class TestSseEvent:
    def test_creates_typed_event(self):
        event = sse_event("round_start", {"round_number": 1})
        assert event["type"] == "round_start"
        assert event["data"]["round_number"] == 1

    def test_event_with_complex_data(self):
        event = sse_event("persona_complete", {
            "persona_id": "imf",
            "persona_name": "IMF经济学家",
            "content": "分析内容...",
        })
        assert event["data"]["persona_name"] == "IMF经济学家"


class TestSseWrapper:
    @pytest.mark.asyncio
    async def test_dict_events_formatted(self):
        async def gen():
            yield {"type": "test", "data": {"msg": "hello"}}

        chunks = []
        async for chunk in _sse_wrapper(gen()):
            chunks.append(chunk)

        # First chunk is the event, last chunk is the "done" event
        assert "event: test" in chunks[0]
        assert '"msg": "hello"' in chunks[0]
        assert "event: done" in chunks[-1]

    @pytest.mark.asyncio
    async def test_string_events_formatted(self):
        async def gen():
            yield "plain text"

        chunks = []
        async for chunk in _sse_wrapper(gen()):
            chunks.append(chunk)

        assert "data:" in chunks[0]
        assert "plain text" in chunks[0]

    @pytest.mark.asyncio
    async def test_done_event_sent_at_end(self):
        async def gen():
            yield sse_event("ping", {})

        chunks = []
        async for chunk in _sse_wrapper(gen()):
            chunks.append(chunk)

        last = chunks[-1]
        assert "event: done" in last
        assert "complete" in last

    @pytest.mark.asyncio
    async def test_error_handling(self):
        async def gen():
            raise ValueError("test error")
            yield  # noqa: unreachable

        chunks = []
        async for chunk in _sse_wrapper(gen()):
            chunks.append(chunk)

        assert any("error" in c for c in chunks)
        assert any("test error" in c for c in chunks)
