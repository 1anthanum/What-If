"""Auto-Loop Scheduler — autonomous continuous exploration.

Runs sequential feedback loops, extracting the next hypothesis from each
loop's final synthesis. Stops when:
  - max_cycles reached
  - synthesis yields no new hypothesis (convergence)
  - user cancels

Supports two modes:
  - "historical": full pipeline (counterfactual → causal → debate → synthesis)
  - "philosophical": debate-only loop (5 models debate a question, synthesize,
    extract next sub-question, repeat)

This is the embryo of the "以史明鉴" (Path B) turn-based decision engine.
"""

import asyncio
import logging
import uuid
from datetime import datetime
from typing import AsyncGenerator

from app.config import get_settings
from app.core.streaming import sse_event
from app.core.token_tracker import TokenTracker
from app.core.inference import get_strong_backend, get_backend_for_persona
from app.services.orchestrator import OrchestratorService
from app.services.debate_room import DebateRoomService
from app.schemas.orchestration import FeedbackLoopConfig
from app.schemas.debate import DebateStartRequest

logger = logging.getLogger(__name__)

# Philosophical personas — each holds a distinct tradition
PHILOSOPHICAL_PERSONAS = [
    {
        "id": "rationalist",
        "name": "理性主义者",
        "role": "分析哲学立场",
        "system_prompt": (
            "你是一位分析哲学传统的思想家，强调逻辑严密性、概念清晰度和可证伪性。"
            "你善于拆解模糊的主张，找出隐含前提，并用逻辑论证支持或反驳。"
            "回答时用中文，语言精炼，注重论证结构。300 字以内。"
        ),
    },
    {
        "id": "existentialist",
        "name": "存在主义者",
        "role": "存在主义立场",
        "system_prompt": (
            "你是一位受海德格尔、萨特、加缪影响的存在主义思想家。"
            "你关注人的自由、选择、焦虑和意义的建构。你认为本质先于存在是谬论，"
            "人通过行动定义自己。回答时用中文，带有思辨的激情，300 字以内。"
        ),
    },
    {
        "id": "pragmatist",
        "name": "实用主义者",
        "role": "实用主义立场",
        "system_prompt": (
            "你是一位杜威、詹姆斯传统的实用主义者。你不关心抽象的真理本身，"
            "而关心一个信念在实践中的效果。真理是有用的工具，不是终极实在。"
            "你善于将抽象哲学问题拉回到日常生活的具体影响。中文回答，300 字以内。"
        ),
    },
    {
        "id": "eastern_philosopher",
        "name": "东方哲学家",
        "role": "东方哲学立场",
        "system_prompt": (
            "你融合了儒、释、道三家思想。你关注人与自然的和谐、修身养性、缘起性空。"
            "你的思维方式偏整体性、辩证性，不追求二元对立的答案，"
            "而寻找矛盾中的统一。中文回答，可引用经典，300 字以内。"
        ),
    },
    {
        "id": "critical_theorist",
        "name": "批判理论家",
        "role": "批判理论立场",
        "system_prompt": (
            "你受马克思、福柯、阿多诺等批判理论家影响。你善于揭示权力结构、"
            "意识形态与话语如何塑造所谓的'常识'。你质疑一切看似自然的事物，"
            "追问'谁受益、谁受损'。中文回答，锐利但不刻薄，300 字以内。"
        ),
    },
]

# Adversarial override: replaces critical_theorist's prompt when adversarial=True
ADVERSARIAL_SYSTEM_PROMPT = (
    "你是一位认知对抗专家（魔鬼代言人）。你的唯一使命是摧毁其他思想家论点中"
    "最薄弱的环节。你不代表任何立场，只代表逻辑的严格性。\n\n"
    "你的策略：\n"
    "1. 找到其他思想家论证中最关键的隐含假设，并展示它不成立的情况\n"
    "2. 构造具体的反例，而非抽象的否定\n"
    "3. 指出哪些结论过度自信：证据不足以支撑如此强的声称\n"
    "4. 揭示循环论证和偷换概念\n\n"
    "对每个你攻击的论点，给出一个 1-5 分的脆弱性评分（5=致命缺陷）。\n"
    "中文回答，400 字以内。语言锐利、精准，不留情面。"
)


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
    def __init__(self, session_id: str, event_id: str, seed_hypothesis: str,
                 mode: str = "historical"):
        self.session_id = session_id
        self.event_id = event_id
        self.seed_hypothesis = seed_hypothesis
        self.mode = mode
        self.cycles: list[AutoLoopCycle] = []
        self.total_cycles: int = 0
        self.stopped_reason: str = ""  # "converged" | "max_cycles" | "cancelled" | "error"
        self.evolution_chain: list[str] = []  # hypothesis chain


