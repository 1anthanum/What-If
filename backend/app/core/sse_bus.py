"""Per-session SSE event bus — decouples cycle execution from HTTP connection
so a client can disconnect (wifi blip, tab refresh) and resume without
restarting the cycle.

Design:
- Each session gets a ``SessionEventBus`` with a bounded ring buffer.
- The cycle generator runs in a background asyncio task and publishes
  every event to the bus.
- HTTP connections (initial + reconnect) ``subscribe(from_id=...)`` to
  the bus: they replay buffered events with id > from_id, then yield
  live events as they arrive, until the bus is marked completed.
- Completed buses are GC'd after a TTL so resume requests for an old
  cycle still work for a few minutes after it finishes.

This is wired to the philosophical/historical auto-loop first
(highest-value SSE in the app). Other endpoints can adopt the same
pattern incrementally.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from typing import AsyncGenerator

logger = logging.getLogger(__name__)


class SessionEventBus:
    """In-memory ring buffer + live tail for one session's SSE events."""

    DEFAULT_BUFFER = 1000

    def __init__(self, session_id: str, buffer_size: int = DEFAULT_BUFFER) -> None:
        self.session_id = session_id
        self._buffer: deque[tuple[int, dict]] = deque(maxlen=buffer_size)
        self._next_id = 1
        self._subscribers: set[asyncio.Queue] = set()
        self._completed = False
        self._created_at = time.time()
        self._last_activity = time.time()

    @property
    def next_event_id(self) -> int:
        return self._next_id

    @property
    def completed(self) -> bool:
        return self._completed

    @property
    def last_activity(self) -> float:
        return self._last_activity

    @property
    def buffered_count(self) -> int:
        return len(self._buffer)

    def publish(self, event: dict) -> int:
        """Push an event; broadcast to all live subscribers. Returns its id."""
        if self._completed:
            logger.debug("publish() to completed bus %s ignored", self.session_id)
            return -1
        eid = self._next_id
        self._next_id += 1
        self._last_activity = time.time()
        self._buffer.append((eid, event))
        for q in list(self._subscribers):
            try:
                q.put_nowait((eid, event))
            except asyncio.QueueFull:
                # Slow subscriber — drop. They'll catch up on reconnect
                # via the ring buffer replay.
                logger.warning("subscriber queue full on bus %s; dropping eid=%d", self.session_id, eid)
        return eid

    def mark_completed(self) -> None:
        """Signal end-of-stream; wake all subscribers so they finish cleanly."""
        if self._completed:
            return
        self._completed = True
        self._last_activity = time.time()
        for q in list(self._subscribers):
            try:
                q.put_nowait((-1, None))  # sentinel
            except asyncio.QueueFull:
                pass

    async def subscribe(self, from_id: int = 0) -> AsyncGenerator[tuple[int, dict], None]:
        """Yield (event_id, event) pairs with id > from_id.

        Behavior:
        - Phase 1: replay any buffered events that satisfy id > from_id.
        - Phase 2: if bus not yet completed, attach a live queue and yield
          events as they're published.
        - Returns when bus is marked completed.
        """
        replayed_max = from_id
        # Phase 1: replay
        for eid, ev in list(self._buffer):
            if eid > from_id:
                yield eid, ev
                replayed_max = eid

        if self._completed:
            return

        # Phase 2: subscribe to live
        q: asyncio.Queue = asyncio.Queue(maxsize=2000)
        self._subscribers.add(q)
        try:
            while True:
                eid, ev = await q.get()
                if ev is None and eid == -1:
                    return
                if eid > replayed_max:
                    yield eid, ev
                    replayed_max = eid
        finally:
            self._subscribers.discard(q)


class EventBusRegistry:
    """Singleton registry of active session buses + idle GC."""

    GC_TTL_SECONDS = 600  # buses idle 10+ min get cleaned up

    def __init__(self) -> None:
        self._buses: dict[str, SessionEventBus] = {}

    def create(self, session_id: str, buffer_size: int = SessionEventBus.DEFAULT_BUFFER) -> SessionEventBus:
        # If a bus already exists for this session_id (rare race), close the
        # old one — fresh start is more honest than silent merge.
        old = self._buses.get(session_id)
        if old is not None:
            old.mark_completed()
        bus = SessionEventBus(session_id, buffer_size=buffer_size)
        self._buses[session_id] = bus
        return bus

    def get(self, session_id: str) -> SessionEventBus | None:
        return self._buses.get(session_id)

    def cleanup_idle(self) -> int:
        """Remove completed buses whose last activity is older than TTL.
        Returns count of buses removed."""
        now = time.time()
        removed = 0
        for sid in list(self._buses.keys()):
            bus = self._buses[sid]
            if bus.completed and (now - bus.last_activity) > self.GC_TTL_SECONDS:
                del self._buses[sid]
                removed += 1
        return removed


_registry = EventBusRegistry()


def get_registry() -> EventBusRegistry:
    """Module-level singleton accessor."""
    return _registry


async def pipe_to_bus(source: AsyncGenerator[dict, None], bus: SessionEventBus) -> None:
    """Drain a source generator into the bus. Marks bus completed when done.

    Used by the router to run a cycle generator in a background task while
    HTTP clients subscribe to the bus."""
    try:
        async for event in source:
            bus.publish(event)
    except Exception as e:
        logger.exception("source generator failed for bus %s: %s", bus.session_id, e)
        bus.publish({"type": "bus_error", "data": {"detail": str(e)[:300]}})
    finally:
        bus.mark_completed()
