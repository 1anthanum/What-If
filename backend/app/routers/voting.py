"""Voting Hall API."""

from fastapi import APIRouter
from app.core.streaming import create_sse_response
from app.core.token_tracker import TokenTracker
from app.schemas.voting import VotingConfig
from app.services.voting import run_voting, aggregate_model_profile

router = APIRouter(prefix="/api/voting", tags=["voting"])
_tracker = TokenTracker()


@router.post("/run")
async def vote(config: VotingConfig):
    """Run a voting session. Returns SSE stream of vote events."""
    return create_sse_response(run_voting(config, _tracker))


@router.get("/usage")
async def get_usage():
    return _tracker.summary()


@router.get("/profile")
async def get_profile(model: str | None = None):
    """Aggregate model behavior across all past voting sessions."""
    return aggregate_model_profile(model)
