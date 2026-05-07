"""Schemas for the Autonomous Topic Explorer mode."""

from pydantic import BaseModel, Field


class AutonomousDebateConfig(BaseModel):
    """Long-running autonomous topic exploration with tiered models."""
    model_config = {"protected_namespaces": ()}

    seed_topic: str = Field(..., description="The hypothesis to explore, e.g. '如果 AGI 在 2027 年开源'")
    domain: str = Field("general", description="Persona-selection domain")

    # Budget controls
    max_cycles: int = Field(8, ge=1, le=40, description="Hard cap on (baseline + branches) iterations")
    time_budget_seconds: int = Field(7200, ge=60, le=14400, description="Wall-clock budget; default 2h")
    cost_budget_usd: float = Field(5.0, ge=0.1, le=50.0, description="Stop when cumulative Claude spend exceeds this")

    # Branching shape
    rounds_per_branch: int = Field(2, ge=1, le=8, description="Debate rounds inside each branch")
    branches_per_cycle: int = Field(3, ge=1, le=6, description="How many injection variants Haiku generates per cycle")
    confidence_threshold: int = Field(85, ge=50, le=100, description="Stop early when Opus confidence ≥ this")


class BranchEval(BaseModel):
    """Sonnet-issued aggregate score for a whole branch."""
    confidence: int = Field(..., ge=0, le=100)
    coherence: int = Field(..., ge=0, le=100)
    novelty: int = Field(..., ge=0, le=100)
    risk_signal: int = Field(..., ge=0, le=100)
    one_line_takeaway: str = ""
    notable_disagreement: str = ""


class BranchSummary(BaseModel):
    """Result of one explored branch."""
    branch_id: str
    parent_branch_id: str | None = None
    cycle: int
    injection: str = ""
    rounds_run: int = 0
    persona_summaries: list[dict] = Field(default_factory=list)  # [{persona, summary}]
    eval: BranchEval | None = None


class DeciderVerdict(BaseModel):
    """Opus's call after seeing latest round of branches."""
    action: str  # "deepen" / "diverge" / "converge"
    target_branch_id: str | None = None
    next_injection_seeds: list[str] = Field(default_factory=list)  # hints for Haiku
    rationale: str = ""
    overall_confidence: int = 0
