"""Counterfactual engine schemas — Phase 3: Historical Counterfactual Engine."""

import uuid
from pydantic import BaseModel, Field


class DecisionNode(BaseModel):
    """A key decision point or turning point in history."""
    id: str
    year: int
    title: str
    description: str
    actual_outcome: str
    modifiable: bool = True  # Can the user change this?


class HistoricalEvent(BaseModel):
    """A pre-defined historical event package."""
    id: str
    title: str
    period: str  # e.g., "1960-1980"
    region: str  # e.g., "Global", "East Asia"
    domain: str  # e.g., "agriculture", "technology", "geopolitics"
    description: str
    key_data_points: list[dict] = Field(default_factory=list)
    decision_nodes: list[DecisionNode] = Field(default_factory=list)
    default_modification: str = ""  # Suggested what-if modification


class CounterfactualRequest(BaseModel):
    """Request to generate a counterfactual timeline."""
    event_id: str
    modification: str  # What the user wants to change
    time_horizon: str = "30 years"


class TimelinePoint(BaseModel):
    """A single point on the dual timeline."""
    year: int
    actual: str
    counterfactual: str
    divergence_level: float = Field(0.0, ge=0.0, le=1.0)  # 0=same, 1=totally different
    confidence: float = Field(0.5, ge=0.0, le=1.0)
    reasoning: str = ""
    category: str = "general"  # economic, social, environmental, political


class CounterfactualTimeline(BaseModel):
    """Complete counterfactual analysis result."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    event_id: str
    event_title: str
    modification: str
    timeline_points: list[TimelinePoint] = Field(default_factory=list)
    summary: str = ""
    key_divergences: list[str] = Field(default_factory=list)
    butterfly_effects: list[str] = Field(default_factory=list)


# ─── Ensemble Explore Types ─────────────────────────────────

class DivergenceScenario(BaseModel):
    """Stage 1 output: lightweight divergence scenario from Haiku."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    divergence_points: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    perspective: str = ""


class ExplorationCluster(BaseModel):
    """Stage 2 output: a narrative direction cluster."""
    cluster_id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    narrative_direction: str
    explanation: str = ""
    member_indices: list[int] = Field(default_factory=list)
    consensus_strength: float = 0.0
    representative_index: int = 0


class ExploreRequest(BaseModel):
    """Request body for ensemble exploration."""
    event_id: str
    modification: str
    time_horizon: str = "30 years"
    n_explorations: int = 15
    n_clusters: int = 4


class PossibilityBranch(BaseModel):
    """A single branch in the possibility fan (cluster + refined timeline)."""
    cluster: ExplorationCluster
    timeline: CounterfactualTimeline
    scenario_count: int = 0


class PossibilityFan(BaseModel):
    """Complete possibility fan — the final ensemble exploration output."""
    fan_id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    event_id: str
    event_title: str
    modification: str
    total_explorations: int = 0
    branches: list[PossibilityBranch] = Field(default_factory=list)
    token_usage: dict = Field(default_factory=dict)


# ─── Falsification Engine Types ────────────────────────────

class VulnerabilityPoint(BaseModel):
    """A single vulnerability identified in a timeline point."""
    year: int
    claim: str                     # The counterfactual claim being challenged
    attack_vector: str             # How this claim can be attacked
    severity: float = Field(0.5, ge=0.0, le=1.0)  # 0=minor, 1=fatal flaw
    counter_evidence: str = ""     # Historical or logical counter-evidence
    alternative_outcome: str = ""  # What would more likely happen instead


class TimelineVulnerabilityAssessment(BaseModel):
    """Complete falsification analysis of a counterfactual timeline."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    timeline_id: str
    overall_vulnerability_index: float = Field(0.5, ge=0.0, le=1.0)
    vulnerability_points: list[VulnerabilityPoint] = Field(default_factory=list)
    methodology_note: str = ""
    strongest_claim_year: int | None = None   # Year with lowest vulnerability
    weakest_claim_year: int | None = None     # Year with highest vulnerability


class FalsifyRequest(BaseModel):
    """Request to run falsification analysis on a timeline."""
    timeline_id: str


# ─── User Knowledge Injection Types ────────────────────────

class UserAnnotation(BaseModel):
    """A user-provided annotation correcting or enriching a timeline point."""
    year: int
    original_claim: str            # What the AI said at this point
    correction: str                # What the user thinks should be different
    source_description: str = ""   # Where the user's knowledge comes from
    constraint_type: str = "domain_knowledge"  # factual_error | missing_factor | domain_knowledge


class ConstrainedRegenerationRequest(BaseModel):
    """Request to regenerate a timeline with user constraints."""
    timeline_id: str
    annotations: list[UserAnnotation]
    preserve_uncontested: bool = True  # Keep points user didn't annotate


# ─── Attractor Detection Types ────────────────────────────

class AttractorPoint(BaseModel):
    """A historical outcome that multiple explorations converge toward."""
    outcome_description: str
    convergence_score: float = Field(0.5, ge=0.0, le=1.0)
    contributing_fans: list[str] = Field(default_factory=list)  # fan_ids
    earliest_emergence_year: int = 0
    resistance_to_change: float = Field(0.5, ge=0.0, le=1.0)  # How hard to avoid


class AttractorAnalysis(BaseModel):
    """Complete attractor detection result across multiple explorations."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    event_id: str
    modifications_tested: list[str] = Field(default_factory=list)
    attractors: list[AttractorPoint] = Field(default_factory=list)
    divergent_outcomes: list[str] = Field(default_factory=list)  # Outcomes unique to one fan
    methodology: str = ""
    token_usage: dict = Field(default_factory=dict)


class AttractorDetectionRequest(BaseModel):
    """Request to run attractor detection across multiple modifications."""
    event_id: str
    modifications: list[str]  # 3-5 different what-if hypotheses
    n_explorations_per: int = 10
    n_clusters: int = 3


# ─── Embodied Perspective Types ───────────────────────────

class HistoricalPersona(BaseModel):
    """A historical figure used as an exploration agent."""
    id: str
    name: str
    role: str
    era: str = ""
    worldview: str = ""
    decision_style: str = ""
    known_positions: list[str] = Field(default_factory=list)
    language_style: str = ""


class ActorCoalition(BaseModel):
    """A cluster based on actor alliances rather than narrative themes."""
    coalition_id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    coalition_name: str
    members: list[str] = Field(default_factory=list)  # persona names
    shared_interest: str = ""
    conflict_points: list[str] = Field(default_factory=list)
    coalition_strength: float = 0.0


class EmbodiedExploreRequest(BaseModel):
    """Request for embodied perspective exploration."""
    event_id: str
    modification: str
    persona_ids: list[str] = Field(default_factory=list)
    time_horizon: str = "30 years"
    n_clusters: int = 3
