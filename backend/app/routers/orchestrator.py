"""API routes for the Cross-Module Feedback Loop (Orchestrator) and Auto-Loop."""

from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException
from app.services.orchestrator import OrchestratorService
from app.services.auto_loop import AutoLoopScheduler
from app.core.streaming import create_sse_response
from app.schemas.orchestration import FeedbackLoopConfig

router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"])

_service = OrchestratorService()
_auto_loop = AutoLoopScheduler()


# ─── Feedback Loop Endpoints ─────────────────────────────────

@router.post("/feedback-loop")
async def run_feedback_loop(config: FeedbackLoopConfig):
    """
    Run a cross-module feedback loop. Returns SSE stream.

    The loop chains: counterfactual → causal graph → debate → refinement.
    Repeats up to max_iterations times, or until convergence is detected.
    """
    return create_sse_response(
        _service.run_feedback_loop(config)
    )


@router.get("/results/{loop_id}")
async def get_loop_result(loop_id: str):
    """Get a cached feedback loop result."""
    result = _service.get_result(loop_id)
    if not result:
        raise HTTPException(status_code=404, detail="Loop result not found")
    return result.model_dump()


# ─── Auto-Loop Endpoints ──────────────────────────────────────

class AutoLoopRequest(BaseModel):
    """Request body for autonomous exploration."""
    event_id: str
    seed_hypothesis: str
    max_cycles: int = Field(default=5, ge=1, le=20)
    max_iterations_per_loop: int = Field(default=2, ge=1, le=5)
    time_horizon: str = "30 years"


@router.post("/auto-loop")
async def run_auto_loop(req: AutoLoopRequest):
    """
    Run autonomous continuous exploration. Returns SSE stream.

    Chains multiple feedback loops sequentially. After each loop, the system
    extracts the next hypothesis from the synthesis and starts a new loop.
    Continues until convergence, max_cycles, or cancellation.
    """
    return create_sse_response(
        _auto_loop.run(
            event_id=req.event_id,
            seed_hypothesis=req.seed_hypothesis,
            max_cycles=req.max_cycles,
            max_iterations_per_loop=req.max_iterations_per_loop,
            time_horizon=req.time_horizon,
        )
    )


@router.post("/auto-loop/{session_id}/cancel")
async def cancel_auto_loop(session_id: str):
    """Cancel a running auto-loop session."""
    AutoLoopScheduler.cancel(session_id)
    return {"status": "cancellation_requested", "session_id": session_id}


@router.get("/auto-loop/{session_id}")
async def get_auto_loop_result(session_id: str):
    """Get a cached auto-loop result."""
    result = _auto_loop.get_result(session_id)
    if not result:
        raise HTTPException(status_code=404, detail="Auto-loop session not found")
    return {
        "session_id": result.session_id,
        "event_id": result.event_id,
        "seed_hypothesis": result.seed_hypothesis,
        "total_cycles": result.total_cycles,
        "stopped_reason": result.stopped_reason,
        "evolution_chain": result.evolution_chain,
        "cycles": [
            {
                "cycle": c.cycle,
                "hypothesis": c.hypothesis,
                "loop_id": c.loop_id,
                "synthesis_preview": c.synthesis[:300],
                "next_hypothesis": c.next_hypothesis,
                "converged": c.converged,
            }
            for c in result.cycles
        ],
    }
