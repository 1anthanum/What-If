"""Causal graph schemas — Phase 2: Interactive Causal Graph."""

import uuid
from typing import Literal
from pydantic import BaseModel, Field


class CausalNode(BaseModel):
    id: str
    label: str
    category: Literal["economic", "social", "environmental", "political"] = "economic"
    current_state: str = ""
    description: str = ""
    importance_score: float = Field(0.5, ge=0.0, le=1.0)


class CausalEdge(BaseModel):
    source: str
    target: str
    relationship: Literal["positive", "negative", "complex"] = "positive"
    strength: float = Field(0.5, ge=0.0, le=1.0)
    mechanism: str = ""
    time_lag: str = ""  # "immediate", "6months", "1year", "2years"
    confidence: float = Field(0.7, ge=0.0, le=1.0)


class CausalGraph(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    title: str = ""
    domain: str = "general"
    nodes: list[CausalNode] = Field(default_factory=list)
    edges: list[CausalEdge] = Field(default_factory=list)
    scenario_context: str = ""


class PropagationStep(BaseModel):
    """A single step in a causal propagation analysis."""
    node_id: str
    node_label: str
    depth: int
    incoming_effect: str  # How this node was affected
    outgoing_effects: list[dict] = Field(default_factory=list)
    reasoning: str  # Claude's explanation of the cascade
    confidence: float = Field(0.7, ge=0.0, le=1.0)


class PropagationAnalysis(BaseModel):
    """Complete result of a propagation analysis."""
    initial_node_id: str
    initial_perturbation: str
    steps: list[PropagationStep] = Field(default_factory=list)
    summary: str = ""
    affected_nodes_count: int = 0
    max_depth_reached: int = 0


class GenerateGraphRequest(BaseModel):
    scenario_title: str
    scenario_hypothesis: str
    domain: str = "general"


class PropagationRequest(BaseModel):
    node_id: str
    perturbation: str
    depth: int = Field(4, ge=1, le=8)
