"""SSE (Server-Sent Events) streaming utilities for FastAPI."""

import json
from typing import AsyncGenerator
from starlette.responses import StreamingResponse


def create_sse_response(generator: AsyncGenerator) -> StreamingResponse:
    """Wrap an async generator into an SSE StreamingResponse."""
    return StreamingResponse(
        _sse_wrapper(generator),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def create_sse_response_from_bus(
    bus,
    from_id: int = 0,
) -> StreamingResponse:
    """Stream events from a SessionEventBus, including `id:` field so the
    client can reconnect with ``Last-Event-ID`` and resume from where it
    dropped off.

    Importing SessionEventBus lazily to keep streaming.py free of an
    import cycle with the bus module.
    """
    async def gen():
        async for eid, event in bus.subscribe(from_id=from_id):
            if not isinstance(event, dict):
                continue
            event_type = event.get("type", "message")
            data = json.dumps(event.get("data", {}), ensure_ascii=False)
            yield f"id: {eid}\nevent: {event_type}\ndata: {data}\n\n"
        # Final "done" so the client knows the cycle finished cleanly.
        yield f"event: done\ndata: {json.dumps({'status': 'complete'})}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _sse_wrapper(generator: AsyncGenerator):
    """Format async generator output as SSE events."""
    try:
        async for event in generator:
            if isinstance(event, dict):
                event_type = event.get("type", "message")
                data = json.dumps(event.get("data", event), ensure_ascii=False)
                yield f"event: {event_type}\ndata: {data}\n\n"
            elif isinstance(event, str):
                yield f"data: {json.dumps({'text': event}, ensure_ascii=False)}\n\n"
        # Send completion event
        yield f"event: done\ndata: {json.dumps({'status': 'complete'})}\n\n"
    except Exception as e:
        error_data = json.dumps({"error": str(e)}, ensure_ascii=False)
        yield f"event: error\ndata: {error_data}\n\n"


def sse_event(event_type: str, data: dict) -> dict:
    """Helper to create a typed SSE event dict."""
    return {"type": event_type, "data": data}
