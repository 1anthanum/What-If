"""
Orchestrator Service — Cross-Module Causal Feedback Loop.

Chains three modules in a loop:
  反事实时间线 → 自动因果图 → AI 辩论 → 辩论结论反馈到下一轮反事实

Each iteration refines the simulation based on insights from the previous round.
Convergence is detected when consecutive summaries become semantically similar.
"""

import uuid
from typing import AsyncGenerator

from app.core.claude_client import ClaudeClient
from app.core.token_tracker import TokenTracker
from app.core.prompt_engine import PromptEngine
from app.core.streaming import sse_event
from app.services.counterfactual import CounterfactualService
from app.services.causal_graph import CausalGraphService
from app.services.debate_room import DebateRoomService
from app.schemas.orchestration import (
    FeedbackLoopConfig,
    LoopIteration,
    FeedbackLoopResult,
)
from app.schemas.debate import DebateStartRequest


class OrchestratorService:
    """Runs cross-module feedback loops linking all three simulation modules."""

    def __init__(self):
        self.tracker = TokenTracker()
        self.claude = ClaudeClient(token_tracker=self.tracker)
        self.prompt_engine = PromptEngine()

        # Module services (share tracker for unified cost accounting)
        self.counterfactual = CounterfactualService()
        self.causal = CausalGraphService()
        self.debate = DebateRoomService()

        self.results: dict[str, FeedbackLoopResult] = {}

    async def run_feedback_loop(
        self, config: FeedbackLoopConfig,
    ) -> AsyncGenerator[dict, None]:
        """
        Run a multi-iteration feedback loop.

        SSE events:
          loop_start → iteration_start → counterfactual_done → causal_done →
          debate_done → iteration_complete → (repeat) → loop_complete
        """
        loop_id = str(uuid.uuid4())[:8]
        event_data = self.prompt_engine.load_historical_event(config.event_id)
        event_title = event_data.get("title", config.event_id)

        yield sse_event("loop_start", {
            "loop_id": loop_id,
            "event_title": event_title,
            "modification": config.modification,
            "max_iterations": config.max_iterations,
            "modules": config.modules,
        })

        iterations: list[LoopIteration] = []
        current_modification = config.modification
        previous_summary = ""

        for i in range(config.max_iterations):
            yield sse_event("iteration_start", {
                "iteration": i + 1,
                "total": config.max_iterations,
                "modification": current_modification,
            })

            iteration = LoopIteration(iteration=i + 1)

            # ── Step 1: Generate counterfactual timeline ──────────
            try:
                timeline_result = await self._run_counterfactual(
                    config.event_id, current_modification, config.time_horizon,
                )
                iteration.counterfactual_summary = timeline_result.get("summary", "")
                iteration.key_divergences = timeline_result.get("key_divergences", [])

                yield sse_event("counterfactual_done", {
                    "iteration": i + 1,
                    "summary": iteration.counterfactual_summary,
                    "key_divergences": iteration.key_divergences,
                    "timeline_id": timeline_result.get("timeline_id", ""),
                })
            except Exception as e:
                yield sse_event("module_error", {
                    "iteration": i + 1,
                    "module": "counterfactual",
                    "error": str(e),
                })
                iteration.counterfactual_summary = f"[错误: {str(e)}]"

            # ── Step 2: Generate causal graph from divergences ────
            if "causal" in config.modules:
                try:
                    causal_result = await self._run_causal(
                        event_title, current_modification, iteration.key_divergences,
                    )
                    iteration.causal_insights = causal_result.get("insights", [])
                    iteration.causal_graph_id = causal_result.get("graph_id", "")

                    yield sse_event("causal_done", {
                        "iteration": i + 1,
                        "graph_id": iteration.causal_graph_id,
                        "insights": iteration.causal_insights,
                    })
                except Exception as e:
                    yield sse_event("module_error", {
                        "iteration": i + 1,
                        "module": "causal",
                        "error": str(e),
                    })

            # ── Step 3: AI debate on key controversies ────────────
            if "debate" in config.modules:
                try:
                    debate_result = await self._run_debate(
                        event_title,
                        current_modification,
                        iteration.counterfactual_summary,
                        iteration.causal_insights,
                        config.debate_rounds,
                        config.n_debate_personas,
                    )
                    iteration.debate_consensus = debate_result.get("consensus", [])
                    iteration.debate_dissent = debate_result.get("dissent", [])

                    yield sse_event("debate_done", {
                        "iteration": i + 1,
                        "consensus": iteration.debate_consensus,
                        "dissent": iteration.debate_dissent,
                    })
                except Exception as e:
                    yield sse_event("module_error", {
                        "iteration": i + 1,
                        "module": "debate",
                        "error": str(e),
                    })

            # ── Step 4: Synthesize refinement for next iteration ──
            refinement = await self._synthesize_refinement(
                config.modification,
                current_modification,
                iteration,
            )
            iteration.refinement_for_next = refinement

            iterations.append(iteration)

            yield sse_event("iteration_complete", {
                "iteration": i + 1,
                "summary": iteration.counterfactual_summary[:200],
                "refinement": refinement[:200],
            })

            # ── Convergence check ─────────────────────────────────
            if previous_summary and i > 0:
                converged = await self._check_convergence(
                    previous_summary,
                    iteration.counterfactual_summary,
                )
                if converged:
                    yield sse_event("convergence_detected", {
                        "iteration": i + 1,
                        "message": "连续两轮模拟结果语义相似，推演已收敛。",
                    })
                    break

            previous_summary = iteration.counterfactual_summary
            current_modification = f"{config.modification}\n\n[第{i+1}轮反馈约束] {refinement}"

        # ── Final synthesis ────────────────────────────────────────
        final_synthesis = await self._final_synthesis(
            config.modification, event_title, iterations,
        )

        result = FeedbackLoopResult(
            loop_id=loop_id,
            config=config,
            iterations=iterations,
            final_synthesis=final_synthesis,
            convergence_achieved=len(iterations) < config.max_iterations,
            total_iterations=len(iterations),
            token_usage=self.tracker.get_summary(),
        )
        self.results[loop_id] = result

        yield sse_event("loop_complete", {
            "loop_id": loop_id,
            "total_iterations": len(iterations),
            "convergence_achieved": result.convergence_achieved,
            "final_synthesis": final_synthesis,
            "token_usage": self.tracker.get_summary(),
        })

    def get_result(self, loop_id: str) -> FeedbackLoopResult | None:
        return self.results.get(loop_id)

    # ─── Internal Module Runners ───────────────────────────────────

    async def _run_counterfactual(
        self, event_id: str, modification: str, time_horizon: str,
    ) -> dict:
        """Run counterfactual module, consume SSE, return final result."""
        result: dict = {}
        async for event in self.counterfactual.generate_timeline(
            event_id, modification, time_horizon,
        ):
            # Parse SSE event string to extract data
            event_type, event_data = self._parse_sse(event)
            if event_type == "timeline_complete":
                result = {
                    "timeline_id": event_data.get("timeline_id", ""),
                    "summary": event_data.get("summary", ""),
                    "key_divergences": event_data.get("key_divergences", []),
                    "timeline_points": event_data.get("timeline_points", []),
                }
            elif event_type == "error":
                raise RuntimeError(event_data.get("message", "反事实生成失败"))
        return result

    async def _run_causal(
        self, event_title: str, modification: str, key_divergences: list[str],
    ) -> dict:
        """Generate causal graph from counterfactual divergences."""
        hypothesis = f"{modification}。关键分歧点：{'；'.join(key_divergences[:5])}"
        result: dict = {"graph_id": "", "insights": []}

        async for event in self.causal.generate_graph(
            scenario_title=event_title,
            scenario_hypothesis=hypothesis,
            domain="general",
        ):
            event_type, event_data = self._parse_sse(event)
            if event_type == "graph_complete":
                result["graph_id"] = event_data.get("graph_id", "")
                nodes = event_data.get("nodes", [])
                edges = event_data.get("edges", [])
                # Extract insights from high-importance edges
                result["insights"] = [
                    f"{e.get('source_label', '?')} → {e.get('target_label', '?')}: {e.get('mechanism', '')}"
                    for e in (edges[:8] if isinstance(edges, list) else [])
                    if e.get("mechanism")
                ]
        return result

    async def _run_debate(
        self,
        event_title: str,
        modification: str,
        counterfactual_summary: str,
        causal_insights: list[str],
        n_rounds: int = 2,
        n_personas: int = 4,
    ) -> dict:
        """Run a focused debate on key controversies."""
        scenario_hypothesis = (
            f"反事实假设：{modification}\n"
            f"模拟摘要：{counterfactual_summary[:500]}\n"
            f"因果洞察：{'；'.join(causal_insights[:5])}"
        )

        # Start debate session
        request = DebateStartRequest(
            scenario_title=f"{event_title} — 反事实辩论",
            scenario_hypothesis=scenario_hypothesis,
            domain="general",
            time_horizon="30 years",
            max_personas=n_personas,
        )
        session = self.debate.start_session(request)

        # Run rounds (consume SSE stream)
        for _ in range(n_rounds):
            async for event in self.debate.run_round(session.session_id):
                pass  # Consume all events

        # Extract consensus/dissent from the last round summary
        summary = await self._extract_debate_synthesis(session.session_id)
        return summary

    async def _extract_debate_synthesis(self, session_id: str) -> dict:
        """Extract consensus and dissent from debate session."""
        session = self.debate.sessions.get(session_id)
        if not session or not session.rounds:
            return {"consensus": [], "dissent": []}

        # Use Claude to synthesize debate results
        last_round_texts = []
        if session.rounds:
            last_round = session.rounds[-1]
            for msg in last_round.messages:
                last_round_texts.append(f"[{msg.persona_name}]: {msg.content[:300]}")

        system = "你是辩论分析师。从辩论发言中提取共识点和分歧点。输出 JSON: {\"consensus\": [...], \"dissent\": [...]}"
        user = f"辩论发言:\n{'\\n'.join(last_round_texts)}"

        try:
            from app.core.inference import get_strong_backend
            backend = get_strong_backend(self.tracker)
            raw = await backend.complete(system, [{"role": "user", "content": user}], max_tokens=1000)
            from app.services.counterfactual import CounterfactualService
            parsed = CounterfactualService._extract_json_static(raw)
            return {
                "consensus": parsed.get("consensus", []),
                "dissent": parsed.get("dissent", []),
            }
        except Exception:
            return {"consensus": [], "dissent": []}

    async def _synthesize_refinement(
        self, original_mod: str, current_mod: str, iteration: LoopIteration,
    ) -> str:
        """Synthesize feedback from all modules into refinement constraints."""
        system = (
            "你是跨学科模拟协调员。基于本轮三个模块的输出，生成下一轮反事实推演的改进约束。"
            "约束应具体、可操作，直接指导下一轮的推演方向。"
            "用 1-3 句话概括最关键的改进点。"
        )
        user = (
            f"原始假设: {original_mod}\n"
            f"本轮假设: {current_mod}\n\n"
            f"反事实摘要: {iteration.counterfactual_summary[:500]}\n"
            f"关键分歧: {'；'.join(iteration.key_divergences[:5])}\n"
            f"因果洞察: {'；'.join(iteration.causal_insights[:5])}\n"
            f"辩论共识: {'；'.join(iteration.debate_consensus[:3])}\n"
            f"辩论分歧: {'；'.join(iteration.debate_dissent[:3])}\n"
        )

        try:
            from app.core.inference import get_strong_backend
            backend = get_strong_backend(self.tracker)
            return await backend.complete(system, [{"role": "user", "content": user}], max_tokens=500)
        except Exception:
            return "无法生成改进约束"

    async def _check_convergence(self, prev_summary: str, curr_summary: str) -> bool:
        """Check if two consecutive summaries are semantically similar."""
        system = (
            "比较以下两段模拟摘要。如果它们的核心结论基本一致（允许措辞不同），回答 YES。"
            "如果有实质性的新发现或不同结论，回答 NO。只回答 YES 或 NO。"
        )
        user = f"摘要A:\n{prev_summary[:500]}\n\n摘要B:\n{curr_summary[:500]}"

        try:
            from app.core.inference import get_fast_backend
            backend = get_fast_backend(self.tracker)
            result = await backend.complete(system, [{"role": "user", "content": user}], max_tokens=10)
            return "YES" in result.upper()
        except Exception:
            return False

    async def _final_synthesis(
        self, modification: str, event_title: str, iterations: list[LoopIteration],
    ) -> str:
        """Generate a final synthesis from all iterations."""
        system = (
            "你是历史模拟总结者。基于多轮跨模块推演的结果，生成最终综合结论。"
            "重点关注：哪些结论在迭代中保持稳定（高置信），哪些出现了反转（需要谨慎），"
            "以及跨模块分析揭示了哪些单一模块遗漏的洞察。"
            "用 300 字以内概括。"
        )
        iter_summaries = []
        for it in iterations:
            iter_summaries.append(
                f"第{it.iteration}轮:\n"
                f"  反事实: {it.counterfactual_summary[:200]}\n"
                f"  因果洞察: {'；'.join(it.causal_insights[:3])}\n"
                f"  辩论共识: {'；'.join(it.debate_consensus[:3])}\n"
                f"  改进方向: {it.refinement_for_next[:100]}"
            )
        user = (
            f"事件: {event_title}\n假设: {modification}\n"
            f"共 {len(iterations)} 轮迭代:\n\n{'\\n\\n'.join(iter_summaries)}"
        )

        try:
            from app.core.inference import get_strong_backend
            backend = get_strong_backend(self.tracker)
            return await backend.complete(system, [{"role": "user", "content": user}], max_tokens=1000)
        except Exception:
            return "无法生成最终综合结论"

    @staticmethod
    def _parse_sse(event_str: str) -> tuple[str, dict]:
        """Parse a raw SSE event string into (type, data_dict)."""
        import json
        event_type = ""
        data_str = ""
        for line in event_str.strip().split("\n"):
            if line.startswith("event: "):
                event_type = line[7:].strip()
            elif line.startswith("data: "):
                data_str = line[6:].strip()
        try:
            data = json.loads(data_str) if data_str else {}
        except json.JSONDecodeError:
            data = {"raw": data_str}
        return event_type, data
