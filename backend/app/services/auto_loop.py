"""Auto-Loop Scheduler — autonomous continuous exploration.

Runs sequential feedback loops, extracting the next hypothesis from each
loop's final synthesis. Stops when:
  - max_cycles reached
  - synthesis yields no new hypothesis (convergence)
  - user cancels

This is the embryo of the "以史明鉴" (Path B) turn-based decision engine.
Each cycle is roughly equivalent to one "turn" — the system decides what
question to explore next based on what it learned.
"""

import asyncio
import logging
import uuid
from datetime import datetime
from typing import AsyncGenerator

from app.config import get_settings
from app.core.streaming import sse_event
from app.core.token_tracker import TokenTracker
from app.core.inference import get_strong_backend
from app.services.orchestrator import OrchestratorService
from app.schemas.orchestration import FeedbackLoopConfig

logger = logging.getLogger(__name__)


class AutoLoopCycle:
    """Record of a single auto-loop cycle."""
    def __init__(self, cycle: int, hypothesis: str):
        self.cycle = cycle
        self.hypothesis = hypothesis
        self.loop_id: str = ""
        self.synthesis: str = ""
        self.next_hypothesis: str = ""
        self.converged: bool = False
        self.started_at: datetime = datetime.now()
        self.finished_at: datetime | None = None


class AutoLoopResult:
    """Full result of an auto-loop session."""
    def __init__(self, session_id: str, event_id: str, seed_hypothesis: str):
        self.session_id = session_id
        self.event_id = event_id
        self.seed_hypothesis = seed_hypothesis
        self.cycles: list[AutoLoopCycle] = []
        self.total_cycles: int = 0
        self.stopped_reason: str = ""  # "converged" | "max_cycles" | "cancelled" | "error"
        self.evolution_chain: list[str] = []  # hypothesis chain


