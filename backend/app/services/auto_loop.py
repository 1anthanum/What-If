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
from app.core.claude_client import cached_system
from app.services.orchestrator import OrchestratorService
from app.services.debate_room import DebateRoomService
from app.schemas.orchestration import FeedbackLoopConfig
from app.schemas.debate import DebateStartRequest

logger = logging.getLogger(__name__)

# Philosophical personas — each holds a distinct tradition
# Smart persona × model pairing — picks the provider best-suited for each
# persona's intellectual tradition. Falls back to round-robin if the preferred
# provider isn't in the configured persona_pool.
PERSONA_MODEL_PREFERENCE = {
    "rationalist":         "openai",      # analytic philosophy — Western precision
    "existentialist":      "claude",       # reflective / thoughtful prose
    "pragmatist":          "openai",       # American pragmatism
    "eastern_philosopher": "deepseek",     # strongest at Chinese classical citations
    "critical_theorist":   "glm",          # social-science critique training
    "adversary":           "openai",       # GPT-5 reasoning is sharpest at finding flaws
}


def _smart_persona_backend(tracker, persona_id: str, fallback_idx: int):
    """Pick the configured pool spec whose provider matches PERSONA_MODEL_PREFERENCE.
    Fall back to round-robin from get_backend_for_persona on miss.

    Override via WHATIF_PERSONA_PROVIDER_OVERRIDE (used by the
    randomized-pairing ablation): comma-separated `persona_id:provider`
    list that supersedes PERSONA_MODEL_PREFERENCE for this run only.
    """
    import os
    from app.config import get_settings
    from app.core.inference import get_backend_from_spec, get_backend_for_persona

    override_str = os.environ.get("WHATIF_PERSONA_PROVIDER_OVERRIDE", "").strip()
    preferred = None
    explicit_spec = None  # full provider:model from override (e.g. "claude:claude-haiku-4-5")
    if override_str:
        for pair in override_str.split(","):
            pair = pair.strip()
            if not pair or ":" not in pair: continue
            pid, rest = pair.split(":", 1)
            if pid.strip() != persona_id: continue
            rest = rest.strip()
            if ":" in rest:
                # Full provider:model spec (e.g. "rationalist:claude:claude-haiku-4-5-20251001")
                explicit_spec = rest
            else:
                preferred = rest
            break
    if preferred is None and explicit_spec is None:
        preferred = PERSONA_MODEL_PREFERENCE.get(persona_id)

    pool_str = getattr(get_settings(), "persona_pool", "")
    if explicit_spec and pool_str:
        for spec in pool_str.split(","):
            if spec.strip() == explicit_spec:
                return get_backend_from_spec(spec.strip(), tracker, tier="persona")
    if preferred and pool_str:
        for spec in pool_str.split(","):
            spec = spec.strip()
            if spec.startswith(f"{preferred}:"):
                return get_backend_from_spec(spec, tracker, tier="persona")
    return get_backend_for_persona(tracker, fallback_idx)


def _maybe_load_en_prompt(persona_id: str, zh_fallback: str) -> str:
    """Bilingual sensitivity: if WHATIF_LANGUAGE=en, load the EN persona
    prompt file. Otherwise return the Chinese fallback unchanged. Used
    for the 2026-05-17 bilingual replication; no effect when env unset.
    """
    import os
    if os.environ.get("WHATIF_LANGUAGE", "").lower() != "en":
        return zh_fallback
    from pathlib import Path
    p = Path(__file__).resolve().parent.parent / "data" / "prompts" / "v1" / f"persona_{persona_id}_en.txt"
    if not p.exists(): return zh_fallback
    text = p.read_text(encoding="utf-8")
    # strip leading comment lines
    lines = [ln for ln in text.splitlines() if not ln.strip().startswith("#")]
    return "\n".join(lines).strip()


