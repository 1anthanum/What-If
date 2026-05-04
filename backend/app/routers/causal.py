"""API routes for the Causal Graph module."""

from fastapi import APIRouter, HTTPException
from app.services.causal_graph import CausalGraphService
from app.core.streaming import create_sse_response
from app.schemas.causal_graph import GenerateGraphRequest, PropagationRequest

router = APIRouter(prefix="/api/causal", tags=["causal"])

_service = CausalGraphService()


@router.post("/generate")
async def generate_causal_graph(req: GenerateGraphRequest):
    """Generate a causal graph from a scenario hypothesis. Returns SSE stream."""
    return create_sse_response(
        _service.generate_graph(
            scenario_title=req.scenario_title,
            scenario_hypothesis=req.scenario_hypothesis,
            domain=req.domain,
        )
    )


@router.post("/{graph_id}/propagate")
async def propagate_effect(graph_id: str, req: PropagationRequest):
    """Analyze cascading effects from perturbing a node. Returns SSE stream."""
    return create_sse_response(
        _service.propagate_effect(
            graph_id=graph_id,
            node_id=req.node_id,
            perturbation=req.perturbation,
            depth=req.depth,
        )
    )


@router.get("/{graph_id}")
async def get_graph(graph_id: str):
    """Get the current state of a causal graph."""
    graph = _service.get_graph(graph_id)
    if not graph:
        raise HTTPException(status_code=404, detail=f"Graph {graph_id} not found")
    return {
        "id": graph.id,
        "title": graph.title,
        "domain": graph.domain,
        "nodes": [n.model_dump() for n in graph.nodes],
        "edges": [e.model_dump() for e in graph.edges],
        "scenario_context": graph.scenario_context,
    }