class AutoLoopScheduler:
    """Chains feedback loops autonomously, extracting next-hypothesis from each."""

    # Class-level cancellation registry
    _cancelled: set[str] = set()

    def __init__(self):
        self.orchestrator = OrchestratorService()
        self.tracker = TokenTracker()
        self.results: dict[str, AutoLoopResult] = {}

    async def run(
        self,
        event_id: str,
        seed_hypothesis: str,
        max_cycles: int | None = None,
        max_iterations_per_loop: int = 2,
        time_horizon: str = "30 years",
    ) -> AsyncGenerator[dict, None]:
        """Run autonomous exploration cycles.

        SSE events:
          auto_start → cycle_start → (feedback loop SSE forwarded) →
          cycle_complete → next_hypothesis → ... → auto_complete
        """
        settings = get_settings()
        if max_cycles is None:
            max_cycles = settings.auto_loop_max_cycles
        pause_seconds = settings.auto_loop_pause_seconds

        session_id = str(uuid.uuid4())[:8]
        result = AutoLoopResult(session_id, event_id, seed_hypothesis)
        self.results[session_id] = result

        yield sse_event("auto_start", {
            "session_id": session_id,
            "event_id": event_id,
            "seed_hypothesis": seed_hypothesis,
            "max_cycles": max_cycles,
        })

        current_hypothesis = seed_hypothesis
        result.evolution_chain.append(current_hypothesis)

        for cycle_num in range(1, max_cycles + 1):
            # Check cancellation
            if session_id in self._cancelled:
                self._cancelled.discard(session_id)
                result.stopped_reason = "cancelled"
                yield sse_event("auto_cancelled", {
                    "session_id": session_id,
                    "cycle": cycle_num,
                })
                break

            cycle = AutoLoopCycle(cycle_num, current_hypothesis)
            result.cycles.append(cycle)

            yield sse_event("cycle_start", {
                "cycle": cycle_num,
                "total": max_cycles,
                "hypothesis": current_hypothesis,
            })

            # Run one feedback loop
            config = FeedbackLoopConfig(
                event_id=event_id,
                modification=current_hypothesis,
                time_horizon=time_horizon,
                max_iterations=max_iterations_per_loop,
            )

            loop_synthesis = ""
            loop_converged = False
            loop_id = ""

            try:
                async for event in self.orchestrator.run_feedback_loop(config):
                    # Forward select events to the auto-loop SSE stream
                    # (parse the raw SSE event dict)
                    event_type = ""
                    event_data = {}
                    if isinstance(event, dict):
                        # sse_event returns a formatted string, but the
                        # orchestrator yields sse_event() results directly
                        raw = event.get("data", "")
                        event_type = event.get("event", "")
                        if isinstance(raw, dict):
                            event_data = raw
                    elif isinstance(event, str):
                        event_type, event_data = OrchestratorService._parse_sse(event)

                    if event_type == "loop_start":
                        loop_id = event_data.get("loop_id", "")
                        cycle.loop_id = loop_id

                    elif event_type == "loop_complete":
                        loop_synthesis = event_data.get("final_synthesis", "")
                        loop_converged = event_data.get("convergence_achieved", False)

                    # Forward iteration-level events for UI progress
                    if event_type in ("iteration_start", "counterfactual_done",
                                      "causal_done", "debate_done",
                                      "iteration_complete", "convergence_detected"):
                        yield sse_event(f"loop_{event_type}", {
                            "cycle": cycle_num,
                            **event_data,
                        })

            except Exception as e:
                logger.error(f"Auto-loop cycle {cycle_num} error: {e}")
                cycle.synthesis = f"[错误: {e}]"
                result.stopped_reason = "error"
                yield sse_event("cycle_error", {
                    "cycle": cycle_num,
                    "error": str(e),
                })
                break

            cycle.synthesis = loop_synthesis
            cycle.converged = loop_converged
            cycle.finished_at = datetime.now()

            yield sse_event("cycle_complete", {
                "cycle": cycle_num,
                "loop_id": loop_id,
                "synthesis_preview": loop_synthesis[:300],
                "converged": loop_converged,
            })

            # Extract next hypothesis from synthesis
            next_hypo = await self._extract_next_hypothesis(
                event_id, seed_hypothesis, current_hypothesis,
                loop_synthesis, result.evolution_chain,
            )
            cycle.next_hypothesis = next_hypo

            if not next_hypo or next_hypo.strip() == current_hypothesis.strip():
                # No new direction — exploration has saturated
                result.stopped_reason = "converged"
                yield sse_event("auto_converged", {
                    "cycle": cycle_num,
                    "message": "探索方向已饱和，无法提取新假设。",
                })
                break

            result.evolution_chain.append(next_hypo)

            yield sse_event("next_hypothesis", {
                "cycle": cycle_num,
                "hypothesis": next_hypo,
                "chain_length": len(result.evolution_chain),
            })

            current_hypothesis = next_hypo

            # Brief pause between cycles (let GPU cool, give user time to cancel)
            if cycle_num < max_cycles:
                await asyncio.sleep(pause_seconds)

        else:
            # Loop exhausted max_cycles
            result.stopped_reason = "max_cycles"

        result.total_cycles = len(result.cycles)

        yield sse_event("auto_complete", {
            "session_id": session_id,
            "total_cycles": result.total_cycles,
            "stopped_reason": result.stopped_reason,
            "evolution_chain": result.evolution_chain,
            "token_usage": self.tracker.get_summary() if hasattr(self.tracker, 'get_summary') else {},
        })

    @classmethod
    def cancel(cls, session_id: str):
        """Signal cancellation for a running auto-loop session."""
        cls._cancelled.add(session_id)

    def get_result(self, session_id: str) -> AutoLoopResult | None:
        return self.results.get(session_id)

    async def _extract_next_hypothesis(
        self,
        event_id: str,
        seed: str,
        current: str,
        synthesis: str,
        chain: list[str],
    ) -> str:
        """Use LLM to extract the most promising next hypothesis from a synthesis.

        The system identifies what the current synthesis leaves unresolved
        or what new questions it raises, then formulates a focused hypothesis.
        """
        system = (
            "你是自主探索调度器。基于当前轮次的综合结论，提取一个值得下一轮深入探索的新假设。\n"
            "要求：\n"
            "1. 新假设必须与之前的假设不同（不要重复）\n"
            "2. 应聚焦于当前综合结论中未解决的争议、意外发现或因果链上的薄弱环节\n"
            "3. 用一句话表述，类似'如果...那么...'\n"
            "4. 如果综合结论已经非常确定，没有新的探索方向，返回空字符串\n\n"
            "只输出新假设本身，不要任何前缀或解释。"
        )

        chain_text = "\n".join(f"  第{i+1}轮: {h}" for i, h in enumerate(chain))
        user = (
            f"原始种子假设: {seed}\n"
            f"当前假设: {current}\n"
            f"已探索假设链:\n{chain_text}\n\n"
            f"当前轮综合结论:\n{synthesis[:800]}\n\n"
            f"请提取下一个值得探索的假设："
        )

        try:
            backend = get_strong_backend(self.tracker)
            result = await backend.complete(
                system, [{"role": "user", "content": user}], max_tokens=200,
            )
            # Clean up: remove quotes, prefixes
            result = result.strip().strip('"').strip("'")
            if result.startswith("假设：") or result.startswith("假设:"):
                result = result[3:].strip()
            return result
        except Exception as e:
            logger.error(f"Failed to extract next hypothesis: {e}")
            return ""
