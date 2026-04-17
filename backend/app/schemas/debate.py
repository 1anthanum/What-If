"""Debate room specific schemas."""

from pydantic import BaseModel, Field
from datetime import datetime


class PersonaConfig(BaseModel):
    """Configuration for a debate persona."""
    id: str = Field(..., description="Persona template ID or 'custom'")
    name: str = Field("", description="Display name (overrides template)")
    custom_prompt: str = Field("", description="Custom system prompt (if id='custom')")


class DebateStartRequest(BaseModel):
    """Request to start a new debate session."""
    scenario_title: str
    scenario_hypothesis: str
    domain: str = "general"
    variables: list[dict] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    time_horizon: str = "10 years"
    personas: list[PersonaConfig] = Field(
        default_factory=list,
        description="Persona configs. Empty = auto-select based on scenario."
    )
    language: str = Field("zh", description="Response language: zh, en")


class EventInjection(BaseModel):
    """An event injected mid-debate by the user."""
    description: str = Field(..., description="Event description, e.g. '严重旱灾袭击东南亚'")


class PersonaStatement(BaseModel):
    """A single persona's statement in a debate round."""
    persona_id: str
    persona_name: str
    persona_role: str
    content: str
    round_number: int
    token_usage: dict = Field(default_factory=dict)


class DebateRound(BaseModel):
    """A complete round of debate."""
    round_number: int
    statements: list[PersonaStatement] = Field(default_factory=list)
    injected_event: str | None = None
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class DebateSession(BaseModel):
    """Full state of a debate session."""
    session_id: str
    scenario_title: str
    scenario_hypothesis: str
    scenario_context: str
    personas: list[dict]
    rounds: list[DebateRound] = Field(default_factory=list)
    current_round: int = 0
    pending_event: str | None = None
    status: str = "active"  # active, paused, completed


class DebateSummary(BaseModel):
    """AI-generated summary of the debate."""
    consensus_points: list[str] = Field(default_factory=list)
    core_disagreements: list[str] = Field(default_factory=list)
    risk_warnings: list[str] = Field(default_factory=list)
    blind_spots: list[str] = Field(default_factory=list)
    overall_assessment: str = ""
    raw_text: str = ""