PHILOSOPHICAL_PERSONAS = [
    {
        "id": "rationalist",
        "name": "理性主义者",
        "role": "分析哲学立场",
        "system_prompt": _maybe_load_en_prompt("rationalist", (
            "你是一位分析哲学传统的思想家，强调逻辑严密性、概念清晰度和可证伪性。"
            "你善于拆解模糊的主张，找出隐含前提，并用逻辑论证支持或反驳。"
            "回答时用中文，语言精炼，注重论证结构。300 字以内。"
        )),
    },
    {
        "id": "existentialist",
        "name": "存在主义者",
        "role": "存在主义立场",
        "system_prompt": _maybe_load_en_prompt("existentialist", (
            "你是一位受海德格尔、萨特、加缪影响的存在主义思想家。"
            "你关注人的自由、选择、焦虑和意义的建构。你认为本质先于存在是谬论，"
            "人通过行动定义自己。回答时用中文，带有思辨的激情，300 字以内。"
        )),
    },
    {
        "id": "pragmatist",
        "name": "实用主义者",
        "role": "实用主义立场",
        "system_prompt": _maybe_load_en_prompt("pragmatist", (
            "你是一位杜威、詹姆斯传统的实用主义者。你不关心抽象的真理本身，"
            "而关心一个信念在实践中的效果。真理是有用的工具，不是终极实在。"
            "你善于将抽象哲学问题拉回到日常生活的具体影响。中文回答，300 字以内。"
        )),
    },
    {
        "id": "eastern_philosopher",
        "name": "东方哲学家",
        "role": "东方哲学立场",
        "system_prompt": _maybe_load_en_prompt("eastern_philosopher", (
            "你融合了儒、释、道三家思想。你关注人与自然的和谐、修身养性、缘起性空。"
            "你的思维方式偏整体性、辩证性，不追求二元对立的答案，"
            "而寻找矛盾中的统一。中文回答，可引用经典，300 字以内。"
        )),
    },
    {
        "id": "critical_theorist",
        "name": "批判理论家",
        "role": "批判理论立场",
        "system_prompt": _maybe_load_en_prompt("critical_theorist", (
            "你受马克思、福柯、阿多诺等批判理论家影响。你善于揭示权力结构、"
            "意识形态与话语如何塑造所谓的'常识'。你质疑一切看似自然的事物，"
            "追问'谁受益、谁受损'。中文回答，锐利但不刻薄，300 字以内。"
        )),
    },
    # ── K=10 扩展：personas 6-10（paper-2 补充实验，2026-05-21）──
    # 用于 WHATIF_PERSONA_K 大于 5 的情况。每个传统选了与前 5 个明显正交的
    # 思想取向，不再走相近的哲学家。
    {
        "id": "virtue_ethicist",
        "name": "美德伦理学者",
        "role": "美德伦理立场",
        "system_prompt": _maybe_load_en_prompt("virtue_ethicist", (
            "你受亚里士多德、麦金太尔的美德伦理传统影响。你不问'应当做什么'，"
            "而问'什么样的人应当做这件事'。你关注品格、习惯、目的（telos）、"
            "实践智慧。你拒绝把伦理问题还原为规则计算。中文回答，300 字以内。"
        )),
    },
    {
        "id": "utilitarian",
        "name": "功利主义者",
        "role": "功利主义立场",
        "system_prompt": _maybe_load_en_prompt("utilitarian", (
            "你受边沁、密尔影响。你认为对一切行动的评价应基于其总体后果对"
            "受影响者福祉的净影响。你愿意计算、比较、取舍，包括尖锐的取舍。"
            "你警惕道德直觉伪装成原则。中文回答，逻辑清晰，300 字以内。"
        )),
    },
    {
        "id": "feminist_theorist",
        "name": "女性主义理论家",
        "role": "女性主义立场",
        "system_prompt": _maybe_load_en_prompt("feminist_theorist", (
            "你受波伏娃、巴特勒、海弗利克影响。你关注性别、身体、关怀劳动、"
            "在话语和制度中如何被分配的（不）平等。你的提问方式是：'谁的视角"
            "被默认为中性？谁的经验被边缘化？'。中文回答，300 字以内。"
        )),
    },
    {
        "id": "religious_traditionalist",
        "name": "宗教传统主义者",
        "role": "宗教传统立场",
        "system_prompt": _maybe_load_en_prompt("religious_traditionalist", (
            "你受托马斯·阿奎那、奥古斯丁、儒家传统影响。你认为存在超越个人偏好"
            "的客观善与自然法；传统、礼制、神圣秩序对个体选择有约束力。你重视"
            "代际延续与共同体的道德资本。中文回答，庄重，300 字以内。"
        )),
    },
    {
        "id": "complexity_theorist",
        "name": "复杂系统论者",
        "role": "复杂性立场",
        "system_prompt": _maybe_load_en_prompt("complexity_theorist", (
            "你受普利高津、考夫曼、Bar-Yam 的复杂系统理论影响。你看到的是非"
            "线性反馈、涌现、相变、路径依赖。你反对线性因果推断，怀疑'最优解"
            "存在'的假设；你看到的是吸引子和适应性景观。中文回答，300 字以内。"
        )),
    },
]
PHILOSOPHICAL_PERSONAS_FULL = PHILOSOPHICAL_PERSONAS  # alias for clarity

# Popper falsifiability directive — appended to every persona's user prompt
# so each statement is forced to surface what evidence would change its mind.
# A response without this line gets tagged as "dogmatic" in the UI.
FALSIFIABILITY_DIRECTIVE_ZH = (
    "\n\n**必须在结尾另起一段加上一行**：\n"
    "「可证伪线：__」（填入 1-2 条**具体**的证据 / 反例 / 论证，"
    "若它们成立你会改变立场。回避或泛泛而谈视为教条主义。）"
)
FALSIFIABILITY_DIRECTIVE_EN = (
    "\n\n**End your response with a separate final line**:\n"
    "\"Falsifiability line: __\" (1-2 *concrete* pieces of evidence / counter-examples "
    "/ arguments which, if true, would change your stance. Vague or evasive answers count as dogmatic.)"
)

