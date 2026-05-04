"""Causal Graph Service — generates causal networks and analyzes propagation effects."""

import json
import re
import uuid
import logging
from typing import AsyncGenerator

from app.core.claude_client import ClaudeClient
from app.core.token_tracker import TokenTracker
from app.core.prompt_engine import PromptEngine
from app.core.streaming import sse_event
from app.config import get_settings
from app.schemas.causal_graph import (
    CausalGraph,
    CausalNode,
    CausalEdge,
    PropagationAnalysis,
    PropagationStep,
)

logger = logging.getLogger(__name__)
settings = get_settings()


class CausalGraphService:
    """Manages causal graph generation and propagation analysis."""

    def __init__(self):
        self.tracker = TokenTracker()
        self.claude = ClaudeClient(token_tracker=self.tracker)
        self.prompt_engine = PromptEngine()
        self.graphs: dict[str, CausalGraph] = {}

    async def generate_graph(
        self,
        scenario_title: str,
        scenario_hypothesis: str,
        domain: str = "general",
    ) -> AsyncGenerator[dict, None]:
        """
        Generate a causal graph from a scenario.
        Yields SSE events: generation_start, chunk, graph_complete, error.
        """
        graph_id = str(uuid.uuid4())[:8]

        yield sse_event("generation_start", {
            "graph_id": graph_id,
            "scenario": scenario_hypothesis,
        })

        system_prompt = self.prompt_engine.render_causal_system_prompt(domain)
        user_prompt = (
            f"场景标题：{scenario_title}\n"
            f"核心假设：{scenario_hypothesis}\n"
            f"领域：{domain}\n\n"
            f"请为这个 what-if 场景生成一个完整的因果关系图谱。"
        )

        buffer = ""
        try:
            async for chunk in self.claude.stream(
                system_prompt,
                [{"role": "user", "content": user_prompt}],
                max_tokens=4096,
            ):
                buffer += chunk
                yield sse_event("chunk", {"text": chunk})

            # Extract JSON from response (handle possible markdown wrapping)
            json_str = _extract_json(buffer)
            graph_data = json.loads(json_str)

            # Build graph from parsed data
            graph = self._build_graph(graph_id, graph_data, scenario_hypothesis, domain)
            self.graphs[graph_id] = graph

            yield sse_event("graph_complete", {
                "graph_id": graph_id,
                "title": graph.title,
                "nodes": [n.model_dump() for n in graph.nodes],
                "edges": [e.model_dump() for e in graph.edges],
                "token_usage": self.tracker.get_summary(),
            })

        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}\nRaw buffer: {buffer[:500]}")
            yield sse_event("error", {
                "message": f"AI 返回的因果图格式有误，请重试。({str(e)[:80]})"
            })
        except Exception as e:
            logger.error(f"Graph generation failed: {e}")
            yield sse_event("error", {"message": f"图谱生成失败：{str(e)}"})

    async def propagate_effect(
        self,
        graph_id: str,
        node_id: str,
        perturbation: str,
        depth: int = 4,
    ) -> AsyncGenerator[dict, None]:
        """
        Analyze cascading effects from perturbing a node.
        Yields SSE events: propagation_start, chunk, propagation_complete, error.
        """
        graph = self.graphs.get(graph_id)
        if not graph:
            yield sse_event("error", {"message": f"图谱 {graph_id} 不存在"})
            return

        # Find the target node
        target_node = next((n for n in graph.nodes if n.id == node_id), None)
        if not target_node:
            yield sse_event("error", {"message": f"节点 {node_id} 不存在"})
            return

        yield sse_event("propagation_start", {
            "graph_id": graph_id,
            "node_id": node_id,
            "node_label": target_node.label,
            "perturbation": perturbation,
        })

        # Build graph context for the prompt
        graph_context = self._graph_to_context(graph)

        system_prompt = (
            "你是因果链分析专家。请严格按照 JSON 格式输出分析结果，不要添加任何 markdown 标记或解释文字。"
        )
        user_prompt = self.prompt_engine.render_propagation_prompt(
            graph_context=graph_context,
            node_label=target_node.label,
            perturbation=perturbation,
            depth=depth,
        )

        buffer = ""
        try:
            async for chunk in self.claude.stream(
                system_prompt,
                [{"role": "user", "content": user_prompt}],
                max_tokens=4096,
            ):
                buffer += chunk
                yield sse_event("chunk", {"text": chunk})

            # Parse propagation analysis
            json_str = _extract_json(buffer)
            analysis_data = json.loads(json_str)

            analysis = PropagationAnalysis(
                initial_node_id=node_id,
                initial_perturbation=perturbation,
                steps=[PropagationStep(**s) for s in analysis_data.get("steps", [])],
                summary=analysis_data.get("summary", ""),
                affected_nodes_count=analysis_data.get("affected_nodes_count", 0),
                max_depth_reached=analysis_data.get("max_depth_reached", 0),
            )

            yield sse_event("propagation_complete", {
                "analysis": analysis.model_dump(),
                "token_usage": self.tracker.get_summary(),
            })

        except json.JSONDecodeError as e:
            logger.error(f"Propagation JSON parse error: {e}")
            yield sse_event("error", {
                "message": f"传播分析格式解析失败，请重试。({str(e)[:80]})"
            })
        except Exception as e:
            logger.error(f"Propagation failed: {e}")
            yield sse_event("error", {"message": f"传播分析失败：{str(e)}"})

    def get_graph(self, graph_id: str) -> CausalGraph | None:
        """Retrieve a stored causal graph."""
        return self.graphs.get(graph_id)

    def _build_graph(
        self,
        graph_id: str,
        data: dict,
        scenario_context: str,
        domain: str,
    ) -> CausalGraph:
        """Parse raw JSON into a validated CausalGraph."""
        nodes = []
        for n in data.get("nodes", []):
            nodes.append(CausalNode(
                id=n.get("id", str(uuid.uuid4())[:6]),
                label=n.get("label", "Unknown"),
                category=n.get("category", "economic"),
                current_state=n.get("current_state", ""),
                description=n.get("description", ""),
                importance_score=max(0.0, min(1.0, float(n.get("importance_score", 0.5)))),
            ))

        edges = []
        # Collect valid node IDs for edge validation
        valid_ids = {n.id for n in nodes}
        for e in data.get("edges", []):
            src = e.get("source", "")
            tgt = e.get("target", "")
            if src in valid_ids and tgt in valid_ids:
                edges.append(CausalEdge(
                    source=src,
                    target=tgt,
                    relationship=e.get("relationship", "positive"),
                    strength=max(0.0, min(1.0, float(e.get("strength", 0.5)))),
                    mechanism=e.get("mechanism", ""),
                    time_lag=e.get("time_lag", ""),
                    confidence=max(0.0, min(1.0, float(e.get("confidence", 0.7)))),
                ))

        return CausalGraph(
            id=graph_id,
            title=data.get("title", "因果图谱"),
            domain=domain,
            nodes=nodes,
            edges=edges,
            scenario_context=scenario_context,
        )

    def _graph_to_context(self, graph: CausalGraph) -> str:
        """Convert a graph to a readable text context for Claude."""
        lines = [f"场景：{graph.scenario_context}\n"]

        lines.append("节点：")
        for n in graph.nodes:
            lines.append(
                f"  - [{n.id}] {n.label} ({n.category}) — {n.description or n.current_state}"
            )

        lines.append("\n因果关系：")
        for e in graph.edges:
            arrow = "→+" if e.relationship == "positive" else "→-" if e.relationship == "negative" else "→?"
            lines.append(
                f"  - [{e.source}] {arrow} [{e.target}] "
                f"(强度:{e.strength:.1f}, 机制:{e.mechanism})"
            )

        return "\n".join(lines)


def _extract_json(text: str) -> str:
    """Extract JSON from text that may contain markdown code fences."""
    # Try to find JSON in code blocks first
    match = re.search(r"```(?:json)?\s*\n?([\s\S]*?)\n?```", text)
    if match:
        return match.group(1).strip()

    # Try to find raw JSON object
    brace_start = text.find("{")
    if brace_start >= 0:
        # Find the matching closing brace
        depth = 0
        for i in range(brace_start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    return text[brace_start : i + 1]

    return text.strip()
