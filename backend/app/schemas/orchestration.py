"""Schemas for the Cross-Module Feedback Loop (Orchestrator)."""

import uuid
from pydantic import BaseModel, Field


class FeedbackLoopConfig(BaseModel):
    """Configuration for a cross-module feedback loop."""
    event_id: str
    modification: str
    time_horizon: str = "30 years"
    max_iterations: int = 3
    modules: list[str] = Field(
        default_factory=lambda: ["counterfactual", "causal", "debate"]
    )
    debate_rounds: int = 2
    n_debate_personas: int = 4


class LoopIteration(BaseModel):
    """Result of a single loop iteration across modules."""
    iteration: int
    counterfactual_summary: str = ""
    key_divergences: list[str] = Field(default_factory=list)
    causal_insights: list[str] = Field(default_factory=list)
    causal_graph_id: str = ""
    debate_consensus: list[str] = Field(default_factory=list)
    debate_dissent: list[str] = Field(default_factory=list)
    refinement_for_next: str = ""


class FeedbackLoopResult(BaseModel):
    """Complete result of a feedback loop run."""
    loop_id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    config: FeedbackLoopConfig
    iterations: list[LoopIteration] = Field(default_factory=list)
    final_synthesis: str = ""
    convergence_achieved: bool = False
    total_iterations: int = 0
    token_usage: dict = Field(default_factory=dict)
