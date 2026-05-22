"""Observability — surfaces per-backend latency, tokens, errors across the
live service singletons + SSE bus registry state.

Read-only. Polled by the frontend "📊 Metrics" panel; no auth in front of
it on purpose (it's dev-facing). If exposed publicly, wrap with auth."""

from fastapi import APIRouter

from app.core.sse_bus import get_registry

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


def _gather_trackers() -> dict[str, "TokenTracker"]:  # noqa: F821
    """Resolve known service singletons lazily — keeps this module decoupled
    from router init order."""
    out: dict[str, object] = {}
    try:
        from app.routers.orchestrator import _service, _auto_loop, _autonomous
        out["orchestrator"] = _service.tracker
        out["auto_loop"] = _auto_loop.tracker
        out["autonomous"] = _autonomous.tracker
    except Exception:
        pass
    try:
        from app.routers.debate import _service as _debate_svc
        out["debate"] = _debate_svc.tracker
    except Exception:
        pass
    try:
        from app.routers.causal import _service as _causal_svc
        out["causal"] = _causal_svc.tracker
    except Exception:
        pass
    try:
        from app.routers.counterfactual import _service as _cf_svc
        out["counterfactual"] = _cf_svc.tracker
    except Exception:
        pass
    try:
        from app.routers.voting import _tracker as _voting_tracker
        out["voting"] = _voting_tracker
    except Exception:
        pass
    return out


@router.get("")
async def get_metrics():
    """Aggregate metrics across all known service trackers + SSE bus state.

    Response shape:
    {
      "trackers": { service_name: { summary, latency_by_backend, latency_by_phase } },
      "buses": { active_sessions, completed_sessions, total_buffered_events }
    }
    """
    trackers = _gather_trackers()
    out: dict = {"trackers": {}}
    for name, tracker in trackers.items():
        try:
            out["trackers"][name] = {
                "total_calls": len(tracker.records),
                "total_input_tokens": tracker.total_input_tokens(),
                "total_output_tokens": tracker.total_output_tokens(),
                "total_cached_input_tokens": tracker.total_cached_input_tokens(),
                "estimated_cost_usd": tracker.estimated_cost_usd(),
                "by_backend": tracker.by_backend(),
                "by_tier": tracker.by_tier(),
                "by_phase": tracker.by_phase(),
                "latency_by_backend": tracker.latency_by_backend(),
                "latency_by_phase": tracker.latency_by_phase(),
            }
        except Exception as e:
            out["trackers"][name] = {"error": str(e)[:200]}

    # Bus registry snapshot
    registry = get_registry()
    buses_summary = {"active": 0, "completed": 0, "buffered_events": 0, "by_session": []}
    for sid, bus in list(registry._buses.items()):
        buses_summary["buffered_events"] += bus.buffered_count
        if bus.completed:
            buses_summary["completed"] += 1
        else:
            buses_summary["active"] += 1
        buses_summary["by_session"].append({
            "session_id": sid,
            "completed": bus.completed,
            "next_event_id": bus.next_event_id,
            "buffered": bus.buffered_count,
            "last_activity_age_s": round((__import__("time").time() - bus.last_activity), 1),
        })
    out["buses"] = buses_summary
    return out
