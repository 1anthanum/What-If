"""Counterfactual Engine Service — generates alternative history timelines."""

import asyncio
import json
import re
import uuid
import logging
from typing import AsyncGenerator

from app.core.claude_client import ClaudeClient
from app.core.token_tracker import TokenTracker
from app.core.prompt_engine import PromptEngine
from app.core.streaming import sse_event
from app.core.inference import get_fast_backend, InferenceBackend
from app.config import get_settings
from app.schemas.counterfactual import (
    HistoricalEvent,
    DecisionNode,
    CounterfactualTimeline,
    TimelinePoint,
    DivergenceScenario,
    ExplorationCluster,
    PossibilityBranch,
    PossibilityFan,
    VulnerabilityPoint,
    TimelineVulnerabilityAssessment,
    UserAnnotation,
    AttractorPoint,
    AttractorAnalysis,
    HistoricalPersona,
    ActorCoalition,
)

logger = logging.getLogger(__name__)
settings = get_settings()


class CounterfactualService:
    """Manages historical counterfactual timeline generation."""

    def __init__(self):
        self.tracker = TokenTracker()
        self.claude = ClaudeClient(token_tracker=self.tracker)
        self.prompt_engine = PromptEngine()
        self.fast_backend: InferenceBackend = get_fast_backend(self.tracker)
        self.timelines: dict[str, CounterfactualTimeline] = {}
        self.fans: dict[str, PossibilityFan] = {}
        self.assessments: dict[str, TimelineVulnerabilityAssessment] = {}
        self.attractor_analyses: dict[str, AttractorAnalysis] = {}
        self._personas_cache: dict[str, list[dict]] = {}  # event_id → persona list

    def list_events(self) -> list[dict]:
        """List all available historical event packages."""
        return self.prompt_engine.list_historical_events()

    def get_event(self, event_id: str) -> dict | None:
        """Get a full historical event by ID."""
        try:
            data = self.prompt_engine.load_historical_event(event_id)
            # Parse into structured format
            event = HistoricalEvent(
                id=data.get("id", event_id),
                title=data.get("title", event_id),
                period=data.get("period", ""),
                region=data.get("region", ""),
                domain=data.get("domain", ""),
                description=data.get("description", ""),
                key_data_points=data.get("key_data_points", []),
                decision_nodes=[
                    DecisionNode(**dn) for dn in data.get("decision_nodes", [])
                ],
                default_modification=data.get("default_modification", ""),
            )
            return event.model_dump()
        except FileNotFoundError:
            return None
        except Exception as e:
            logger.error(f"Failed to load event {event_id}: {e}")
            return None

    async def generate_timeline(
        self,
        event_id: str,
        modification: str,
        time_horizon: str = "30 years",
    ) -> AsyncGenerator[dict, None]:
        """
        Generate a counterfactual timeline.
        Yields SSE events: generation_start, chunk, timeline_complete, error.
        """
        timeline_id = str(uuid.uuid4())[:8]

        # Load the historical event
        try:
            event_data = self.prompt_engine.load_historical_event(event_id)
        except FileNotFoundError:
            yield sse_event("error", {"message": f"历史事件 '{event_id}' 不存在"})
            return

        event_title = event_data.get("title", event_id)

        yield sse_event("generation_start", {
            "timeline_id": timeline_id,
            "event_id": event_id,
            "event_title": event_title,
            "modification": modification,
        })

        system_prompt = self.prompt_engine.render_counterfactual_system_prompt()
        user_prompt = self.prompt_engine.render_counterfactual_user_prompt(
            event_title=event_title,
            event_description=event_data.get("description", ""),
            key_data_points=event_data.get("key_data_points", []),
            decision_nodes=event_data.get("decision_nodes", []),
            modification=modification,
            time_horizon=time_horizon,
        )

        buffer = ""
        try:
            async for chunk in self.claude.stream(
                system_prompt,
                [{"role": "user", "content": user_prompt}],
                max_tokens=6000,
            ):
                buffer += chunk
                yield sse_event("chunk", {"text": chunk})

            # Parse JSON response
            json_str = _extract_json(buffer)
            result = json.loads(json_str)

            # Build timeline object
            timeline = CounterfactualTimeline(
                id=timeline_id,
                event_id=event_id,
                event_title=event_title,
                modification=modification,
                timeline_points=[
                    TimelinePoint(**tp) for tp in result.get("timeline_points", [])
                ],
                summary=result.get("summary", ""),
                key_divergences=result.get("key_divergences", []),
                butterfly_effects=result.get("butterfly_effects", []),
            )

            self.timelines[timeline_id] = timeline

            yield sse_event("timeline_complete", {
                "timeline_id": timeline_id,
                "event_title": event_title,
                "modification": modification,
                "timeline_points": [tp.model_dump() for tp in timeline.timeline_points],
                "summary": timeline.summary,
                "key_divergences": timeline.key_divergences,
                "butterfly_effects": timeline.butterfly_effects,
                "token_usage": self.tracker.get_summary(),
            })

        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}\nRaw buffer: {buffer[:500]}")
            yield sse_event("error", {
                "message": f"AI 返回的时间线格式有误，请重试。({str(e)[:80]})"
            })
        except Exception as e:
            logger.error(f"Timeline generation failed: {e}")
            yield sse_event("error", {"message": f"时间线生成失败：{str(e)}"})

    def get_timeline(self, timeline_id: str) -> CounterfactualTimeline | None:
        """Retrieve a stored timeline."""
        return self.timelines.get(timeline_id)

    # ─── Falsification Engine ──────────────────────────────────

    async def falsify_timeline(
        self, timeline_id: str,
    ) -> AsyncGenerator[dict, None]:
        """
        Run adversarial falsification on a stored timeline.
        Yields SSE events: falsify_start, chunk, falsify_complete, error.
        """
        timeline = self.timelines.get(timeline_id)
        if not timeline:
            yield sse_event("error", {"message": f"时间线 '{timeline_id}' 不存在"})
            return

        yield sse_event("falsify_start", {
            "timeline_id": timeline_id,
            "event_title": timeline.event_title,
            "point_count": len(timeline.timeline_points),
        })

        system, user_prompt = self.prompt_engine.render_falsification_prompt(
            timeline_points=[tp.model_dump() for tp in timeline.timeline_points],
            modification=timeline.modification,
            event_title=timeline.event_title,
        )

        buffer = ""
        try:
            async for chunk in self.claude.stream(
                system,
                [{"role": "user", "content": user_prompt}],
                max_tokens=4000,
                temperature=0.3,
            ):
                buffer += chunk
                yield sse_event("chunk", {"text": chunk})

            json_str = _extract_json(buffer)
            result = json.loads(json_str)

            assessment = TimelineVulnerabilityAssessment(
                timeline_id=timeline_id,
                overall_vulnerability_index=result.get("overall_vulnerability_index", 0.5),
                vulnerability_points=[
                    VulnerabilityPoint(**vp)
                    for vp in result.get("vulnerability_points", [])
                ],
                methodology_note=result.get("methodology_note", ""),
                strongest_claim_year=result.get("strongest_claim_year"),
                weakest_claim_year=result.get("weakest_claim_year"),
            )

            self.assessments[timeline_id] = assessment

            yield sse_event("falsify_complete", {
                "timeline_id": timeline_id,
                "overall_vulnerability_index": assessment.overall_vulnerability_index,
                "vulnerability_points": [vp.model_dump() for vp in assessment.vulnerability_points],
                "methodology_note": assessment.methodology_note,
                "strongest_claim_year": assessment.strongest_claim_year,
                "weakest_claim_year": assessment.weakest_claim_year,
                "token_usage": self.tracker.get_summary(),
            })

        except json.JSONDecodeError as e:
            logger.error(f"Falsification JSON parse error: {e}\nBuffer: {buffer[:500]}")
            yield sse_event("error", {
                "message": f"证伪分析结果格式有误，请重试。({str(e)[:80]})"
            })
        except Exception as e:
            logger.error(f"Falsification failed: {e}")
            yield sse_event("error", {"message": f"证伪分析失败：{str(e)}"})

    def get_assessment(self, timeline_id: str) -> TimelineVulnerabilityAssessment | None:
        """Retrieve a stored vulnerability assessment."""
        return self.assessments.get(timeline_id)

    # ─── User Knowledge Injection ──────────────────────────────

    async def regenerate_with_constraints(
        self,
        timeline_id: str,
        annotations: list[UserAnnotation],
        preserve_uncontested: bool = True,
    ) -> AsyncGenerator[dict, None]:
        """
        Regenerate a timeline incorporating user annotations as hard constraints.
        Yields SSE events: constrained_start, chunk, constrained_complete, error.
        """
        timeline = self.timelines.get(timeline_id)
        if not timeline:
            yield sse_event("error", {"message": f"时间线 '{timeline_id}' 不存在"})
            return

        # Load event data for context
        try:
            event_data = self.prompt_engine.load_historical_event(timeline.event_id)
        except FileNotFoundError:
            yield sse_event("error", {"message": f"历史事件 '{timeline.event_id}' 不存在"})
            return

        yield sse_event("constrained_start", {
            "timeline_id": timeline_id,
            "event_title": timeline.event_title,
            "annotation_count": len(annotations),
        })

        system, user_prompt = self.prompt_engine.render_constrained_timeline_prompt(
            event_data=event_data,
            modification=timeline.modification,
            original_points=[tp.model_dump() for tp in timeline.timeline_points],
            annotations=[a.model_dump() for a in annotations],
            preserve_uncontested=preserve_uncontested,
        )

        buffer = ""
        try:
            async for chunk in self.claude.stream(
                system,
                [{"role": "user", "content": user_prompt}],
                max_tokens=6000,
            ):
                buffer += chunk
                yield sse_event("chunk", {"text": chunk})

            json_str = _extract_json(buffer)
            result = json.loads(json_str)

            new_timeline = CounterfactualTimeline(
                event_id=timeline.event_id,
                event_title=timeline.event_title,
                modification=timeline.modification,
                timeline_points=[
                    TimelinePoint(**tp) for tp in result.get("timeline_points", [])
                ],
                summary=result.get("summary", ""),
                key_divergences=result.get("key_divergences", []),
                butterfly_effects=result.get("butterfly_effects", []),
            )

            # Store the new timeline (different ID from original)
            self.timelines[new_timeline.id] = new_timeline

            yield sse_event("constrained_complete", {
                "timeline_id": new_timeline.id,
                "original_timeline_id": timeline_id,
                "event_title": timeline.event_title,
                "modification": timeline.modification,
                "annotation_count": len(annotations),
                "timeline_points": [tp.model_dump() for tp in new_timeline.timeline_points],
                "summary": new_timeline.summary,
                "key_divergences": new_timeline.key_divergences,
                "butterfly_effects": new_timeline.butterfly_effects,
                "token_usage": self.tracker.get_summary(),
            })

        except json.JSONDecodeError as e:
            logger.error(f"Constrained regen JSON parse error: {e}\nBuffer: {buffer[:500]}")
            yield sse_event("error", {
                "message": f"受约束时间线格式有误，请重试。({str(e)[:80]})"
            })
        except Exception as e:
            logger.error(f"Constrained regeneration failed: {e}")
            yield sse_event("error", {"message": f"受约束重新生成失败：{str(e)}"})

    # ─── Ensemble Explore (三阶段管线) ─────────────────────────

    async def explore_possibilities(
        self,
        event_id: str,
        modification: str,
        time_horizon: str = "30 years",
        n_explorations: int = 15,
        n_clusters: int = 4,
    ) -> AsyncGenerator[dict, None]:
        """
        Three-stage ensemble exploration pipeline.
        Stage 1: Haiku x N parallel divergence explorations
        Stage 2: Sonnet clusters the divergences into narrative directions
        Stage 3: Sonnet x K parallel refined timelines (one per cluster)
        Yields SSE events throughout.
        """
        fan_id = str(uuid.uuid4())[:8]

        # Load event
        try:
            event_data = self.prompt_engine.load_historical_event(event_id)
        except FileNotFoundError:
            yield sse_event("error", {"message": f"历史事件 '{event_id}' 不存在"})
            return

        event_title = event_data.get("title", event_id)
        event_summary = f"{event_title} — {event_data.get('description', '')[:200]}"

        yield sse_event("explore_start", {
            "fan_id": fan_id,
            "event_id": event_id,
            "event_title": event_title,
            "modification": modification,
            "n_explorations": n_explorations,
        })

        # ── Stage 1: Diverge (Haiku × N, parallel) ──────────────
        perspectives = PromptEngine.PERSPECTIVES
        tasks = []
        for i in range(n_explorations):
            perspective = perspectives[i % len(perspectives)]
            tasks.append(
                self._haiku_divergence(event_summary, modification, perspective, i)
            )

        results = await asyncio.gather(*tasks, return_exceptions=True)

        scenarios: list[DivergenceScenario] = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.warning(f"Haiku divergence {i} failed: {result}")
                continue
            if result is not None:
                scenarios.append(result)

        if len(scenarios) < 3:
            yield sse_event("error", {
                "message": f"探索阶段仅成功 {len(scenarios)} 个（至少需要 3 个），请重试"
            })
            return

        yield sse_event("diverge_complete", {
            "count": len(scenarios),
            "total_attempted": n_explorations,
            "perspectives": list({s.perspective for s in scenarios}),
        })

        # ── Stage 2: Cluster (Sonnet × 1) ───────────────────────
        try:
            clusters = await self._cluster_divergences(scenarios, n_clusters)
        except Exception as e:
            logger.error(f"Clustering failed: {e}")
            yield sse_event("error", {"message": f"聚类阶段失败：{str(e)}"})
            return

        yield sse_event("cluster_complete", {
            "clusters": [
                {
                    "cluster_id": c.cluster_id,
                    "narrative_direction": c.narrative_direction,
                    "explanation": c.explanation,
                    "member_count": len(c.member_indices),
                    "consensus_strength": c.consensus_strength,
                }
                for c in clusters
            ],
        })

        # ── Stage 3: Refine (Sonnet × K, parallel) ──────────────
        refine_tasks = []
        for cluster in clusters:
            # Gather exemplar divergence points for this cluster
            rep_idx = cluster.representative_index
            exemplar = scenarios[rep_idx] if rep_idx < len(scenarios) else scenarios[0]
            refine_tasks.append(
                self._sonnet_refine(
                    event_data, modification, cluster, exemplar.divergence_points
                )
            )

        refine_results = await asyncio.gather(*refine_tasks, return_exceptions=True)

        branches: list[PossibilityBranch] = []
        for i, (cluster, result) in enumerate(zip(clusters, refine_results)):
            if isinstance(result, Exception):
                logger.warning(f"Refine branch {i} ({cluster.narrative_direction}) failed: {result}")
                continue
            if result is not None:
                branches.append(PossibilityBranch(
                    cluster=cluster,
                    timeline=result,
                    scenario_count=len(cluster.member_indices),
                ))

        # Sort by consensus strength (most popular direction first)
        branches.sort(key=lambda b: b.cluster.consensus_strength, reverse=True)

        fan = PossibilityFan(
            fan_id=fan_id,
            event_id=event_id,
            event_title=event_title,
            modification=modification,
            total_explorations=len(scenarios),
            branches=branches,
            token_usage=self.tracker.get_summary(),
        )

        self.fans[fan_id] = fan

        yield sse_event("explore_complete", {
            "fan_id": fan_id,
            "event_title": event_title,
            "modification": modification,
            "total_explorations": len(scenarios),
            "branch_count": len(branches),
            "branches": [
                {
                    "cluster_id": b.cluster.cluster_id,
                    "narrative_direction": b.cluster.narrative_direction,
                    "explanation": b.cluster.explanation,
                    "consensus_strength": b.cluster.consensus_strength,
                    "scenario_count": b.scenario_count,
                    "timeline_id": b.timeline.id,
                    "timeline_points": [tp.model_dump() for tp in b.timeline.timeline_points],
                    "summary": b.timeline.summary,
                    "key_divergences": b.timeline.key_divergences,
                    "butterfly_effects": b.timeline.butterfly_effects,
                }
                for b in branches
            ],
            "token_usage": self.tracker.get_summary(),
        })

    # ── Attractor Detection ─────────────────────────────────────

    async def detect_attractors(
        self,
        event_id: str,
        modifications: list[str],
        n_explorations_per: int = 10,
        n_clusters: int = 3,
    ) -> AsyncGenerator[dict, None]:
        """Run multiple explore passes with different modifications, then analyze
        cross-fan convergence to find historical attractors.

        SSE events: attractor_start → fan_progress → analysis_start → attractor_complete
        """
        event_data = self.prompt_engine.load_historical_event(event_id)
        event_title = event_data.get("title", event_id)
        analysis_id = str(uuid.uuid4())[:8]

        yield sse_event("attractor_start", {
            "analysis_id": analysis_id,
            "event_title": event_title,
            "modifications": modifications,
            "total_fans": len(modifications),
        })

        # Phase 1: run explore_possibilities for each modification (sequentially
        # to avoid overwhelming the API/GPU — each explore already does 10-15 parallel calls)
        fan_summaries: list[dict] = []
        for i, mod in enumerate(modifications):
            logger.info(f"Attractor: exploring modification {i+1}/{len(modifications)}: {mod[:60]}...")

            # Collect all SSE events from explore but don't re-yield them
            fan_data: dict = {}
            async for event in self.explore_possibilities(
                event_id=event_id,
                modification=mod,
                time_horizon="30 years",
                n_explorations=n_explorations_per,
                n_clusters=n_clusters,
            ):
                # Capture the final explore_complete event
                if isinstance(event, str) and '"explore_complete"' in event:
                    import json as _json
                    try:
                        # SSE format: "data: {...}\n\n" or similar
                        data_line = event.split("data: ", 1)[-1].strip()
                        fan_data = _json.loads(data_line)
                    except Exception:
                        pass

            # Build summary for cross-fan analysis
            branches_summary = []
            for b in fan_data.get("branches", []):
                branches_summary.append({
                    "narrative_direction": b.get("narrative_direction", ""),
                    "summary": b.get("summary", ""),
                    "key_divergences": b.get("key_divergences", []),
                })

            fan_summaries.append({
                "modification": mod,
                "fan_id": fan_data.get("fan_id", ""),
                "branches": branches_summary,
            })

            yield sse_event("fan_progress", {
                "completed": i + 1,
                "total": len(modifications),
                "modification": mod,
            })

        # Phase 2: Sonnet analyzes cross-fan convergence
        yield sse_event("analysis_start", {
            "fan_count": len(fan_summaries),
        })

        system, user = self.prompt_engine.render_attractor_analysis_prompt(
            fan_summaries, event_title,
        )

        raw = await self.claude.complete(
            system,
            [{"role": "user", "content": user}],
            max_tokens=4000,
            temperature=0.3,
            model="claude-sonnet-4-6",
        )

        json_str = _extract_json(raw)
        result = json.loads(json_str)

        # Build AttractorAnalysis
        attractors = []
        for a in result.get("attractors", []):
            fan_indices = a.get("contributing_fan_indices", [])
            contributing_fan_ids = [
                fan_summaries[i]["fan_id"]
                for i in fan_indices
                if i < len(fan_summaries) and fan_summaries[i].get("fan_id")
            ]
            attractors.append(AttractorPoint(
                outcome_description=a.get("outcome_description", ""),
                convergence_score=a.get("convergence_score", 0.5),
                contributing_fans=contributing_fan_ids,
                earliest_emergence_year=a.get("earliest_emergence_year", 0),
                resistance_to_change=a.get("resistance_to_change", 0.5),
            ))

        analysis = AttractorAnalysis(
            id=analysis_id,
            event_id=event_id,
            modifications_tested=modifications,
            attractors=attractors,
            divergent_outcomes=result.get("divergent_outcomes", []),
            methodology=result.get("methodology", ""),
            token_usage=self.tracker.get_summary(),
        )

        self.attractor_analyses[analysis_id] = analysis

        yield sse_event("attractor_complete", {
            "analysis_id": analysis_id,
            "attractors": [
                {
                    "outcome_description": a.outcome_description,
                    "convergence_score": a.convergence_score,
                    "earliest_emergence_year": a.earliest_emergence_year,
                    "resistance_to_change": a.resistance_to_change,
                    "contributing_fan_count": len(a.contributing_fans),
                }
                for a in attractors
            ],
            "divergent_outcomes": analysis.divergent_outcomes,
            "methodology": analysis.methodology,
            "modifications_tested": modifications,
            "token_usage": self.tracker.get_summary(),
        })

    def get_attractor_analysis(self, analysis_id: str) -> AttractorAnalysis | None:
        """Retrieve a cached attractor analysis."""
        return self.attractor_analyses.get(analysis_id)

    # ── Embodied Perspective Exploration ──────────────────────

    def list_personas(self, event_id: str) -> list[dict]:
        """List available historical personas for an event."""
        if event_id in self._personas_cache:
            return self._personas_cache[event_id]

        import yaml
        from pathlib import Path
        personas_dir = Path(__file__).parent.parent / "data" / "personas" / "historical"
        event_file = personas_dir / f"{event_id}.yaml"

        if not event_file.exists():
            return []

        with open(event_file, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        personas = data.get("personas", [])
        self._personas_cache[event_id] = personas
        return personas

    async def explore_embodied(
        self,
        event_id: str,
        modification: str,
        persona_ids: list[str],
        time_horizon: str = "30 years",
        n_clusters: int = 3,
    ) -> AsyncGenerator[dict, None]:
        """Embodied perspective exploration: persona-driven Stage 1 → coalition clustering → refined timelines.

        SSE events: embodied_start → diverge_complete → coalition_complete → explore_complete
        """
        event_data = self.prompt_engine.load_historical_event(event_id)
        event_title = event_data.get("title", event_id)
        event_summary = event_data.get("description", "")
        fan_id = str(uuid.uuid4())[:8]

        # Load persona data
        all_personas = self.list_personas(event_id)
        persona_map = {p["id"]: p for p in all_personas}
        selected = [persona_map[pid] for pid in persona_ids if pid in persona_map]

        if not selected:
            yield sse_event("error", {"message": "未找到任何可用的历史人物"})
            return

        yield sse_event("embodied_start", {
            "fan_id": fan_id,
            "event_title": event_title,
            "personas": [{"id": p["id"], "name": p["name"], "role": p["role"]} for p in selected],
            "total_explorations": len(selected),
        })

        # Stage 1: Parallel persona-driven divergence using fast backend
        async def _persona_diverge(persona: dict, idx: int) -> dict | None:
            system, user = self.prompt_engine.render_embodied_divergence_prompt(
                event_summary, modification, persona,
            )
            try:
                raw = await self.fast_backend.complete(
                    system,
                    [{"role": "user", "content": user}],
                    max_tokens=500,
                    temperature=0.9,
                )
                json_str = _extract_json(raw)
                data = json.loads(json_str)
                return {
                    "persona_name": persona["name"],
                    "persona_role": persona.get("role", ""),
                    "divergence_points": data.get("divergence_points", []),
                    "tags": data.get("tags", []),
                    "persona_reasoning": data.get("persona_reasoning", ""),
                }
            except Exception as e:
                logger.warning(f"Embodied divergence for {persona['name']} failed: {e}")
                return None

        tasks = [_persona_diverge(p, i) for i, p in enumerate(selected)]
        results = await asyncio.gather(*tasks)
        scenarios = [r for r in results if r is not None]

        if not scenarios:
            yield sse_event("error", {"message": "所有人物探索均失败"})
            return

        yield sse_event("diverge_complete", {
            "count": len(scenarios),
            "personas_succeeded": [s["persona_name"] for s in scenarios],
        })

        # Stage 2: Coalition clustering (Sonnet)
        system, user = self.prompt_engine.render_coalition_cluster_prompt(
            scenarios, n_clusters,
        )

        raw = await self.claude.complete(
            system,
            [{"role": "user", "content": user}],
            max_tokens=2000,
            temperature=0.3,
            model="claude-sonnet-4-6",
        )

        json_str = _extract_json(raw)
        coalition_data = json.loads(json_str)

        coalitions: list[ActorCoalition] = []
        clusters_for_refine: list[ExplorationCluster] = []

        for c in coalition_data.get("coalitions", []):
            member_indices = c.get("member_indices", [])
            coalition = ActorCoalition(
                coalition_name=c.get("coalition_name", ""),
                members=c.get("members", []),
                shared_interest=c.get("shared_interest", ""),
                conflict_points=c.get("conflict_points", []),
                coalition_strength=c.get("coalition_strength", 0.5),
            )
            coalitions.append(coalition)

            # Map to ExplorationCluster for reuse in Stage 3
            clusters_for_refine.append(ExplorationCluster(
                narrative_direction=f"联盟「{coalition.coalition_name}」",
                explanation=coalition.shared_interest,
                member_indices=member_indices,
                consensus_strength=coalition.coalition_strength,
                representative_index=member_indices[0] if member_indices else 0,
            ))

        yield sse_event("coalition_complete", {
            "coalitions": [
                {
                    "coalition_name": c.coalition_name,
                    "members": c.members,
                    "shared_interest": c.shared_interest,
                    "conflict_points": c.conflict_points,
                    "coalition_strength": c.coalition_strength,
                }
                for c in coalitions
            ],
        })

        # Stage 3: Refine — reuse existing _sonnet_refine for each coalition
        async def _refine_coalition(cluster: ExplorationCluster, idx: int):
            exemplar_idx = cluster.representative_index
            exemplar_points = (
                scenarios[exemplar_idx]["divergence_points"]
                if exemplar_idx < len(scenarios) else []
            )
            try:
                return await self._sonnet_refine(
                    event_data, modification, cluster, exemplar_points,
                )
            except Exception as e:
                logger.warning(f"Refine coalition {idx} ({cluster.narrative_direction}) failed: {e}")
                return None

        refine_tasks = [_refine_coalition(c, i) for i, c in enumerate(clusters_for_refine)]
        refine_results = await asyncio.gather(*refine_tasks)

        branches: list[PossibilityBranch] = []
        for cluster, coalition, timeline in zip(clusters_for_refine, coalitions, refine_results):
            if timeline is None:
                continue
            branches.append(PossibilityBranch(
                cluster=cluster,
                timeline=timeline,
                scenario_count=len(cluster.member_indices),
            ))

        # Store as a PossibilityFan (compatible with existing fan viewer)
        fan = PossibilityFan(
            fan_id=fan_id,
            event_id=event_id,
            event_title=event_title,
            modification=modification,
            total_explorations=len(selected),
            branches=branches,
            token_usage=self.tracker.get_summary(),
        )
        self.fans[fan_id] = fan

        yield sse_event("explore_complete", {
            "fan_id": fan_id,
            "event_title": event_title,
            "modification": modification,
            "total_explorations": len(selected),
            "branch_count": len(branches),
            "embodied": True,
            "coalitions": [
                {
                    "coalition_name": c.coalition_name,
                    "members": c.members,
                    "shared_interest": c.shared_interest,
                    "conflict_points": c.conflict_points,
                    "coalition_strength": c.coalition_strength,
                }
                for c in coalitions
            ],
            "branches": [
                {
                    "cluster_id": b.cluster.cluster_id,
                    "narrative_direction": b.cluster.narrative_direction,
                    "explanation": b.cluster.explanation,
                    "consensus_strength": b.cluster.consensus_strength,
                    "scenario_count": b.scenario_count,
                    "timeline_id": b.timeline.id,
                    "timeline_points": [tp.model_dump() for tp in b.timeline.timeline_points],
                    "summary": b.timeline.summary,
                    "key_divergences": b.timeline.key_divergences,
                    "butterfly_effects": b.timeline.butterfly_effects,
                }
                for b in branches
            ],
            "token_usage": self.tracker.get_summary(),
        })

    # ── Internal helpers ─────────────────────────────────────────

    async def _haiku_divergence(
        self,
        event_summary: str,
        modification: str,
        perspective: str,
        index: int,
    ) -> DivergenceScenario | None:
        """Stage 1 helper: single fast-backend divergence call.

        Uses self.fast_backend which may be Ollama (local 7B) or Claude Haiku,
        depending on configuration.
        """
        system, user = self.prompt_engine.render_divergence_prompt(
            event_summary, modification, perspective,
        )
        try:
            raw = await self.fast_backend.complete(
                system,
                [{"role": "user", "content": user}],
                max_tokens=400,
                temperature=0.9,
            )
            json_str = _extract_json(raw)
            data = json.loads(json_str)
            return DivergenceScenario(
                divergence_points=data.get("divergence_points", []),
                tags=data.get("tags", []),
                perspective=perspective,
            )
        except Exception as e:
            logger.warning(f"Haiku divergence #{index} ({perspective}) error: {e}")
            return None

    async def _cluster_divergences(
        self,
        scenarios: list[DivergenceScenario],
        n_clusters: int,
    ) -> list[ExplorationCluster]:
        """Stage 2: Sonnet clusters the divergence scenarios."""
        # Build text representation for each scenario
        lines = []
        for i, s in enumerate(scenarios):
            points = "; ".join(s.divergence_points)
            tags = ", ".join(s.tags)
            lines.append(f"[{i}] 视角={s.perspective} | 分歧: {points} | 标签: {tags}")

        scenarios_text = "\n".join(lines)

        system, user = self.prompt_engine.render_cluster_prompt(
            scenarios_text, n_clusters
        )

        raw = await self.claude.complete(
            system,
            [{"role": "user", "content": user}],
            max_tokens=2000,
            temperature=0.3,
            model="claude-sonnet-4-6",
        )

        json_str = _extract_json(raw)
        data = json.loads(json_str)

        clusters: list[ExplorationCluster] = []
        for c in data.get("clusters", []):
            member_indices = c.get("member_indices", [])
            clusters.append(ExplorationCluster(
                narrative_direction=c.get("name", "未命名方向"),
                explanation=c.get("explanation", ""),
                member_indices=member_indices,
                consensus_strength=len(member_indices) / len(scenarios) if scenarios else 0,
                representative_index=c.get("exemplar_index", member_indices[0] if member_indices else 0),
            ))

        return clusters

    async def _sonnet_refine(
        self,
        event_data: dict,
        modification: str,
        cluster: ExplorationCluster,
        exemplar_points: list[str],
    ) -> CounterfactualTimeline | None:
        """Stage 3 helper: Sonnet generates a full timeline for one cluster."""
        system, user = self.prompt_engine.render_refined_timeline_prompt(
            event_data, modification, cluster.narrative_direction, exemplar_points,
        )

        buffer = ""
        async for chunk in self.claude.stream(
            system,
            [{"role": "user", "content": user}],
            max_tokens=6000,
            temperature=0.5,
            model="claude-sonnet-4-6",
        ):
            buffer += chunk

        json_str = _extract_json(buffer)
        result = json.loads(json_str)

        timeline = CounterfactualTimeline(
            event_id=event_data.get("id", ""),
            event_title=event_data.get("title", ""),
            modification=modification,
            timeline_points=[
                TimelinePoint(**tp) for tp in result.get("timeline_points", [])
            ],
            summary=result.get("summary", ""),
            key_divergences=result.get("key_divergences", []),
            butterfly_effects=result.get("butterfly_effects", []),
        )

        # Also store in timelines cache
        self.timelines[timeline.id] = timeline
        return timeline

    def get_fan(self, fan_id: str) -> PossibilityFan | None:
        """Retrieve a stored possibility fan."""
        return self.fans.get(fan_id)


def _extract_json(text: str) -> str:
    """Extract JSON from text that may contain markdown code fences."""
    match = re.search(r"```(?:json)?\s*\n?([\s\S]*?)\n?```", text)
    if match:
        return match.group(1).strip()

    brace_start = text.find("{")
    if brace_start >= 0:
        depth = 0
        for i in range(brace_start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    return text[brace_start : i + 1]

    return text.strip()
