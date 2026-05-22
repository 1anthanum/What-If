"""Session archive endpoints — list / search / fetch / delete persisted
auto-loop sessions.

Powered by app.core.database. Sessions land in the DB automatically when
they finish (via ``archive_auto_loop`` hooked into the SSE bus pipe).
"""

from fastapi import APIRouter, HTTPException, Query

from app.core.database import (
    list_sessions, get_session, session_stats, delete_session,
)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("")
async def get_sessions(
    q: str | None = Query(None, description="Optional search query — FTS5 for ASCII, LIKE for CJK"),
    limit: int = Query(30, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """List recent sessions, newest first. Optional ?q= filters by text."""
    return {"sessions": list_sessions(q=q, limit=limit, offset=offset)}


@router.get("/_stats")
async def get_stats():
    """Cross-session aggregate stats — total sessions, avg cycles, per-persona
    dogmatic counts, etc. Used by future analytics dashboards."""
    return session_stats()


@router.get("/{session_id}")
async def get_session_detail(session_id: str):
    """Full session: cycles + persona statements + judge verdicts."""
    s = get_session(session_id)
    if s is None:
        raise HTTPException(404, f"session {session_id} not found")
    return s


@router.delete("/{session_id}")
async def remove_session(session_id: str):
    """Delete a session and all its cycles / personas / verdicts."""
    if not delete_session(session_id):
        raise HTTPException(404, f"session {session_id} not found")
    return {"status": "deleted", "session_id": session_id}