class AutoLoopScheduler:
    """Chains feedback loops autonomously, extracting next-hypothesis from each.

    Two modes:
      - "historical": full orchestrator pipeline (CF → causal → debate → synthesis)
      - "philosophical": pure debate loop (5 personas argue → synthesize → next question)
    """

    # Class-level cancellation registry
    _cancelled: set[str] = set()

    def __init__(self):
        self.orchestrator = OrchestratorService()
        self.debate = DebateRoomService()
        self.tracker = TokenTracker()
        self.results: dict[str, AutoLoopResult] = {}

    async def run(
        self,
        seed_hypothesis: str,
        max_cycles: int | None = None,
        mode: str = "historical",
        event_id: str = "",
        max_iterations_per_loop: int = 2,
        time_horizon: str = "30 years",
        adversarial: bool = False,
        extract_stances: bool = False,
        branching: bool = False,
    ) -> AsyncGenerator[dict, None]:
        """Run autonomous exploration cycles.

        SSE events:
          auto_start → cycle_start → (mode-specific events) →
          cycle_complete → next_hypothesis → ... → auto_complete
        """
        settings = get_settings()
        if max_cycles is None:
            max_cycles = settings.auto_loop_max_cycles
        pause_seconds = settings.auto_loop_pause_seconds

        session_id = str(uuid.uuid4())[:8]
        result = AutoLoopResult(session_id, event_id, seed_hypothesis, mode=mode)
        self.results[session_id] = result

        yield sse_event("auto_start", {
            "session_id": session_id,
            "mode": mode,
            "event_id": event_id,
            "seed_hypothesis": seed_hypothesis,
            "max_cycles": max_cycles,
            "adversarial": adversarial,
            "extract_stances": extract_stances,
            "branching": branching,
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

            # ── Dispatch to mode-specific runner ──
            if mode == "philosophical":
                cycle_synthesis, cycle_converged, cycle_loop_id = "", False, ""
                try:
                    async for ev in self._run_philosophical_cycle(
                        cycle_num, current_hypothesis, seed_hypothesis,
                        result.evolution_chain,
                        adversarial=adversarial,
                        extract_stances=extract_stances,
                    ):
                        # ev is a dict from sse_event(): {"type": ..., "data": ...}
                        ev_type = ev.get("type", "")
                        ev_data = ev.get("data", {}) if isinstance(ev.get("data"), dict) else {}

                        if ev_type == "phil_debate_done":
                            cycle_loop_id = ev_data.get("debate_session_id", "")
                        elif ev_type == "phil_synthesis_done":
                            cycle_synthesis = ev_data.get("synthesis", "")

                        yield ev

                except Exception as e:
                    logger.error(f"Philosophical cycle {cycle_num} error: {e}")
                    cycle.synthesis = f"[错误: {e}]"
                    result.stopped_reason = "error"
                    yield sse_event("cycle_error", {"cycle": cycle_num, "error": str(e)})
                    break

                cycle.loop_id = cycle_loop_id
                cycle.synthesis = cycle_synthesis
                cycle.converged = cycle_converged

            else:
                # ── Historical mode — full orchestrator pipeline ──
                loop_synthesis, loop_converged, loop_id = "", False, ""
                config = FeedbackLoopConfig(
                    event_id=event_id,
                    modification=current_hypothesis,
                    time_horizon=time_horizon,
                    max_iterations=max_iterations_per_loop,
                )
                try:
                    async for event in self.orchestrator.run_feedback_loop(config):
                        event_type, event_data = "", {}
                        if isinstance(event, dict):
                            raw = event.get("data", "")
                            event_type = event.get("type", "")
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

                        if event_type in ("iteration_start", "counterfactual_done",
                                          "causal_done", "debate_done",
                                          "iteration_complete", "convergence_detected"):
                            yield sse_event(f"loop_{event_type}", {
                                "cycle": cycle_num, **event_data,
                            })
                except Exception as e:
                    logger.error(f"Auto-loop cycle {cycle_num} error: {e}")
                    cycle.synthesis = f"[错误: {e}]"
                    result.stopped_reason = "error"
                    yield sse_event("cycle_error", {"cycle": cycle_num, "error": str(e)})
                    break

                cycle.synthesis = loop_synthesis
                cycle.converged = loop_converged

            cycle.finished_at = datetime.now()

            yield sse_event("cycle_complete", {
                "cycle": cycle_num,
                "loop_id": cycle.loop_id,
                "synthesis_preview": cycle.synthesis[:500],
                "converged": cycle.converged,
            })

            # Extract next hypothesis / question
            if branching and mode == "philosophical":
                candidates = await self._extract_candidate_questions(
                    seed_hypothesis, current_hypothesis,
                    cycle.synthesis, result.evolution_chain,
                )
                if candidates:
                    yield sse_event("candidate_questions", {
                        "cycle": cycle_num,
                        "candidates": candidates,
                    })
                    # Default: pick the first candidate (user can override via branching UI)
                    next_hypo = candidates[0] if candidates else ""
                else:
                    next_hypo = ""
            elif mode == "philosophical":
                next_hypo = await self._extract_next_question(
                    seed_hypothesis, current_hypothesis,
                    cycle.synthesis, result.evolution_chain,
                )
            else:
                next_hypo = await self._extract_next_hypothesis(
                    event_id, seed_hypothesis, current_hypothesis,
                    cycle.synthesis, result.evolution_chain,
                )
            cycle.next_hypothesis = next_hypo

            if not next_hypo or next_hypo.strip() == current_hypothesis.strip():
                result.stopped_reason = "converged"
                yield sse_event("auto_converged", {
                    "cycle": cycle_num,
                    "message": "探索方向已饱和" if mode == "historical" else "哲学对话趋于收敛，核心分歧已充分展开。",
                })
                break

            result.evolution_chain.append(next_hypo)

            yield sse_event("next_hypothesis", {
                "cycle": cycle_num,
                "hypothesis": next_hypo,
                "chain_length": len(result.evolution_chain),
            })

            current_hypothesis = next_hypo

            if cycle_num < max_cycles:
                await asyncio.sleep(pause_seconds)

        else:
            result.stopped_reason = "max_cycles"

        result.total_cycles = len(result.cycles)

        yield sse_event("auto_complete", {
            "session_id": session_id,
            "mode": mode,
            "total_cycles": result.total_cycles,
            "stopped_reason": result.stopped_reason,
            "evolution_chain": result.evolution_chain,
            "token_usage": self.tracker.get_summary() if hasattr(self.tracker, 'get_summary') else {},
        })

    # ─── Philosophical Mode: Debate-Only Cycle ───────────────────

    async def _run_philosophical_cycle(
        self,
        cycle_num: int,
        question: str,
        seed_question: str,
        chain: list[str],
        adversarial: bool = False,
        extract_stances: bool = False,
    ) -> AsyncGenerator[dict, None]:
        """One cycle of philosophical debate:
        5 personas each give their perspective → (optional adversarial) → synthesis.

        When adversarial=True, the 5th persona (critical_theorist) becomes a
        devil's advocate who reads all other responses and targets weaknesses.

        When extract_stances=True, emits a phil_stance_matrix event after synthesis.

        Yields SSE events: phil_persona_start, phil_persona_chunk,
        phil_persona_complete, phil_debate_done, phil_synthesis_done,
        (optional) phil_stance_matrix.
        """
        # Build context from previous rounds
        history_context = ""
        if len(chain) > 1:
            prev = chain[:-1]
            history_context = (
                "此前的对话已经探讨了以下问题：\n"
                + "\n".join(f"  {i+1}. {q}" for i, q in enumerate(prev))
                + "\n\n请在此基础上深入，避免重复已有观点。\n\n"
            )

        # Phase 1: First 4 personas respond (or all 5 if not adversarial)
        all_responses: list[dict] = []
        personas_to_run = PHILOSOPHICAL_PERSONAS[:4] if adversarial else PHILOSOPHICAL_PERSONAS

        for idx, persona in enumerate(personas_to_run):
            backend = get_backend_for_persona(self.tracker, idx)
            model_name = backend.backend_name()

            yield sse_event("phil_persona_start", {
                "cycle": cycle_num,
                "persona_id": persona["id"],
                "persona_name": persona["name"],
                "persona_role": persona["role"],
                "model": model_name,
                "is_adversarial": False,
            })

            user_prompt = (
                f"{history_context}"
                f"当前问题：{question}\n\n"
                f"请从你的哲学立场出发，对这个问题给出你的分析和立场。"
                f"如果你与其他思想流派存在根本分歧，请明确指出分歧所在。"
            )

            full_response: list[str] = []
            async for chunk in backend.stream(
                system_prompt=persona["system_prompt"],
                messages=[{"role": "user", "content": user_prompt}],
                max_tokens=600,
            ):
                full_response.append(chunk)
                yield sse_event("phil_persona_chunk", {
                    "cycle": cycle_num,
                    "persona_id": persona["id"],
                    "text": chunk,
                })

            content = "".join(full_response)
            all_responses.append({
                "persona_id": persona["id"],
                "persona_name": persona["name"],
                "content": content,
            })

            yield sse_event("phil_persona_complete", {
                "cycle": cycle_num,
                "persona_id": persona["id"],
                "persona_name": persona["name"],
                "content": content,
            })

        # Phase 2: Adversarial pass — devil's advocate reads all responses and attacks
        if adversarial:
            adversary = PHILOSOPHICAL_PERSONAS[4]  # critical_theorist
            backend = get_backend_for_persona(self.tracker, 4)
            model_name = backend.backend_name()

            yield sse_event("phil_persona_start", {
                "cycle": cycle_num,
                "persona_id": "adversary",
                "persona_name": "魔鬼代言人",
                "persona_role": "对抗性审查",
                "model": model_name,
                "is_adversarial": True,
            })

            # Build adversarial input with all other responses
            others_text = "\n\n".join(
                f"【{r['persona_name']}】\n{r['content']}" for r in all_responses
            )
            adversarial_user = (
                f"问题：{question}\n\n"
                f"以下是四位哲学家的论点，请逐一审查并攻击最薄弱的环节：\n\n"
                f"{others_text}"
            )

            full_response: list[str] = []
            async for chunk in backend.stream(
                system_prompt=ADVERSARIAL_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": adversarial_user}],
                max_tokens=800,
            ):
                full_response.append(chunk)
                yield sse_event("phil_persona_chunk", {
                    "cycle": cycle_num,
                    "persona_id": "adversary",
                    "text": chunk,
                })

            adv_content = "".join(full_response)
            all_responses.append({
                "persona_id": "adversary",
                "persona_name": "魔鬼代言人",
                "content": adv_content,
            })

            yield sse_event("phil_persona_complete", {
                "cycle": cycle_num,
                "persona_id": "adversary",
                "persona_name": "魔鬼代言人",
                "content": adv_content,
            })

        yield sse_event("phil_debate_done", {
            "cycle": cycle_num,
            "n_personas": len(all_responses),
            "debate_session_id": f"phil-{cycle_num}",
            "adversarial": adversarial,
        })

        # Synthesize all perspectives
        synthesis = await self._synthesize_philosophical(
            question, seed_question, all_responses, chain,
        )

        yield sse_event("phil_synthesis_done", {
            "cycle": cycle_num,
            "synthesis": synthesis,
        })

        # Feature 1: Extract stance matrix (epistemic divergence map)
        if extract_stances:
            stance_matrix = await self._extract_stance_matrix(
                question, all_responses,
            )
            yield sse_event("phil_stance_matrix", {
                "cycle": cycle_num,
                "matrix": stance_matrix,
            })

    async def _synthesize_philosophical(
        self,
        question: str,
        seed_question: str,
        responses: list[dict],
        chain: list[str],
    ) -> str:
        """Synthesize 5 philosophical perspectives into a coherent analysis."""
        system = (
            "你是一位跨学科哲学调停者。你的任务是从五个不同哲学传统的回应中：\n"
            "1. 找到各立场之间的真正共识（不是表面和稀泥）\n"
            "2. 明确不可调和的核心分歧\n"
            "3. 揭示各立场的隐含前提和盲区\n"
            "4. 指出对话中出现的最深刻洞察\n\n"
            "用中文输出，400 字以内。语言须精确，避免笼统的总结。"
        )

        persona_texts = "\n\n".join(
            f"【{r['persona_name']}】\n{r['content']}" for r in responses
        )

        user = (
            f"原始问题: {seed_question}\n"
            f"当前聚焦: {question}\n\n"
            f"五位哲学家的回应:\n{persona_texts}"
        )

        try:
            backend = get_strong_backend(self.tracker)
            return await backend.complete(
                system, [{"role": "user", "content": user}], max_tokens=800,
            )
        except Exception as e:
            logger.error(f"Philosophical synthesis failed: {e}")
            return f"[综合失败: {e}]"

    async def _extract_stance_matrix(
        self,
        question: str,
        responses: list[dict],
    ) -> dict:
        """Extract a persona × argument stance matrix from debate responses.

        Returns: {
            "arguments": ["arg1", "arg2", ...],   # 4-6 key arguments/positions
            "stances": {
                "persona_id": [score1, score2, ...],  # -1.0 to 1.0
                ...
            }
        }
        """
        import json as json_mod

        system = (
            "你是辩论分析师。从多位哲学家对同一问题的回应中：\n"
            "1. 提取 4-6 个核心论点/立场（简短标签，10 字以内）\n"
            "2. 为每位思想家在每个论点上打分：-1.0（强烈反对）到 1.0（强烈支持），0 表示未表态\n\n"
            "严格输出 JSON：\n"
            '{"arguments": ["论点1", "论点2", ...], '
            '"stances": {"persona_id": [score1, score2, ...], ...}}\n\n'
            "不要输出任何 JSON 以外的内容。"
        )

        persona_texts = "\n\n".join(
            f"[{r['persona_id']}] {r['persona_name']}:\n{r['content']}" for r in responses
        )
        user = f"问题: {question}\n\n各方回应:\n{persona_texts}"

        try:
            backend = get_strong_backend(self.tracker)
            raw = await backend.complete(
                system, [{"role": "user", "content": user}],
                max_tokens=800, temperature=0.2,
            )
            # Parse JSON from response
            raw = raw.strip()
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            return json_mod.loads(raw)
        except Exception as e:
            logger.error(f"Stance matrix extraction failed: {e}")
            return {"arguments": [], "stances": {}}

    async def _extract_candidate_questions(
        self,
        seed: str,
        current: str,
        synthesis: str,
        chain: list[str],
    ) -> list[str]:
        """Extract top-3 candidate sub-questions for branching (Feature 3).

        Returns a list of 3 distinct questions ranked by depth potential.
        """
        import json as json_mod

        system = (
            "你是哲学对话的分支引导者。基于综合分析，提取 3 个最值得深入的子问题。\n"
            "要求：\n"
            "1. 三个问题必须指向不同的方向（维度正交）\n"
            "2. 按探索深度潜力排序（最有潜力的在前）\n"
            "3. 不要重复已探讨的问题\n"
            "4. 每个问题用一句话，尖锐且具体\n\n"
            '严格输出 JSON 数组：["问题1", "问题2", "问题3"]\n'
            "不要输出任何 JSON 以外的内容。"
        )

        chain_text = "\n".join(f"  第{i+1}轮: {h}" for i, h in enumerate(chain))
        user = (
            f"原始问题: {seed}\n"
            f"当前问题: {current}\n"
            f"已探讨问题链:\n{chain_text}\n\n"
            f"当前轮综合分析:\n{synthesis[:1000]}\n\n"
            f"请提取 3 个候选子问题："
        )

        try:
            backend = get_strong_backend(self.tracker)
            raw = await backend.complete(
                system, [{"role": "user", "content": user}],
                max_tokens=400, temperature=0.5,
            )
            raw = raw.strip()
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            candidates = json_mod.loads(raw)
            if isinstance(candidates, list) and len(candidates) > 0:
                return [str(c).strip() for c in candidates[:3]]
            return []
        except Exception as e:
            logger.error(f"Failed to extract candidate questions: {e}")
            return []

    async def _extract_next_question(
        self,
        seed: str,
        current: str,
        synthesis: str,
        chain: list[str],
    ) -> str:
        """Extract the next philosophical sub-question from synthesis."""
        system = (
            "你是哲学对话的引导者。基于当前轮次的综合分析，提取一个值得下一轮深入探讨的子问题。\n"
            "要求：\n"
            "1. 新问题必须与之前的问题不同（不要重复，检查已探讨列表）\n"
            "2. 应聚焦于综合分析中揭示的最深层分歧或最有启发性的盲区\n"
            "3. 问题应更具体、更尖锐，推动对话走向更深处而非更广处\n"
            "4. 如果对话已经充分展开所有核心分歧，返回空字符串\n\n"
            "只输出问题本身，不要任何前缀或解释。"
        )

        chain_text = "\n".join(f"  第{i+1}轮: {h}" for i, h in enumerate(chain))
        user = (
            f"原始问题: {seed}\n"
            f"当前问题: {current}\n"
            f"已探讨问题链:\n{chain_text}\n\n"
            f"当前轮综合分析:\n{synthesis[:1000]}\n\n"
            f"请提取下一个值得深入的子问题："
        )

        try:
            backend = get_strong_backend(self.tracker)
            result = await backend.complete(
                system, [{"role": "user", "content": user}], max_tokens=200,
            )
            result = result.strip().strip('"').strip("'")
            if result.startswith("问题：") or result.startswith("问题:"):
                result = result[3:].strip()
            return result
        except Exception as e:
            logger.error(f"Failed to extract next question: {e}")
            return ""

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
