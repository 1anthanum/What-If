"""Counterfactual engine schemas — Phase 3 placeholder."""

from pydantic import BaseModel, Field


class HistoricalEvent(BaseModel):
    id: str
    title: str
    period: str  # e.g., "1960-1980"
    description: str
    key_data_points: list[dict] = Field(default_factory=list)
    decision_nodes: list[dict] = Field(default_factory=list)


class CounterfactualRequest(BaseModel):
    event_id: str
    modified_parameter: str
    modified_value: str
    time_horizon: str = "30 years"


class TimelinePoint(BaseModel):
    year: int
    actual: str
    counterfactual: str
    divergence_reason: str = ""
    confidence: float = Field(0.5, ge=0, le=1)
