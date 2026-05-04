"""API routes for the Historical Counterfactual module."""

from fastapi import APIRouter, HTTPException
from app.services.counterfactual import CounterfactualService
from app.core.streaming import create_sse_response
from app.schemas.counterfactual import (
    CounterfactualRequest,
    ExploreRequest,
    FalsifyRequest,
    ConstrainedRegenerationRequest,
    UserAnnotation,
    AttractorDetectionRequest,
    EmbodiedExploreRequest,
)

router = APIRouter(prefix="/api/counterfactual", tags=["counterfactual"])

_service = CounterfactualService()


@router.get("/events")
async def list_events():
    """List all available historical event packages."""
    events = _service.list_events()
    return {"events": events}


@router.get("/events/{event_id}")
async def get_event(event_id: str):
    """Get a full historical event with decision nodes and data points."""
    event = _service.get_event(event_id)
    if not event:
        raise HTTPException(status_code=404, detail=f"Event '{event_id}' not found")
    return event


@router.post("/generate")
async def generate_timeline(req: CounterfactualRequest):
    """Generate a counterfactual timeline. Returns SSE stream."""
    return create_sse_response(
        _service.generate_timeline(
            event_id=req.event_id,
            modification=req.modification,
            time_horizon=req.time_horizon,
        )
    )


@router.get("/timelines/{timeline_id}")
async def get_timeline(timeline_id: str):
    """Get a previously generated counterfactual timeline."""
    timeline = _service.get_timeline(timeline_id)
    if not timeline:
        raise HTTPException(status_code=404, detail=f"Timeline '{timeline_id}' not found")
    return {
        "timeline_id": timeline.id,
        "event_id": timeline.event_id,
        "event_title": timeline.event_title,
        "modification": timeline.modification,
        "timeline_points": [tp.model_dump() for tp in timeline.timeline_points],
        "summary": timeline.summary,
        "key_divergences": timeline.key_divergences,
        "butterfly_effects": timeline.butterfly_effects,
    }


# ─── Falsification Engine Endpoints ────────────────────────

@router.post("/timelines/{timeline_id}/falsify")
async def falsify_timeline(timeline_id: str):
    """Run adversarial falsification analysis on a timeline. Returns SSE stream."""
    return create_sse_response(
        _service.falsify_timeline(timeline_id=timeline_id)
    )


@router.get("/timelines/{timeline_id}/vulnerability")
async def get_vulnerability(timeline_id: str):
    """Get a previously generated vulnerability assessment."""
    assessment = _service.get_assessment(timeline_id)
    if not assessment:
        raise HTTPException(
            status_code=404,
            detail=f"No vulnerability assessment for timeline '{timeline_id}'",
        )
    return assessment.model_dump()


# ─── User Knowledge Injection Endpoints ────────────────────

@router.post("/timelines/{timeline_id}/regenerate")
async def regenerate_with_constraints(
    timeline_id: str,
    req: ConstrainedRegenerationRequest,
):
    """Regenerate a timeline with user annotations as constraints. Returns SSE stream."""
    return create_sse_response(
        _service.regenerate_with_constraints(
            timeline_id=timeline_id,
            annotations=[UserAnnotation(**a.model_dump()) for a in req.annotations],
            preserve_uncontested=req.preserve_uncontested,
        )
    )


# ─── Ensemble Explore Endpoints ─────────────────────────────

@router.post("/explore")
async def explore_possibilities(req: ExploreRequest):
    """Trigger three-stage ensemble exploration. Returns SSE stream."""
    return create_sse_response(
        _service.explore_possibilities(
            event_id=req.event_id,
            modification=req.modification,
            time_horizon=req.time_horizon,
            n_explorations=req.n_explorations,
            n_clusters=req.n_clusters,
        )
    )


@router.get("/fans/{fan_id}")
async def get_possibility_fan(fan_id: str):
    """Get a previously generated possibility fan."""
    fan = _service.get_fan(fan_id)
    if not fan:
        raise HTTPException(status_code=404, detail=f"Fan '{fan_id}' not found")
    return fan.model_dump()


# ─── Attractor Detection Endpoints ────────────────────────

@router.post("/attractors/detect")
async def detect_attractors(req: AttractorDetectionRequest):
    """Run cross-modification attractor detection. Returns SSE stream.

    This is a long-running operation that runs multiple ensemble explorations,
    then analyzes convergence patterns across them.
    """
    return create_sse_response(
        _service.detect_attractors(
            event_id=req.event_id,
            modifications=req.modifications,
            n_explorations_per=req.n_explorations_per,
            n_clusters=req.n_clusters,
        )
    )


@router.get("/attractors/{analysis_id}")
async def get_attractor_analysis(analysis_id: str):
    """Get a previously generated attractor analysis."""
    analysis = _service.get_attractor_analysis(analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail=f"Analysis '{analysis_id}' not found")
    return analysis.model_dump()


# ─── Embodied Perspective Endpoints ────────────────────────

@router.get("/events/{event_id}/personas")
async def list_personas(event_id: str):
    """Get available historical personas for an event."""
    personas = _service.list_personas(event_id)
    return {"personas": personas}


@router.post("/explore/embodied")
async def explore_embodied(req: EmbodiedExploreRequest):
    """Trigger persona-driven ensemble exploration with coalition clustering.
    Returns SSE stream with same final format as /explore.
    """
    return create_sse_response(
        _service.explore_embodied(
            event_id=req.event_id,
            modification=req.modification,
            persona_ids=req.persona_ids,
            time_horizon=req.time_horizon,
            n_clusters=req.n_clusters,
        )
    )