# Judge prompt — invoked after synthesis to produce explicit verdicts
# on contested points. Output is a structured JSON the UI renders.
JUDGE_VERDICT_SYSTEM = (
    "你是一位辩论裁判，任务是在 N 位思想家就同一哲学问题展开辩论后，"
    "对核心**争议点**做出明确的胜出判定。\n\n"
    "你不是综合者 —— 不要「两边都有道理」地回避。每个争议点必须给出**胜出立场**"
    "和**胜出理由**。如果两方势均力敌，明确说出「势均力敌」并解释为什么。\n\n"
    "严格输出 JSON：\n"
    "{\n"
    "  \"verdicts\": [\n"
    "    {\n"
    "      \"contested_point\": \"争议点的核心问题（一句话）\",\n"
    "      \"winning_position\": \"胜出立场（短描述）\",\n"
    "      \"winning_personas\": [\"持此立场的 persona_id\"],\n"
    "      \"verdict_reason\": \"为什么此立场胜出（≤80 字）\",\n"
    "      \"confidence\": 1-5\n"
    "    }\n"
    "  ],\n"
    "  \"overall_strongest\": {\"persona_id\": \"\", \"reason\": \"≤60 字\"},\n"
    "  \"overall_weakest\": {\"persona_id\": \"\", \"reason\": \"≤60 字\"}\n"
    "}\n\n"
    "至少识别 2 个、至多 5 个争议点。只输出 JSON，不要 markdown 围栏。"
)

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
        self.final_synthesis: str = ""  # cross-cycle meta-synthesis (Opus)


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
        flip_stance: bool = False,
        subq_decomposition: bool = False,
        self_reflection: bool = False,
        subdomain_routing: bool = False,
        shuffle_personas: bool = False,
        shuffle_seed: int | None = None,
        extractor_config: dict | None = None,
        judge_verdict: bool = False,
        persona_overrides: dict[str, str] | None = None,
        session_id: str | None = None,
    ) -> AsyncGenerator[dict, None]:
        """Outer wrapper: tee every SSE event to a per-session JSONL log
        for offline analysis / report export. Inner generator does the work.

        shuffle_personas: when True, run with a derangement-permuted persona
            prompt set (negative control — see Y5 spec).
        shuffle_seed: RNG seed for the persona shuffle. Required if
            shuffle_personas is True; pass an integer to make the run reproducible.
        extractor_config: kwargs dict for ExtractorConfig (Y4 ablation). When
            None, the production B3 defaults apply.
        """
        import json as _json
        import time as _time
        from app.services.autonomous_debate import RUN_LOG_DIR

        if shuffle_personas and shuffle_seed is None:
            raise ValueError("shuffle_personas=True requires shuffle_seed (int) for reproducibility")

        gen = self._run_impl(
            seed_hypothesis, max_cycles, mode, event_id, max_iterations_per_loop,
            time_horizon, adversarial, extract_stances, branching, flip_stance,
            subq_decomposition=subq_decomposition,
            self_reflection=self_reflection,
            subdomain_routing=subdomain_routing,
            shuffle_personas=shuffle_personas, shuffle_seed=shuffle_seed,
            extractor_config=extractor_config,
            judge_verdict=judge_verdict,
            persona_overrides=persona_overrides,
            session_id=session_id,
        )
        # Buffer first event to learn session_id, then start writing log
        first_ev = None
        async for ev in gen:
            first_ev = ev
            break
        sid = (first_ev or {}).get("data", {}).get("session_id") or "unknown"
        log_path = RUN_LOG_DIR / f"auto-{sid}.jsonl"
        log_fh = log_path.open("w", buffering=1)
        start_ts = _time.time()
        def _write(ev: dict):
            try:
                log_fh.write(_json.dumps({"t_ms": int((_time.time() - start_ts) * 1000), **ev}, ensure_ascii=False) + "\n")
            except Exception:
                pass
        try:
            if first_ev is not None:
                _write(first_ev)
                yield first_ev
            async for ev in gen:
                _write(ev)
                yield ev
        finally:
            log_fh.close()

    async def _run_impl(
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
        flip_stance: bool = False,
        subq_decomposition: bool = False,
        self_reflection: bool = False,
        subdomain_routing: bool = False,
        shuffle_personas: bool = False,
        shuffle_seed: int | None = None,
        extractor_config: dict | None = None,
        judge_verdict: bool = False,
        persona_overrides: dict[str, str] | None = None,
        session_id: str | None = None,
    ) -> AsyncGenerator[dict, None]:
        """Run autonomous exploration cycles.

        SSE events:
          auto_start → cycle_start → (mode-specific events) →
          cycle_complete → next_hypothesis → ... → auto_complete

        session_id: if provided by caller, used as-is (lets the HTTP layer
            pre-allocate one for the SSE bus). Otherwise auto-generated.
        """
        settings = get_settings()
        if max_cycles is None:
            max_cycles = settings.auto_loop_max_cycles
        pause_seconds = settings.auto_loop_pause_seconds

        # Stash overrides on self so _run_philosophical_cycle picks them up
        # when looking up persona system_prompt. Sanitize: keep only known
        # persona ids; cap text length to avoid abuse.
        VALID_PERSONA_IDS = {p["id"] for p in PHILOSOPHICAL_PERSONAS} | {"adversary"}
        clean_overrides: dict[str, str] = {}
        if persona_overrides:
            for pid, text in persona_overrides.items():
                if pid in VALID_PERSONA_IDS and isinstance(text, str):
                    clean_overrides[pid] = text.strip()[:4000]
        self._persona_overrides = clean_overrides

        if not session_id:
            session_id = str(uuid.uuid4())[:8]
        result = AutoLoopResult(session_id, event_id, seed_hypothesis, mode=mode)
        self.results[session_id] = result

        # Y5 negative-control: optionally shuffle persona system_prompts.
        # Stored on self so _run_philosophical_cycle can read it without
        # changing its signature. Concurrent runs would race on this attr,
        # but auto-loop today is run serially per scheduler instance.
        self._active_personas = PHILOSOPHICAL_PERSONAS
        # Persona leave-one-out (LOO) ablation: WHATIF_DROP_PERSONA env var
        # removes the named persona from the active set. Used to test whether
        # any single philosophical tradition is load-bearing for CDI.
        import os as _os_loo
        _drop = _os_loo.environ.get("WHATIF_DROP_PERSONA", "").strip()
        if _drop:
            self._active_personas = [p for p in self._active_personas
                                     if p["id"] != _drop]
        # K-personas ablation (paper-2 supplementary, 2026-05-21):
        # WHATIF_PERSONA_K=N slices the active persona list to the first N
        # entries. Combined with PHILOSOPHICAL_PERSONAS extended to 10, this
        # supports K ∈ {2..10}. The first 5 indices are unchanged from the
        # original B3 schema, so K=5 (or unset) reproduces the headline runs.
        _k_str = _os_loo.environ.get("WHATIF_PERSONA_K", "").strip()
        if _k_str:
            try:
                _k = int(_k_str)
                if 2 <= _k <= len(self._active_personas):
                    self._active_personas = self._active_personas[:_k]
            except ValueError:
                pass
        # Y4 ablation: per-run extractor config (dict → ExtractorConfig built
        # at the cycle call site). None means "use ExtractorConfig() defaults".
        self._extractor_config_dict = extractor_config or None
        shuffle_meta: dict | None = None
        if shuffle_personas:
            from app.research.shuffle import derange_personas, is_derangement
            assert shuffle_seed is not None  # enforced in run() wrapper
            self._active_personas = derange_personas(PHILOSOPHICAL_PERSONAS, shuffle_seed)
            assert is_derangement(PHILOSOPHICAL_PERSONAS, self._active_personas)
            shuffle_meta = {
                "enabled": True,
                "seed": shuffle_seed,
                "mapping": {p["id"]: p["_shuffled_from_id"] for p in self._active_personas},
            }

        yield sse_event("auto_start", {
            "session_id": session_id,
            "mode": mode,
            "event_id": event_id,
            "seed_hypothesis": seed_hypothesis,
            "max_cycles": max_cycles,
            "adversarial": adversarial,
            "extract_stances": extract_stances,
            "branching": branching,
            "shuffle_personas": shuffle_meta,
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

            # Tag every record from now on with this cycle (Y1 efficiency reporting).
            self.tracker.set_context(cycle=cycle_num, phase=f"cycle_{cycle_num}")

            # ── Dispatch to mode-specific runner ──
            if mode == "philosophical":
                cycle_synthesis, cycle_converged, cycle_loop_id = "", False, ""
                try:
                    async for ev in self._run_philosophical_cycle(
                        cycle_num, current_hypothesis, seed_hypothesis,
                        result.evolution_chain,
                        adversarial=adversarial,
                        extract_stances=extract_stances,
                        flip_stance=flip_stance,
                        subq_decomposition=subq_decomposition,
                        self_reflection=self_reflection,
                        subdomain_routing=subdomain_routing,
                        judge_verdict=judge_verdict,
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

        # ── Cross-cycle meta-synthesis (Opus): only worth the cost when we
        # actually have ≥2 cycles. Single-cycle runs already have a synthesis.
        final_synthesis = ""
        if mode == "philosophical" and len(result.cycles) >= 2:
            yield sse_event("final_synth_start", {"session_id": session_id})
            self.tracker.set_context(phase="final_meta_synthesis", cycle=None, persona=None)
            final_synthesis = await self._meta_synthesize_across_cycles(
                seed_hypothesis, result.cycles,
            )
            yield sse_event("final_synth_done", {
                "session_id": session_id,
                "final_synthesis": final_synthesis,
            })
        result.final_synthesis = final_synthesis

        yield sse_event("auto_complete", {
            "session_id": session_id,
            "mode": mode,
            "total_cycles": result.total_cycles,
            "stopped_reason": result.stopped_reason,
            "evolution_chain": result.evolution_chain,
            "final_synthesis": final_synthesis,
            "token_usage": self.tracker.summary(),
        })

    async def _meta_synthesize_across_cycles(
        self,
        seed_hypothesis: str,
        cycles: list,
    ) -> str:
        """Opus reads every cycle's per-cycle synthesis + evolution chain,
        produces a single meta-narrative that traces how thinking evolved
        across the run. Higher-quality than just stitching summaries.
        """
        from app.core.inference import get_decider_backend
        backend = get_decider_backend(self.tracker)
        cycles_block = "\n\n".join(
            f"## Cycle {c.cycle}：{c.hypothesis}\n{c.synthesis or '(无)'}"
            for c in cycles if c.synthesis
        )
        chain_block = " → ".join(
            f"C{c.cycle}: {c.hypothesis[:50]}" for c in cycles
        )
        system = (
            "你是一位顶级哲学评论家。"
            "你正在为一场跨多 cycle 的自主辩论撰写终评。"
            "要求：800 字以内，分四节 — \n"
            "1) 核心洞见演化轨迹（如何从 cycle 1 推进到最后）\n"
            "2) 不可调和的核心分歧（不同流派的根本冲突）\n"
            "3) 被这场对话揭示的盲区或新问题（每位 persona 都没看到的）\n"
            "4) 给读者的实操启示（不要空话）\n"
            "中文输出，禁用套话。"
        )
        user = (
            f"原始议题：{seed_hypothesis}\n\n"
            f"假设演化链：{chain_block}\n\n"
            f"各 cycle 综合：\n{cycles_block}"
        )
        try:
            return await backend.complete(
                system_prompt=system,
                messages=[{"role": "user", "content": user}],
                max_tokens=1800,
                temperature=0.4,
            )
        except Exception as e:
            logger.error(f"meta synthesis failed: {e}")
            return f"[元综合失败：{e}]"

    # ─── Philosophical Mode: Debate-Only Cycle ───────────────────

    async def _run_philosophical_cycle(
        self,
        cycle_num: int,
        question: str,
        seed_question: str,
        chain: list[str],
        adversarial: bool = False,
        extract_stances: bool = False,
        flip_stance: bool = False,
        subq_decomposition: bool = False,
        self_reflection: bool = False,
        subdomain_routing: bool = False,
        judge_verdict: bool = False,
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
        # Build context from previous rounds (language-aware for bilingual sweep)
        import os as _os_lang
        _lang = _os_lang.environ.get("WHATIF_LANGUAGE", "zh").lower()
        history_context = ""
        if len(chain) > 1:
            prev = chain[:-1]
            if _lang == "en":
                history_context = (
                    "Earlier rounds of this conversation have explored:\n"
                    + "\n".join(f"  {i+1}. {q}" for i, q in enumerate(prev))
                    + "\n\nPlease build on this rather than repeat prior points.\n\n"
                )
            else:
                history_context = (
                    "此前的对话已经探讨了以下问题：\n"
                    + "\n".join(f"  {i+1}. {q}" for i, q in enumerate(prev))
                    + "\n\n请在此基础上深入，避免重复已有观点。\n\n"
                )

        # ── Method A: subquestion decomposition path ──
        # Decompose → debate each subq → master-synthesize. Replaces the
        # normal single-question cycle when subq_decomposition is on.
        if subq_decomposition:
            async for ev in self._run_cycle_with_subqs(
                cycle_num, question, seed_question, history_context,
                adversarial=adversarial,
                self_reflection=self_reflection,
                subdomain_routing=subdomain_routing,
            ):
                yield ev
            return

        # Phase 1: First 4 personas respond (or all 5 if not adversarial)
        all_responses: list[dict] = []
        # Honor Y5 negative-control shuffle if active for this run.
        active = getattr(self, "_active_personas", None) or PHILOSOPHICAL_PERSONAS
        personas_to_run = active[:4] if adversarial else active

        for idx, persona in enumerate(personas_to_run):
            # Smart pairing: pick provider best-suited for this persona's
            # tradition. Falls back to round-robin if pool doesn't have it.
            backend = _smart_persona_backend(self.tracker, persona["id"], idx)
            model_name = backend.backend_name()
            # Tag tracker so this persona's calls are attributed correctly.
            self.tracker.set_context(
                phase=f"cycle_{cycle_num}_debate",
                persona=persona["id"],
            )

            yield sse_event("phil_persona_start", {
                "cycle": cycle_num,
                "persona_id": persona["id"],
                "persona_name": persona["name"],
                "persona_role": persona["role"],
                "model": model_name,
                "is_adversarial": False,
            })

            flip_directive = ""
            if flip_stance and cycle_num >= 2:
                flip_directive = (
                    "\n\n⚡ **立场反转模式**（本轮强制）：\n"
                    "你必须**论证与你的哲学传统通常持有立场相反的观点**。例如：\n"
                    "  - 理性主义者要论证'直觉与情感优先于逻辑'\n"
                    "  - 存在主义者要论证'本质先于存在、意义被预定'\n"
                    "  - 实用主义者要论证'纯粹真理高于实用效果'\n"
                    "  - 东方哲学家要论证'分析与对立优于整体调和'\n"
                    "  - 批判理论家要论证'既有结构合理且应保留'\n"
                    "目的不是戏谑反对，而是**找出反方立场里真正合理的部分**，"
                    "证明你能跳出自身传统的认知边界。这是检验思想韧性的方式。\n"
                )
            if _lang == "en":
                user_prompt = (
                    f"{history_context}"
                    f"Question: {question}\n\n"
                    f"From the philosophical stance of your tradition, give your analysis and position on this question. "
                    f"If you have fundamental disagreement with other traditions, name the point of disagreement explicitly. "
                    f"Respond in English throughout, regardless of the language used in the question."
                    f"{flip_directive}"
                    f"{FALSIFIABILITY_DIRECTIVE_EN}"
                )
            else:
                user_prompt = (
                    f"{history_context}"
                    f"当前问题：{question}\n\n"
                    f"请从你的哲学立场出发，对这个问题给出你的分析和立场。"
                    f"如果你与其他思想流派存在根本分歧，请明确指出分歧所在。"
                    f"{flip_directive}"
                    f"{FALSIFIABILITY_DIRECTIVE_ZH}"
                )

            full_response: list[str] = []
            # Honor user override of this persona's system prompt, if any.
            overrides = getattr(self, "_persona_overrides", {}) or {}
            effective_prompt = overrides.get(persona["id"]) or persona["system_prompt"]
            try:
                async for chunk in backend.stream(
                    system_prompt=cached_system(effective_prompt),
                    messages=[{"role": "user", "content": user_prompt}],
                    max_tokens=900,  # bumped from 600 — DeepSeek / GLM often hit ceiling
                ):
                    full_response.append(chunk)
                    yield sse_event("phil_persona_chunk", {
                        "cycle": cycle_num,
                        "persona_id": persona["id"],
                        "text": chunk,
                    })
            except Exception as e:
                logger.error(f"persona {persona['id']} ({model_name}) failed: {e}")
                full_response = [f"[模型 {model_name} 调用失败：{type(e).__name__}]"]
                yield sse_event("phil_persona_error", {
                    "cycle": cycle_num,
                    "persona_id": persona["id"],
                    "persona_name": persona["name"],
                    "model": model_name,
                    "error": str(e)[:300],
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
                "model": model_name,
                "content": content,
            })

            # ── Method B: Self-Reflection ──
            # Same model is asked to identify ONE assumption it made + ONE
            # alternative view its tradition would dismiss. Lightweight self-critique.
            if self_reflection and content and not content.startswith("[模型"):
                try:
                    refl_system = (
                        "你刚刚以一个哲学立场回答了一个问题。现在站在批判自己的角度，"
                        "用 ≤80 字识别两件事：\n"
                        "  1. 你刚才**隐含的一个未被证明的假设**（具体到一句）\n"
                        "  2. 你的传统通常会**忽视或贬低**但此处可能成立的一种反方观点\n"
                        "禁用空话，直接给两个 bullet。"
                    )
                    refl_user = f"原命题：{question}\n\n你刚才的回答：\n{content[:500]}"
                    refl_text = await backend.complete(
                        system_prompt=refl_system,
                        messages=[{"role": "user", "content": refl_user}],
                        max_tokens=300,
                        temperature=0.4,
                    )
                    yield sse_event("phil_self_reflection", {
                        "cycle": cycle_num,
                        "persona_id": persona["id"],
                        "persona_name": persona["name"],
                        "model": model_name,
                        "reflection": (refl_text or "").strip(),
                    })
                except Exception as e:
                    logger.warning(f"self-reflection failed for {persona['id']}: {e}")

        # Phase 2: Adversarial pass — devil's advocate reads all responses and attacks
        if adversarial:
            adversary = PHILOSOPHICAL_PERSONAS[4]  # critical_theorist
            backend = _smart_persona_backend(self.tracker, "adversary", 4)
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
            try:
                overrides_adv = getattr(self, "_persona_overrides", {}) or {}
                effective_adv_prompt = overrides_adv.get("adversary") or ADVERSARIAL_SYSTEM_PROMPT
                async for chunk in backend.stream(
                    system_prompt=cached_system(effective_adv_prompt),
                    messages=[{"role": "user", "content": adversarial_user}],
                    max_tokens=1500,  # adversary attacks all 4 personas — needs room
                ):
                    full_response.append(chunk)
                    yield sse_event("phil_persona_chunk", {
                        "cycle": cycle_num,
                        "persona_id": "adversary",
                        "text": chunk,
                    })
            except Exception as e:
                logger.error(f"adversary ({model_name}) failed: {e}")
                full_response = [f"[模型 {model_name} 调用失败：{type(e).__name__}]"]
                yield sse_event("phil_persona_error", {
                    "cycle": cycle_num,
                    "persona_id": "adversary",
                    "persona_name": "魔鬼代言人",
                    "model": model_name,
                    "error": str(e)[:300],
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
        self.tracker.set_context(phase=f"cycle_{cycle_num}_synthesis", persona=None)
        judge_backend = get_strong_backend(self.tracker)
        synthesis = await self._synthesize_philosophical(
            question, seed_question, all_responses, chain,
            backend=judge_backend,
        )

        yield sse_event("phil_synthesis_done", {
            "cycle": cycle_num,
            "synthesis": synthesis,
            "model": judge_backend.backend_name(),
        })

        # Judge verdict — explicit ruling on contested points (opt-in via flag).
        if judge_verdict:
            self.tracker.set_context(phase=f"cycle_{cycle_num}_judge_verdict")
            verdict_backend = get_strong_backend(self.tracker)
            try:
                verdict = await self._judge_verdict(
                    question, all_responses, synthesis, verdict_backend,
                )
                if verdict:
                    yield sse_event("phil_judge_verdict", {
                        "cycle": cycle_num,
                        "verdict": verdict,
                        "model": verdict_backend.backend_name(),
                    })
            except Exception as e:
                logger.error(f"judge_verdict failed for cycle {cycle_num}: {e}")

        # Feature 1: Extract stance matrix (epistemic divergence map).
        # Delegated to app.research.stance_extractor (R2 decoupling); Y4
        # ablation switches honored via the per-run extractor config.
        if extract_stances:
            from app.research.stance_extractor import (
                extract_stance_legacy, ExtractorConfig,
            )
            self.tracker.set_context(phase=f"cycle_{cycle_num}_stance_extraction")
            extractor_backend = get_strong_backend(self.tracker)
            extractor_dict = getattr(self, "_extractor_config_dict", None)
            extractor_cfg = ExtractorConfig(**extractor_dict) if extractor_dict else None

            # Y4 S5 cycle_2_only: when configured, skip extraction for
            # cycles other than cycle 2. The matrix is emitted once at
            # cycle 2 over only that cycle's responses.
            skip_for_filter = (
                extractor_dict is not None
                and extractor_dict.get("cycle_filter") == "cycle_2_only"
                and cycle_num != 2
            )
            if not skip_for_filter:
                stance_matrix = await extract_stance_legacy(
                    all_responses, extractor_backend,
                    question=question, config=extractor_cfg,
                )
                yield sse_event("phil_stance_matrix", {
                    "cycle": cycle_num,
                    "matrix": stance_matrix,
                })

    # ─── Method A: Subquestion decomposition path ──────────────────

    # Domain → preferred provider. Used by Method C (subdomain_routing).
    SUBDOMAIN_TO_PROVIDER = {
        "economics":    "openai",
        "geopolitics":  "glm",
        "ethics":       "deepseek",
        "metaphysics":  "deepseek",
        "psychology":   "claude",
        "technology":   "openai",
        "history":      "deepseek",
        "sociology":    "glm",
        "general":      None,  # fall back to smart pairing
    }

    async def _decompose_question(self, question: str) -> list[dict]:
        """Lead model breaks the question into 2-4 orthogonal sub-questions.
        Returns [{title, question, domain}, ...] — domain used for Method C routing."""
        import json as _json, re as _re
        from app.core.inference import get_judge_backend
        backend = get_judge_backend(self.tracker)
        system = (
            "你是一位议题分解专家。把一个哲学问题拆成 2-4 个**正交的**子问题，"
            "确保每个子问题独立、可单独回答，且合起来覆盖原问题的关键维度。\n\n"
            "每个子问题标注一个 domain（economics / geopolitics / ethics / "
            "metaphysics / psychology / technology / history / sociology / general）—— "
            "这会用于路由到最匹配的 provider。\n\n"
            "严格输出 JSON：{sub_questions: [{title: ≤20字, question: 完整问句, "
            "domain: 上述枚举之一}, ...]}\n"
            "禁用空话，仅输出 JSON。"
        )
        try:
            raw = await backend.complete(
                system_prompt=system,
                messages=[{"role": "user", "content": f"原问题：{question}"}],
                max_tokens=700, temperature=0.3,
            )
        except Exception as e:
            logger.error(f"subq decompose backend error: {e}")
            return [{"title": question[:20], "question": question, "domain": "general"}]
        raw = _re.sub(r"```(?:json)?\s*", "", raw or "")
        raw = _re.sub(r"```\s*$", "", raw)
        m = _re.search(r"\{.*\}", raw, _re.DOTALL)
        if not m:
            return [{"title": question[:20], "question": question, "domain": "general"}]
        try:
            parsed = _json.loads(m.group(0))
        except _json.JSONDecodeError:
            return [{"title": question[:20], "question": question, "domain": "general"}]
        valid_domains = set(self.SUBDOMAIN_TO_PROVIDER.keys())
        out = []
        for sq in (parsed.get("sub_questions") or [])[:4]:
            if not isinstance(sq, dict):
                continue
            domain = str(sq.get("domain", "general"))
            if domain not in valid_domains:
                domain = "general"
            out.append({
                "title": str(sq.get("title", ""))[:50],
                "question": str(sq.get("question", ""))[:300],
                "domain": domain,
            })
        if not out:
            out = [{"title": question[:20], "question": question, "domain": "general"}]
        return out

    def _backend_for_subq(self, persona: dict, persona_idx: int, subq_domain: str, subdomain_routing: bool):
        """Method C: when subdomain_routing is on, override smart pairing
        based on the sub-question's domain. Otherwise fall back to smart pairing."""
        from app.core.inference import get_backend_from_spec
        if subdomain_routing:
            preferred = self.SUBDOMAIN_TO_PROVIDER.get(subq_domain)
            if preferred:
                pool_str = getattr(get_settings(), "persona_pool", "")
                for spec in (pool_str or "").split(","):
                    spec = spec.strip()
                    if spec.startswith(f"{preferred}:"):
                        return get_backend_from_spec(spec, self.tracker, tier="persona")
        return _smart_persona_backend(self.tracker, persona["id"], persona_idx)

    async def _master_synth_subqs(
        self, original_question: str,
        subq_results: list[dict],
    ) -> str:
        """Take all sub-question syntheses and produce a master answer to the
        original question. Uses judge tier."""
        from app.core.inference import get_judge_backend
        backend = get_judge_backend(self.tracker)
        body = "\n\n".join(
            f"### 子问题 {i+1}（{r['subq']['domain']}）：{r['subq']['title']}\n"
            f"**问**：{r['subq']['question']}\n"
            f"**子综合**：{r['synthesis'][:500]}"
            for i, r in enumerate(subq_results)
        )
        system = (
            "你是一位跨学科调停者。任务：把若干子问题的辩论综合**汇回**原问题。\n"
            "要求 ≤500 字 分三段：\n"
            "1) 各子问题给出的最重要洞见（每个一句）\n"
            "2) 子问题之间相互**支持**或**冲突**的地方\n"
            "3) 对原问题的统一回答 —— 不是简单拼接，而是显式说明"
            "哪些子问题构成主要论据、哪些是次要修正\n"
            "禁用空话。"
        )
        user = f"原问题：{original_question}\n\n各子问题辩论结果：\n{body}"
        try:
            return await backend.complete(
                system_prompt=system,
                messages=[{"role": "user", "content": user}],
                max_tokens=1200,
                temperature=0.4,
            )
        except Exception as e:
            logger.error(f"master subq synth failed: {e}")
            return f"[汇总失败：{e}]"

    async def _run_cycle_with_subqs(
        self, cycle_num: int, question: str, seed_question: str,
        history_context: str,
        adversarial: bool = False,
        self_reflection: bool = False,
        subdomain_routing: bool = False,
    ) -> AsyncGenerator[dict, None]:
        """Subquestion-decomposed cycle: lead model splits → mini-debate per
        sub-question (single round, 5 personas) → master synthesizer."""

        # Step 1: decompose
        yield sse_event("phil_subq_decompose_start", {"cycle": cycle_num})
        subqs = await self._decompose_question(question)
        yield sse_event("phil_subqs_proposed", {
            "cycle": cycle_num,
            "sub_questions": subqs,
            "subdomain_routing": subdomain_routing,
        })

        active = getattr(self, "_active_personas", None) or PHILOSOPHICAL_PERSONAS
        personas_to_run = active[:4] if adversarial else active

        # Step 2: mini-debate per sub-question
        subq_results = []
        for sq_idx, sq in enumerate(subqs):
            yield sse_event("phil_subq_start", {
                "cycle": cycle_num, "subq_idx": sq_idx,
                "title": sq["title"], "question": sq["question"], "domain": sq["domain"],
            })

            sq_responses = []
            for p_idx, persona in enumerate(personas_to_run):
                backend = self._backend_for_subq(persona, p_idx, sq["domain"], subdomain_routing)
                model_name = backend.backend_name()

                yield sse_event("phil_subq_persona_start", {
                    "cycle": cycle_num, "subq_idx": sq_idx,
                    "persona_id": persona["id"], "persona_name": persona["name"],
                    "model": model_name, "domain": sq["domain"],
                })

                user_prompt = (
                    f"{history_context}"
                    f"原命题（上下文）：{question}\n"
                    f"当前**子问题** ({sq['domain']}): {sq['question']}\n\n"
                    f"请只针对这个子问题给出你的立场（≤200 字）。无需重述原命题。"
                    f"{FALSIFIABILITY_DIRECTIVE_ZH}"
                )
                chunks: list[str] = []
                try:
                    overrides_sq = getattr(self, "_persona_overrides", {}) or {}
                    effective_sq_prompt = overrides_sq.get(persona["id"]) or persona["system_prompt"]
                    async for c in backend.stream(
                        system_prompt=cached_system(effective_sq_prompt),
                        messages=[{"role": "user", "content": user_prompt}],
                        max_tokens=400,
                    ):
                        chunks.append(c)
                        yield sse_event("phil_subq_persona_chunk", {
                            "cycle": cycle_num, "subq_idx": sq_idx,
                            "persona_id": persona["id"], "text": c,
                        })
                except Exception as e:
                    logger.error(f"subq {sq_idx} persona {persona['id']} ({model_name}) failed: {e}")
                    chunks = [f"[模型 {model_name} 调用失败：{type(e).__name__}]"]

                content = "".join(chunks)
                sq_responses.append({
                    "persona_id": persona["id"],
                    "persona_name": persona["name"],
                    "model": model_name,
                    "content": content,
                })
                yield sse_event("phil_subq_persona_complete", {
                    "cycle": cycle_num, "subq_idx": sq_idx,
                    "persona_id": persona["id"], "persona_name": persona["name"],
                    "model": model_name, "content": content,
                })

                # Method B chains in here too
                if self_reflection and content and not content.startswith("[模型"):
                    try:
                        refl_system = (
                            "你刚刚以一个哲学立场回答了一个子问题。用 ≤80 字识别：\n"
                            "  1. 你刚才的**一个隐含假设**\n"
                            "  2. 你的传统通常会忽视的**一种反方观点**\n"
                            "禁用空话，直接给两个 bullet。"
                        )
                        refl_text = await backend.complete(
                            system_prompt=refl_system,
                            messages=[{"role": "user", "content": f"子问题：{sq['question']}\n\n你的回答：\n{content[:400]}"}],
                            max_tokens=300, temperature=0.4,
                        )
                        yield sse_event("phil_subq_self_reflection", {
                            "cycle": cycle_num, "subq_idx": sq_idx,
                            "persona_id": persona["id"],
                            "reflection": (refl_text or "").strip(),
                        })
                    except Exception as e:
                        logger.warning(f"subq self-reflection failed: {e}")

            # Synthesize this sub-question
            sub_synth = await self._synthesize_philosophical(
                sq["question"], seed_question, sq_responses, chain=[seed_question],
                backend=None,
            )
            subq_results.append({"subq": sq, "synthesis": sub_synth, "responses": sq_responses})
            yield sse_event("phil_subq_synth_done", {
                "cycle": cycle_num, "subq_idx": sq_idx,
                "synthesis": sub_synth,
            })

        # Step 3: master synthesis back to original question
        yield sse_event("phil_subq_master_start", {"cycle": cycle_num})
        master = await self._master_synth_subqs(question, subq_results)
        # Emit as the cycle's main synthesis so next-hypothesis extraction picks it up
        yield sse_event("phil_synthesis_done", {
            "cycle": cycle_num,
            "synthesis": master,
            "model": "judge-master-synth",
            "is_subq_master": True,
            "sub_question_count": len(subqs),
        })

    async def _judge_verdict(
        self,
        question: str,
        responses: list[dict],
        synthesis: str,
        backend,
    ) -> dict | None:
        """Render explicit verdicts on the contested points in this debate.

        Returns the parsed verdict dict, or None on parse failure.
        Caller decides whether to emit it as an SSE event.
        """
        import json as _json
        import re as _re
        persona_texts = "\n\n".join(
            f"【{r.get('persona_name','?')} ({r.get('persona_id','?')})】\n{r.get('content','')}"
            for r in responses
        )
        user = (
            f"问题: {question}\n\n"
            f"各思想家立场:\n{persona_texts}\n\n"
            f"综合摘要（参考）:\n{synthesis}\n\n"
            f"请按 schema 输出 JSON 裁决。"
        )
        try:
            raw = await backend.complete(
                system_prompt=JUDGE_VERDICT_SYSTEM,
                messages=[{"role": "user", "content": user}],
                max_tokens=1500,
                temperature=0.3,
            )
        except Exception as e:
            logger.error(f"_judge_verdict backend error: {e}")
            return None
        # Strip code fences, take first {...} block
        raw = _re.sub(r"```(?:json)?\s*", "", raw or "")
        raw = _re.sub(r"```\s*$", "", raw)
        m = _re.search(r"\{.*\}", raw, _re.DOTALL)
        if not m:
            return None
        try:
            parsed = _json.loads(m.group(0))
        except _json.JSONDecodeError as e:
            logger.warning(f"_judge_verdict JSON parse failed: {e}")
            return None
        if not isinstance(parsed, dict) or "verdicts" not in parsed:
            return None
        return parsed

    async def _synthesize_philosophical(
        self,
        question: str,
        seed_question: str,
        responses: list[dict],
        chain: list[str],
        backend=None,
    ) -> str:
        """Synthesize 5 philosophical perspectives into a coherent analysis."""
        import os as _os_lang
        _lang = _os_lang.environ.get("WHATIF_LANGUAGE", "zh").lower()
        if _lang == "en":
            system = (
                "You are an interdisciplinary philosophical mediator. From the five "
                "philosophical-tradition responses below, your task is to:\n"
                "1. Identify the genuine consensus across positions (not surface-level smoothing).\n"
                "2. Name the irreducible core disagreements.\n"
                "3. Surface each position's hidden premises and blind spots.\n"
                "4. Highlight the deepest insights that emerged in the dialogue.\n\n"
                "Respond in English, ~400 words. Be precise; avoid vague summaries."
            )
            persona_texts = "\n\n".join(
                f"[{r['persona_name']}]\n{r['content']}" for r in responses
            )
            user = (
                f"Original question: {seed_question}\n"
                f"Current focus: {question}\n\n"
                f"Five philosophical responses:\n{persona_texts}"
            )
        else:
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
            if backend is None:
                backend = get_strong_backend(self.tracker)
            return await backend.complete(
                system, [{"role": "user", "content": user}], max_tokens=800,
            )
        except Exception as e:
            logger.error(f"Philosophical synthesis failed: {e}")
            return f"[综合失败: {e}]"

    # _extract_stance_matrix has been removed in favor of
    # app.research.stance_extractor.extract_stance() — see R2 spec.
    # Callers that produced the legacy `phil_stance_matrix` event payload
    # should call extract_stance_legacy(responses, backend, question=...)
    # which returns the same {"arguments": [...], "stances": {...}} shape.

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
        import os as _os_lang
        _lang = _os_lang.environ.get("WHATIF_LANGUAGE", "zh").lower()
        if _lang == "en":
            system = (
                "You are a philosophical-dialog moderator. Based on the synthesis of the current "
                "round, extract a sub-question worth exploring in the next round.\n"
                "Requirements:\n"
                "1. The new question must differ from prior ones (check the explored list).\n"
                "2. Focus on the deepest disagreement or most informative blind spot revealed.\n"
                "3. Make it sharper and more specific, pushing depth rather than breadth.\n"
                "4. If the conversation has fully explored core disagreements, return an empty string.\n\n"
                "Output only the question itself, with no prefix or explanation. Respond in English."
            )
            chain_text = "\n".join(f"  Round {i+1}: {h}" for i, h in enumerate(chain))
            user = (
                f"Original question: {seed}\n"
                f"Current question: {current}\n"
                f"Question chain so far:\n{chain_text}\n\n"
                f"Synthesis of the current round:\n{synthesis[:1000]}\n\n"
                f"Extract the next sub-question:"
            )
        else:
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
