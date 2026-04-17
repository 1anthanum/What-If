"""Debate Room API endpoints."""

from fastapi import APIRouter, HTTPException
from app.schemas.debate import DebateStartRequest, EventInjection
from app.services.debate_room import DebateRoomService
from app.core.streaming import create_sse_response

router = APIRouter(prefix="/api/debate", tags=["debate"])

# Singleton service instance (in production, use proper DI)
_service = DebateRoomService()


@router.post("/start")
async def start_debate(request: DebateStartRequest):
    """Create a new debate session with personas."""
    session = _service.start_session(request)
    return {
        "session_id": session.session_id,
        "scenario": session.scenario_hypothesis,
        "personas": [
            {"id": p["id"], "name": p["name"], "role": p["role"]}
            for p in session.personas
        ],
        "status": "active",
    }


@router.post("/{session_id}/round")
async def run_debate_round(session_id: str):
    """Execute one debate round. Returns SSE stream of persona responses."""
    session = _service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    return create_sse_response(_service.run_round(session_id))


@router.post("/{session_id}/inject")
async def inject_event(session_id: str, event: EventInjection):
    """Inject an event into the debate (takes effect next round)."""
    success = _service.inject_event(session_id, event.description)
    if not success:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    return {"status": "event_queued", "event": event.description}


@router.get("/{session_id}/summary")
async def get_summary(session_id: str):
    """Generate an analyst summary of the debate so far."""
    session = _service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    if not session.rounds:
        raise HTTPException(status_code=400, detail="No rounds to summarize")

    summary_text = await _service.generate_summary(session_id)
    return {
        "session_id": session_id,
        "rounds_analyzed": len(session.rounds),
        "summary": summary_text,
        "token_usage": _service.get_usage(),
    }


@router.get("/{session_id}")
async def get_session(session_id: str):
    """Get current state of a debate session."""
    session = _service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    return {
        "session_id": session.session_id,
        "scenario": session.scenario_hypothesis,
        "personas": [
            {"id": p["id"], "name": p["name"], "role": p["role"]}
            for p in session.personas
        ],
        "current_round": session.current_round,
        "rounds": [
            {
                "round_number": r.round_number,
                "injected_event": r.injected_event,
                "statements": [
                    {
                        "persona_id": s.persona_id,
                        "persona_name": s.persona_name,
                        "content": s.content,
                    }
                    for s in r.statements
                ],
            }
            for r in session.rounds
        ],
        "pending_event": session.pending_event,
        "status": session.status,
        "token_usage": _service.get_usage(),
    }


@router.get("/personas/list")
async def list_personas():
    """List all available persona templates."""
    from app.core.prompt_engine import PromptEngine
    engine = PromptEngine()
    return {"personas": engine.list_personas()}
