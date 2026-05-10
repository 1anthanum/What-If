"""Schemas for the Voting Hall — model panel votes on a structured question."""

from pydantic import BaseModel, Field
from typing import Literal


class VotingConfig(BaseModel):
    """Vote a panel of models on a single structured question."""
    model_config = {"protected_namespaces": ()}

    question: str = Field(..., min_length=4, description="The proposition being voted on")
    context: str = Field("", description="Optional background / framing")
    vote_type: Literal["binary", "scale10"] = "binary"

    # Mode controls
    mode: Literal["panel", "calibration", "matrix"] = "panel"

    # Panel mode: comma-sep specs (defaults to persona_pool)
    models: list[str] = Field(default_factory=list)

    # Calibration mode: single model, varying temps
    calibration_model: str = "claude:claude-sonnet-4-6"
    votes_per_model: int = Field(default=1, ge=1, le=15)

    # Generation
    max_tokens: int = Field(default=200, ge=50, le=600)

    # Method flags — independent, can stack. Each adds an analysis pass.
    framing_flip: bool = False        # also run the negated question, then distill
    super_forecaster: bool = False    # require base_rate + adjustments + final
    role_framing: bool = False        # each model votes 3x as optimist/pessimist/neutral
    delphi: bool = False              # 3-phase: silent vote → cross-debate → re-vote
    human_baseline: bool = False      # frontend captures user's pre-vote for comparison
    human_pre_vote: str = ""          # filled by frontend if human_baseline=true


class SingleVote(BaseModel):
    """One model casting one vote."""
    model: str
    temperature: float
    vote: str        # for binary: "yes"|"no"|"uncertain"; for scale10: "1".."10"
    confidence: int  # 0..100
    rationale: str   # ≤60 字
    raw: str = ""    # raw model output for debugging
    duration_ms: int = 0
