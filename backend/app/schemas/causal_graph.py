"""Causal graph schemas — Phase 2 placeholder."""

from pydantic import BaseModel, Field


class CausalNode(BaseModel):
    id: str
    label: str
    category: str = "general"  # economic, social, environmental, political
    current_state: str = ""


class CausalEdge(BaseModel):
    source: str
    target: str
    relationship: str = "positive"  # positive, negative, complex
    strength: float = Field(0.5, ge=0, le=1)
    mechanism: str = ""


class CausalGraph(BaseModel):
    nodes: list[CausalNode] = Field(default_factory=list)
    edges: list[CausalEdge] = Field(default_factory=list)
    scenario_context: str = ""
