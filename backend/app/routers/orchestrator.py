"""API routes for the Cross-Module Feedback Loop (Orchestrator) and Auto-Loop."""

import asyncio
import uuid

from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException, Header, Request
from app.services.orchestrator import OrchestratorService
from app.services.auto_loop import AutoLoopScheduler
from app.services.autonomous_debate import AutonomousDebateService
from app.core.streaming import create_sse_response, create_sse_response_from_bus
from app.core.sse_bus import get_registry, pipe_to_bus
from app.core.session_archiver import archive_auto_loop
from app.schemas.orchestration import FeedbackLoopConfig
from app.schemas.autonomous import AutonomousDebateConfig

router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"])

_service = OrchestratorService()
_auto_loop = AutoLoopScheduler()
_autonomous = AutonomousDebateService()


# ─── Feedback Loop Endpoints ─────────────────────────────────

@router.post("/feedback-loop")
async def run_feedback_loop(config: FeedbackLoopConfig):
    """
    Run a cross-module feedback loop. Returns SSE stream.

    The loop chains: counterfactual → causal graph → debate → refinement.
    Repeats up to max_iterations times, or until convergence is detected.
    """
    return create_sse_response(
        _service.run_feedback_loop(config)
    )


@router.get("/results/{loop_id}")
async def get_loop_result(loop_id: str):
    """Get a cached feedback loop result."""
    result = _service.get_result(loop_id)
    if not result:
        raise HTTPException(status_code=404, detail="Loop result not found")
    return result.model_dump()


# ─── Auto-Loop Endpoints ──────────────────────────────────────

class AutoLoopRequest(BaseModel):
    """Request body for autonomous exploration.

    Two modes:
      - "historical": full orchestrator pipeline (requires event_id)
      - "philosophical": debate-only loop (event_id optional)

    Options:
      - adversarial: enable devil's advocate mode (philosophical only)
      - extract_stances: extract per-persona stance matrix each cycle
      - branching: return top-3 candidate questions (not just 1)
    """
    seed_hypothesis: str
    mode: str = Field(default="historical", pattern="^(historical|philosophical)$")
    event_id: str = ""
    max_cycles: int = Field(default=5, ge=1, le=20)
    max_iterations_per_loop: int = Field(default=2, ge=1, le=5)
    time_horizon: str = "30 years"
    adversarial: bool = False
    extract_stances: bool = False
    branching: bool = False
    flip_stance: bool = False           # cycle ≥2: each persona argues against own tradition
    subq_decomposition: bool = False    # A. decompose into 2-4 sub-questions, debate each, synthesize
    self_reflection: bool = False        # B. each persona self-critiques after speaking
    subdomain_routing: bool = False      # C. route each sub-question to best-matched provider (needs A)
    judge_verdict: bool = False          # after synthesis, emit explicit verdicts on contested points
    self_contradict: bool = False        # force each persona to write strongest counter + still-hold reason
    cross_lingual: bool = False          # per-persona "think in native tradition" directive
    live_critic: bool = False            # cheap-tier critic flags logic issues after every persona statement
    fact_check: bool = False             # plausibility check on empirical claims after each persona
    future_perspective: bool = False     # each persona is its 2050 self looking back at 2026
    # User-customized persona system prompts. Map persona_id → full prompt text.
    # Missing keys fall back to the built-in defaults.
    persona_overrides: dict[str, str] | None = None


@router.post("/auto-loop")
async def run_auto_loop(req: AutoLoopRequest):
    """
    Run autonomous continuous exploration. Returns SSE stream.

    mode="historical": Chains full orchestrator feedback loops. Requires event_id.
    mode="philosophical": Pure debate loop — 5 philosophical personas argue
      the question, synthesize, extract the next sub-question, repeat.
    """
    if req.mode == "historical" and not req.event_id:
        raise HTTPException(400, "historical mode requires event_id")

    # Pre-allocate session_id + bus so the cycle keeps running even if the
    # client disconnects. Client can reconnect via /auto-loop/{sid}/resume
    # with a Last-Event-ID header to pick up where it dropped off.
    session_id = str(uuid.uuid4())[:8]
    registry = get_registry()
    bus = registry.create(session_id)
    # Janitor: every new session is a good moment to GC idle ones.
    registry.cleanup_idle()

    source = _auto_loop.run(
        seed_hypothesis=req.seed_hypothesis,
        max_cycles=req.max_cycles,
        mode=req.mode,
        event_id=req.event_id,
        max_iterations_per_loop=req.max_iterations_per_loop,
        time_horizon=req.time_horizon,
        adversarial=req.adversarial,
        extract_stances=req.extract_stances,
        branching=req.branching,
        flip_stance=req.flip_stance,
        subq_decomposition=req.subq_decomposition,
        self_reflection=req.self_reflection,
        subdomain_routing=req.subdomain_routing,
        judge_verdict=req.judge_verdict,
        persona_overrides=req.persona_overrides,
        session_id=session_id,
        self_contradict=req.self_contradict,
        cross_lingual=req.cross_lingual,
        live_critic=req.live_critic,
        fact_check=req.fact_check,
        future_perspective=req.future_perspective,
    )
    # Background task drains generator into the bus; survives HTTP disconnect.
    # `archive_auto_loop` persists the full session to SQLite on completion.
    asyncio.create_task(pipe_to_bus(source, bus, on_complete=archive_auto_loop))

    return create_sse_response_from_bus(bus, from_id=0)


@router.get("/auto-loop/{session_id}/resume")
async def resume_auto_loop(
    session_id: str,
    last_event_id: int = 0,
    last_event_id_header: str | None = Header(None, alias="Last-Event-ID"),
):
    """Resume streaming an in-progress (or recently-finished) auto-loop session.

    The client passes its last received event id either via the
    ``Last-Event-ID`` header (standard SSE) or the ``last_event_id`` query
    param (browsers often strip custom headers from EventSource reconnects).
    Replays buffered events with id > from_id, then tails live events
    until the cycle completes."""
    bus = get_registry().get(session_id)
    if bus is None:
        raise HTTPException(404, f"session {session_id} not found (may have been GC'd)")
    # Header takes precedence if present and parseable.
    from_id = last_event_id
    if last_event_id_header:
        try:
            from_id = int(last_event_id_header)
        except ValueError:
            pass
    return create_sse_response_from_bus(bus, from_id=from_id)


@router.post("/auto-loop/{session_id}/cancel")
async def cancel_auto_loop(session_id: str):
    """Cancel a running auto-loop session."""
    AutoLoopScheduler.cancel(session_id)
    return {"status": "cancellation_requested", "session_id": session_id}


@router.get("/auto-loop/{session_id}/briefing")
async def export_auto_loop_briefing(session_id: str):
    """Render the auto-loop session as a self-contained markdown report
    that includes EVERY persona statement in full, plus per-cycle synthesis."""
    from pathlib import Path
    import json as _json
    from app.services.autonomous_debate import RUN_LOG_DIR

    p: Path = RUN_LOG_DIR / f"auto-{session_id}.jsonl"
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"No log for auto-loop session {session_id}")

    events = []
    with p.open() as f:
        for line in f:
            try:
                events.append(_json.loads(line))
            except _json.JSONDecodeError:
                continue

    seed = ""
    mode = ""
    cycles: dict[int, dict] = {}
    final_synthesis = ""
    final_meta = {}

    for ev in events:
        t, d = ev.get("type"), ev.get("data", {})
        if t == "auto_start":
            seed = d.get("seed_hypothesis", "")
            mode = d.get("mode", "")
        elif t == "cycle_start":
            cycles[d.get("cycle_num") or d.get("cycle") or 0] = {
                "cycle": d.get("cycle_num") or d.get("cycle"),
                "hypothesis": d.get("hypothesis", ""),
                "personas": [],
                "stance_matrix": None,
                "synthesis": "",
                "next_hypothesis": "",
                "errors": [],
            }
        elif t == "phil_persona_complete":
            cycle_num = d.get("cycle")
            c = cycles.setdefault(cycle_num, {"cycle": cycle_num, "personas": []})
            c.setdefault("personas", []).append({
                "id": d.get("persona_id"),
                "name": d.get("persona_name"),
                "model": d.get("model", ""),
                "content": d.get("content", ""),
            })
        elif t == "phil_persona_error":
            c = cycles.setdefault(d.get("cycle"), {"cycle": d.get("cycle"), "personas": [], "errors": []})
            c.setdefault("errors", []).append(d)
        elif t == "phil_synthesis_done":
            c = cycles.setdefault(d.get("cycle"), {"cycle": d.get("cycle")})
            c["synthesis"] = d.get("synthesis", "")
            c["judge_model"] = d.get("model", "")
        elif t == "phil_stance_matrix":
            c = cycles.setdefault(d.get("cycle"), {"cycle": d.get("cycle")})
            c["stance_matrix"] = d.get("matrix")
        elif t == "next_hypothesis":
            c = cycles.setdefault(d.get("cycle"), {"cycle": d.get("cycle")})
            c["next_hypothesis"] = d.get("next_hypothesis", "")
        elif t == "final_synth_done":
            final_synthesis = d.get("final_synthesis", "") or final_synthesis
        elif t == "auto_complete":
            final_meta = d
            if not final_synthesis:
                final_synthesis = d.get("final_synthesis", "")

    md: list[str] = [
        f"# 自主探索 · {mode or '辩论'} 简报 · `{session_id}`",
        "",
        f"**种子假设**：{seed}",
        "",
        f"**总览**：{len(cycles)} cycle · 终止原因 `{final_meta.get('stopped_reason','?')}`",
        "",
        "---",
    ]

    for cycle_num in sorted(cycles.keys()):
        c = cycles[cycle_num]
        md.append(f"## Cycle {cycle_num}")
        md.append(f"**当轮假设**：{c.get('hypothesis', seed)}")
        md.append("")
        md.append("### 各 persona 完整发言")
        for p_ in (c.get("personas") or []):
            md.append("")
            md.append(f"#### {p_['name']}  · `{p_.get('model','?')}`")
            md.append("")
            md.append((p_.get("content") or "").strip() or "_(空)_")
        if c.get("errors"):
            md.append("")
            md.append("### ⚠ 错误")
            for e in c["errors"]:
                md.append(f"- **{e.get('persona_name','?')}** ({e.get('model','?')}): `{e.get('error','')[:200]}`")
        if c.get("synthesis"):
            md.append("")
            md.append(f"### ⚖ 综合（裁判：`{c.get('judge_model','?')}`）")
            md.append("")
            md.append(c["synthesis"])
        if c.get("stance_matrix"):
            sm = c["stance_matrix"]
            md.append("")
            md.append("### 📊 立场矩阵（认知分歧）")
            args = sm.get("arguments") or []
            md.append("")
            md.append("| Argument | " + " | ".join(sm.get("stances", {}).keys()) + " |")
            md.append("|---" + "|---" * len(sm.get("stances", {})) + "|")
            for i, arg in enumerate(args):
                row = [arg]
                for v in sm.get("stances", {}).values():
                    val = v[i] if i < len(v) else 0
                    row.append(f"{val:+.1f}")
                md.append("| " + " | ".join(row) + " |")
        if c.get("next_hypothesis"):
            md.append("")
            md.append(f"**→ 下一假设**：{c['next_hypothesis']}")
        md.append("")
        md.append("---")

    if final_synthesis:
        md.append("")
        md.append("## 🎯 最终综合")
        md.append("")
        md.append(final_synthesis)

    return {"session_id": session_id, "markdown": "\n".join(md)}


# ─── Topic utilities ──────────────────────────────────────

@router.post("/topic/critique")
async def critique_topic(body: dict):
    """Pre-flight topic review by Haiku/cheap tier. Returns 3 issues +
    a suggested rewrite + a complexity score 0–10. Costs ~$0.001 per call."""
    import json as _json, re as _re
    from app.core.inference import get_cheap_backend
    from app.services.autonomous_debate import AutonomousDebateService

    topic = (body.get("topic") or "").strip()
    if not topic:
        raise HTTPException(400, "topic required")

    backend = get_cheap_backend(_autonomous.tracker)
    system = (
        "你是一位严苛的议题预审员。任务：检查一个 what-if 议题在送进辩论引擎前是否需要修改。\n"
        "输出严格 JSON：{issues: [≤3 条 ≤25字], suggested_rewrite: 1 句优化版议题（≤60字）, "
        "complexity_score: 0-10（0=极简单，10=过度复杂应拆分）, ready_to_run: bool}\n"
        "判断维度：\n"
        "  · 是否过于宏大、变量过多？（→ 应拆分）\n"
        "  · 是否隐含了未声明的前提？（→ 应明确）\n"
        "  · 措辞是否含糊（如「成功」「快乐」等抽象词未定义）？\n"
        "不要任何额外解释，仅输出 JSON。"
    )
    try:
        raw = await backend.complete(
            system_prompt=system,
            messages=[{"role": "user", "content": f"议题：{topic}"}],
            max_tokens=400, temperature=0.3,
        )
    except Exception as e:
        raise HTTPException(500, f"critique backend error: {e}")
    # Extract JSON tolerantly
    raw = _re.sub(r"```(?:json)?\s*", "", raw or "")
    raw = _re.sub(r"```\s*$", "", raw)
    m = _re.search(r"\{.*\}", raw, _re.DOTALL)
    if not m:
        return {"issues": [], "suggested_rewrite": topic, "complexity_score": 5,
                "ready_to_run": True, "raw": raw[:200]}
    try:
        parsed = _json.loads(m.group(0))
    except _json.JSONDecodeError:
        return {"issues": [], "suggested_rewrite": topic, "complexity_score": 5,
                "ready_to_run": True, "raw": raw[:200]}
    return {
        "issues": [str(x)[:60] for x in (parsed.get("issues") or [])][:5],
        "suggested_rewrite": str(parsed.get("suggested_rewrite", topic))[:200],
        "complexity_score": max(0, min(10, int(parsed.get("complexity_score", 5) or 5))),
        "ready_to_run": bool(parsed.get("ready_to_run", True)),
    }


@router.post("/topic/decompose")
async def decompose_topic(body: dict):
    """Break a multi-variable topic into focused sub-topics. Uses judge tier
    (Sonnet/DeepSeek) since the decomposition matters."""
    import json as _json, re as _re
    from app.core.inference import get_judge_backend
    from app.services.autonomous_debate import AutonomousDebateService

    topic = (body.get("topic") or "").strip()
    if not topic:
        raise HTTPException(400, "topic required")

    backend = get_judge_backend(_autonomous.tracker)
    system = (
        "你是一位议题拆解专家。如果用户提的议题包含多个独立变量（例如同时假设 A、B、C），"
        "把它拆解成 2-4 个**独立可单跑**的子议题，每个聚焦一个变量。"
        "如果议题已足够单一，sub_topics 返回原议题（即只有一个元素）。\n\n"
        "输出严格 JSON：{is_compound: bool, reasoning: ≤50字, "
        "sub_topics: [{title: ≤30字, hypothesis: 完整假设句}, ...]}\n"
        "拆解时保持中文简洁，不要拼凑。仅输出 JSON。"
    )
    try:
        raw = await backend.complete(
            system_prompt=system,
            messages=[{"role": "user", "content": f"议题：{topic}"}],
            max_tokens=900, temperature=0.3,
        )
    except Exception as e:
        raise HTTPException(500, f"decompose backend error: {e}")
    raw = _re.sub(r"```(?:json)?\s*", "", raw or "")
    raw = _re.sub(r"```\s*$", "", raw)
    m = _re.search(r"\{.*\}", raw, _re.DOTALL)
    if not m:
        return {"is_compound": False, "reasoning": "解析失败",
                "sub_topics": [{"title": topic[:30], "hypothesis": topic}]}
    try:
        parsed = _json.loads(m.group(0))
    except _json.JSONDecodeError:
        return {"is_compound": False, "reasoning": "JSON 错误",
                "sub_topics": [{"title": topic[:30], "hypothesis": topic}]}
    subs = []
    for s in (parsed.get("sub_topics") or [])[:4]:
        if isinstance(s, dict):
            subs.append({
                "title": str(s.get("title", ""))[:50],
                "hypothesis": str(s.get("hypothesis", ""))[:300],
            })
    if not subs:
        subs = [{"title": topic[:30], "hypothesis": topic}]
    return {
        "is_compound": bool(parsed.get("is_compound", False)),
        "reasoning": str(parsed.get("reasoning", ""))[:120],
        "sub_topics": subs,
    }


@router.get("/personas")
async def list_personas():
    """Return the built-in philosophical persona registry — id, name, role,
    and the default system prompt. The UI uses this to populate a per-user
    editor; edits are sent back as `persona_overrides` on auto-loop start."""
    from app.services.auto_loop import PHILOSOPHICAL_PERSONAS, ADVERSARIAL_SYSTEM_PROMPT
    items = [
        {
            "id": p["id"],
            "name": p["name"],
            "role": p["role"],
            "system_prompt": p["system_prompt"],
        }
        for p in PHILOSOPHICAL_PERSONAS
    ]
    items.append({
        "id": "adversary",
        "name": "魔鬼代言人",
        "role": "对抗性分析",
        "system_prompt": ADVERSARIAL_SYSTEM_PROMPT,
    })
    return {"personas": items}


@router.post("/topic/analogies")
async def find_analogies(body: dict):
    """Find 3-5 structurally analogous historical / cross-domain cases for a
    given hypothesis. The user can pick one to inject as additional debate
    context — activates the LLM's analogical-reasoning capacity that's
    otherwise dormant on novel questions.
    """
    import json as _json, re as _re
    from app.core.inference import get_judge_backend

    topic = (body.get("topic") or "").strip()
    if not topic:
        raise HTTPException(400, "topic required")

    backend = get_judge_backend(_autonomous.tracker)
    system = (
        "你是一位类比推理专家。给定一个 what-if 议题，找出 3-5 个**结构同构**的"
        "历史 / 跨领域案例 —— 表面话题不同，但底层动力学相似（相同的利益冲突结构、"
        "相同的协调失败模式、相同的技术-制度时差等）。\n\n"
        "目标是激活类比推理：辩论中可以借鉴这些先例的经验教训，而不是从零思考。\n\n"
        "严格输出 JSON：\n"
        "{\n"
        "  \"analogies\": [\n"
        "    {\n"
        "      \"title\": \"≤25 字的案例名（如『美国 1880s 反托拉斯立法』）\",\n"
        "      \"era\": \"时代 / 领域，≤15 字\",\n"
        "      \"why_analogous\": \"为什么这是结构同构（≤60 字，指明共享的底层动力学）\",\n"
        "      \"key_lesson\": \"≤50 字的关键教训\",\n"
        "      \"key_difference\": \"≤40 字的重要不同（避免错误外推）\"\n"
        "    }\n"
        "  ]\n"
        "}\n"
        "至少 3 个、至多 5 个。选取要多样化（不同时代 / 不同领域），避免全都来自同一时期。"
        "只输出 JSON，不要 markdown。"
    )
    try:
        raw = await backend.complete(
            system_prompt=system,
            messages=[{"role": "user", "content": f"议题：{topic}"}],
            max_tokens=1500, temperature=0.6,
        )
    except Exception as e:
        raise HTTPException(500, f"analogies backend error: {e}")
    raw = _re.sub(r"```(?:json)?\s*", "", raw or "")
    raw = _re.sub(r"```\s*$", "", raw)
    m = _re.search(r"\{.*\}", raw, _re.DOTALL)
    if not m:
        return {"analogies": []}
    try:
        parsed = _json.loads(m.group(0))
    except _json.JSONDecodeError:
        return {"analogies": []}
    out = []
    for a in (parsed.get("analogies") or [])[:5]:
        if not isinstance(a, dict):
            continue
        out.append({
            "title": str(a.get("title", ""))[:80],
            "era": str(a.get("era", ""))[:30],
            "why_analogous": str(a.get("why_analogous", ""))[:200],
            "key_lesson": str(a.get("key_lesson", ""))[:200],
            "key_difference": str(a.get("key_difference", ""))[:200],
        })
    return {"analogies": out}


CLASSROOM_GRADE_SYSTEM = (
    "你是一位哲学课的助教。学生需要扮演某个哲学传统对一个议题作出论证；"
    "你的任务是把**学生的论证**跟**该传统的 LLM 范本论证**对比，给出建设性反馈。\n\n"
    "评估时要做到：\n"
    "- 不评学生「立场对错」（哲学没有标准答案），只评 (a) 是否真正运用了该传统的"
    "**思维方式 / 核心概念**，(b) 论证是否**结构清晰**，(c) 是否考虑到该传统会想到的"
    "**反对意见 / 反例**。\n"
    "- 给出学生**做对了什么**（具体引用）、**漏掉了什么**（具体指出该传统会问什么）、"
    "**逻辑断点**（论证里的明显跳跃）。\n"
    "- 总分 1-10：1=完全没抓住传统，5=结构清晰但缺乏传统特色，10=接近一个深谙该传统的研究生。\n\n"
    "严格输出 JSON：\n"
    "{\n"
    "  \"score\": 1-10,\n"
    "  \"got_right\": [\"≤ 50 字的具体优点\", ...],\n"
    "  \"missed\": [\"≤ 50 字的具体缺失，例如『未考虑该传统的核心概念 X』\", ...],\n"
    "  \"gaps\": [\"≤ 50 字的逻辑断点\", ...],\n"
    "  \"summary\": \"≤ 100 字的总评：学生最需要改进的一个方向\"\n"
    "}\n"
    "至少 1、至多 4 项每数组。只输出 JSON。"
)


@router.post("/persona/classroom_grade")
async def classroom_grade(body: dict):
    """Classroom mode: student writes argument from a persona's perspective,
    LLM produces its own version, then a grader LLM provides constructive
    feedback on what the student captured / missed / had logical gaps in.

    Body: {persona_id, question, student_argument, model_spec?}
    """
    import asyncio as _asyncio
    import json as _json
    import re as _re
    import time as _time

    from app.core.inference import get_strong_backend, get_backend_from_spec
    from app.services.auto_loop import (
        PHILOSOPHICAL_PERSONAS, ADVERSARIAL_SYSTEM_PROMPT,
    )

    persona_id = (body.get("persona_id") or "").strip()
    question = (body.get("question") or "").strip()
    student_argument = (body.get("student_argument") or "").strip()
    model_spec = (body.get("model_spec") or "claude:claude-sonnet-4-6").strip()

    if not persona_id or not question or not student_argument:
        raise HTTPException(400, "persona_id, question, student_argument all required")
    if len(student_argument) < 40:
        raise HTTPException(400, "student_argument too short — needs at least 40 chars for meaningful grading")

    persona = next((p for p in PHILOSOPHICAL_PERSONAS if p["id"] == persona_id), None)
    if persona is None and persona_id == "adversary":
        persona = {"id": "adversary", "name": "魔鬼代言人",
                   "system_prompt": ADVERSARIAL_SYSTEM_PROMPT}
    if persona is None:
        raise HTTPException(404, f"unknown persona_id: {persona_id}")

    user_prompt = (
        f"问题：{question}\n\n"
        f"请从你的哲学立场出发，对这个问题给出你的分析和立场（300 字以内）。"
    )

    async def _run_llm() -> tuple[str, float, str | None]:
        t0 = _time.perf_counter()
        try:
            backend = get_backend_from_spec(model_spec, _auto_loop.tracker, tier="persona")
            content = await backend.complete(
                system_prompt=persona["system_prompt"],
                messages=[{"role": "user", "content": user_prompt}],
                max_tokens=700, temperature=0.7,
            )
            return content, (_time.perf_counter() - t0) * 1000, None
        except Exception as e:
            return "", (_time.perf_counter() - t0) * 1000, f"{type(e).__name__}: {str(e)[:200]}"

    llm_content, llm_latency, llm_err = await _run_llm()
    if llm_err:
        raise HTTPException(500, f"persona LLM failed: {llm_err}")

    # Grader
    grader = get_strong_backend(_auto_loop.tracker)
    grade_user = (
        f"问题：{question}\n\n"
        f"该传统/persona: {persona['name']} ({persona_id})\n\n"
        f"--- 学生论证 ---\n{student_argument}\n\n"
        f"--- 该传统的 LLM 范本 ---\n{llm_content}\n\n"
        f"请按 schema 输出 JSON 评估。"
    )
    try:
        raw = await grader.complete(
            system_prompt=CLASSROOM_GRADE_SYSTEM,
            messages=[{"role": "user", "content": grade_user}],
            max_tokens=900, temperature=0.3,
        )
        raw = _re.sub(r"```(?:json)?\s*", "", raw or "")
        raw = _re.sub(r"```\s*$", "", raw)
        m = _re.search(r"\{.*\}", raw, _re.DOTALL)
        feedback = _json.loads(m.group(0)) if m else None
    except Exception as e:
        feedback = {"score": 0, "summary": f"grader failed: {type(e).__name__}",
                    "got_right": [], "missed": [], "gaps": []}

    return {
        "persona_id": persona_id,
        "persona_name": persona["name"],
        "question": question,
        "student_argument": student_argument,
        "llm_argument": llm_content,
        "llm_latency_ms": round(llm_latency, 1),
        "feedback": feedback,
    }


AB_COMPARE_SYSTEM = (
    "你是一位 prompt 工程评估员。两段文本是同一个 persona 用**两个不同 system "
    "prompt 版本** (A 和 B) 回答**同一个问题**的结果。你的任务是评估哪个 prompt "
    "版本产出更高质量的哲学论证。\n\n"
    "评分维度（每个 1-5 分）：\n"
    "- depth：论证深度，是否深入到核心机制\n"
    "- clarity：表达清晰度，论证结构是否易于追踪\n"
    "- specificity：具体性，是否提供具体例子和细节而非泛泛\n"
    "- philosophical_integrity：哲学完整性，是否真正运用 persona 的传统而非套话\n"
    "- falsifiability：是否给出可证伪线 / 反方论证 / 让步\n\n"
    "判定整体胜方：\"A\" / \"B\" / \"tie\"\n\n"
    "严格输出 JSON：\n"
    "{\n"
    "  \"winner\": \"A|B|tie\",\n"
    "  \"reason\": \"≤ 80 字：A 比 B 强 / 弱在哪里\",\n"
    "  \"scores\": {\n"
    "    \"a\": {\"depth\": 1-5, \"clarity\": 1-5, \"specificity\": 1-5, \"philosophical_integrity\": 1-5, \"falsifiability\": 1-5},\n"
    "    \"b\": {\"depth\": 1-5, \"clarity\": 1-5, \"specificity\": 1-5, \"philosophical_integrity\": 1-5, \"falsifiability\": 1-5}\n"
    "  }\n"
    "}\n"
    "只输出 JSON。"
)


@router.post("/persona/ab_test")
async def ab_test_persona_prompt(body: dict):
    """A/B test two persona prompt versions against the same question.

    Runs both prompts in parallel through the same model, then a strong-tier
    comparator scores them on 5 dimensions and picks an overall winner.

    Body: {persona_id, question, prompt_a, prompt_b, model_spec?}
    """
    import asyncio as _asyncio
    import json as _json
    import re as _re
    import time as _time

    from app.core.inference import get_strong_backend, get_backend_from_spec
    from app.services.auto_loop import (
        PHILOSOPHICAL_PERSONAS, ADVERSARIAL_SYSTEM_PROMPT,
        FALSIFIABILITY_DIRECTIVE_ZH,
    )

    persona_id = (body.get("persona_id") or "").strip()
    question = (body.get("question") or "").strip()
    prompt_a = (body.get("prompt_a") or "").strip()
    prompt_b = (body.get("prompt_b") or "").strip()
    model_spec = (body.get("model_spec") or "claude:claude-sonnet-4-6").strip()

    if not persona_id or not question or not prompt_a or not prompt_b:
        raise HTTPException(400, "persona_id, question, prompt_a, prompt_b all required")
    if prompt_a == prompt_b:
        raise HTTPException(400, "prompt_a and prompt_b are identical — pick a real comparison")

    user_prompt = (
        f"问题：{question}\n\n"
        f"请从你的哲学立场出发，对这个问题给出你的分析和立场。"
        f"{FALSIFIABILITY_DIRECTIVE_ZH}"
    )

    async def _run_variant(system_prompt: str, label: str) -> dict:
        t0 = _time.perf_counter()
        try:
            backend = get_backend_from_spec(model_spec, _auto_loop.tracker, tier="persona")
            content = await backend.complete(
                system_prompt=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
                max_tokens=900, temperature=0.7,
            )
            return {
                "label": label,
                "content": content,
                "latency_ms": round((_time.perf_counter() - t0) * 1000, 1),
                "error": None,
            }
        except Exception as e:
            return {
                "label": label,
                "content": "",
                "latency_ms": round((_time.perf_counter() - t0) * 1000, 1),
                "error": f"{type(e).__name__}: {str(e)[:200]}",
            }

    a_result, b_result = await _asyncio.gather(
        _run_variant(prompt_a, "A"),
        _run_variant(prompt_b, "B"),
    )

    # Comparator only runs if both variants produced content
    comparison: dict | None = None
    if not a_result["error"] and not b_result["error"]:
        try:
            comparator = get_strong_backend(_auto_loop.tracker)
            persona_name = next(
                (p["name"] for p in PHILOSOPHICAL_PERSONAS if p["id"] == persona_id),
                persona_id,
            )
            compare_user = (
                f"问题：{question}\n\n"
                f"Persona: {persona_name} ({persona_id})\n\n"
                f"=== Prompt A ===\n{prompt_a[:600]}\n\n"
                f"--- A 的回答 ---\n{a_result['content']}\n\n"
                f"=== Prompt B ===\n{prompt_b[:600]}\n\n"
                f"--- B 的回答 ---\n{b_result['content']}\n\n"
                f"请按 schema 输出 JSON 评估。"
            )
            raw = await comparator.complete(
                system_prompt=AB_COMPARE_SYSTEM,
                messages=[{"role": "user", "content": compare_user}],
                max_tokens=800, temperature=0.2,
            )
            raw = _re.sub(r"```(?:json)?\s*", "", raw or "")
            raw = _re.sub(r"```\s*$", "", raw)
            m = _re.search(r"\{.*\}", raw, _re.DOTALL)
            if m:
                comparison = _json.loads(m.group(0))
        except Exception as e:
            comparison = {"winner": "tie", "reason": f"comparator failed: {type(e).__name__}", "scores": None}

    return {
        "persona_id": persona_id,
        "question": question,
        "model_spec": model_spec,
        "a": a_result,
        "b": b_result,
        "comparison": comparison,
    }


@router.post("/persona/followup")
async def followup_persona(body: dict):
    """Socratic follow-up: ask a specific persona a follow-up question that
    references its prior statement. The persona stays in character and
    responds to the user's question directly.

    Body: {persona_id, question (cycle hypothesis), persona_statement,
           followup, model_spec? }
    """
    import time as _time
    from app.services.auto_loop import PHILOSOPHICAL_PERSONAS, ADVERSARIAL_SYSTEM_PROMPT
    from app.core.inference import get_backend_from_spec

    persona_id = (body.get("persona_id") or "").strip()
    question = (body.get("question") or "").strip()
    persona_statement = (body.get("persona_statement") or "").strip()
    followup = (body.get("followup") or "").strip()
    model_spec = (body.get("model_spec") or "claude:claude-sonnet-4-6").strip()
    if not persona_id or not followup:
        raise HTTPException(400, "persona_id and followup required")

    persona = next((p for p in PHILOSOPHICAL_PERSONAS if p["id"] == persona_id), None)
    if persona is None and persona_id == "adversary":
        persona = {"id": "adversary", "name": "魔鬼代言人",
                   "system_prompt": ADVERSARIAL_SYSTEM_PROMPT}
    if persona is None:
        raise HTTPException(404, f"unknown persona_id: {persona_id}")

    user_prompt = (
        f"原议题：{question}\n\n"
        f"你之前的发言：\n{persona_statement}\n\n"
        f"用户对你的追问：{followup}\n\n"
        f"请保持你的哲学立场和语气，直接回应这个追问（≤200 字）。"
        f"如果追问触及你立场的真正弱点，诚实地承认而非搪塞。"
    )

    t0 = _time.perf_counter()
    try:
        backend = get_backend_from_spec(model_spec, _auto_loop.tracker, tier="persona")
        content = await backend.complete(
            system_prompt=persona["system_prompt"],
            messages=[{"role": "user", "content": user_prompt}],
            max_tokens=600, temperature=0.6,
        )
    except Exception as e:
        raise HTTPException(500, f"followup backend error: {type(e).__name__}: {str(e)[:200]}")
    return {
        "persona_id": persona_id,
        "persona_name": persona["name"],
        "followup": followup,
        "response": content,
        "latency_ms": round((_time.perf_counter() - t0) * 1000, 1),
        "model_spec": model_spec,
    }


@router.post("/persona/compare")
async def compare_persona_across_models(body: dict):
    """Run the same persona's system prompt across multiple model providers
    on the same question. Returns a dict keyed by spec → response.

    Used by the "🔀 多模型对比" button in PersonaCard: lets the user see
    how Claude / GPT-5 / DeepSeek each interpret the same persona on the
    same question, surfacing each model's internal philosophical biases.

    Body: {persona_id: str, question: str, history?: str,
           specs?: list[str]}
        specs default to ["claude:claude-sonnet-4-6", "openai:gpt-5-mini",
        "deepseek:deepseek-chat"]
    """
    import asyncio as _asyncio
    import time as _time
    from app.services.auto_loop import PHILOSOPHICAL_PERSONAS, ADVERSARIAL_SYSTEM_PROMPT
    from app.core.inference import get_backend_from_spec

    persona_id = (body.get("persona_id") or "").strip()
    question = (body.get("question") or "").strip()
    history = body.get("history") or ""
    specs = body.get("specs") or [
        "claude:claude-sonnet-4-6",
        "openai:gpt-5-mini",
        "deepseek:deepseek-chat",
    ]
    if not persona_id or not question:
        raise HTTPException(400, "persona_id and question required")

    # Resolve persona system prompt — same registry as /personas endpoint.
    persona = next((p for p in PHILOSOPHICAL_PERSONAS if p["id"] == persona_id), None)
    if persona is None and persona_id == "adversary":
        persona = {"id": "adversary", "name": "魔鬼代言人", "role": "对抗",
                   "system_prompt": ADVERSARIAL_SYSTEM_PROMPT}
    if persona is None:
        raise HTTPException(404, f"unknown persona_id: {persona_id}")

    user_prompt = (
        (f"{history}\n\n" if history else "")
        + f"问题：{question}\n\n"
        f"请从你的哲学立场出发，对这个问题给出你的分析和立场（300 字以内）。"
    )

    async def _one(spec: str) -> dict:
        t0 = _time.perf_counter()
        try:
            backend = get_backend_from_spec(spec, _auto_loop.tracker, tier="persona")
            content = await backend.complete(
                system_prompt=persona["system_prompt"],
                messages=[{"role": "user", "content": user_prompt}],
                max_tokens=800, temperature=0.7,
            )
            return {
                "spec": spec,
                "content": content,
                "latency_ms": round((_time.perf_counter() - t0) * 1000, 1),
                "error": None,
            }
        except Exception as e:
            return {
                "spec": spec,
                "content": "",
                "latency_ms": round((_time.perf_counter() - t0) * 1000, 1),
                "error": f"{type(e).__name__}: {str(e)[:200]}",
            }

    # Run all in parallel — typical wall-clock ~ slowest single provider.
    results = await _asyncio.gather(*[_one(s) for s in specs])
    return {
        "persona_id": persona_id,
        "persona_name": persona["name"],
        "question": question,
        "responses": results,
    }


@router.get("/auto-loop/_logs")
async def list_auto_loop_logs():
    """List all auto-loop session log files (newest first), with metadata."""
    from app.services.autonomous_debate import RUN_LOG_DIR
    import json as _json
    items = []
    for p in sorted(RUN_LOG_DIR.glob("auto-*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True):
        seed, mode, cycles = "", "", 0
        try:
            with p.open() as f:
                for line in f:
                    try: ev = _json.loads(line)
                    except _json.JSONDecodeError: continue
                    t = ev.get("type")
                    d = ev.get("data", {})
                    if t == "auto_start":
                        seed = d.get("seed_hypothesis", "")
                        mode = d.get("mode", "")
                    elif t == "cycle_complete":
                        cycles += 1
        except Exception:
            pass
        items.append({
            "session_id": p.stem.replace("auto-", ""),
            "seed_hypothesis": seed,
            "mode": mode,
            "cycles": cycles,
            "size_bytes": p.stat().st_size,
            "mtime": int(p.stat().st_mtime),
        })
    return {"sessions": items}


# ─── Autonomous Topic Explorer ──────────────────────────────

@router.post("/autonomous-debate")
async def run_autonomous_debate(config: AutonomousDebateConfig):
    """Run a long-running autonomous topic explorer.

    Tiered model usage: local Ollama for personas, Haiku for injection
    variants, Sonnet for branch evaluation, Opus for branch decisions and
    final meta-synthesis. Streams SSE events.
    """
    return create_sse_response(_autonomous.run(config))


@router.post("/autonomous-debate/{session_id}/cancel")
async def cancel_autonomous_debate(session_id: str):
    """Cancel a running autonomous debate session."""
    ok = _autonomous.cancel(session_id)
    return {"status": "cancellation_requested" if ok else "not_found", "session_id": session_id}


@router.get("/autonomous-debate/{session_id}/log")
async def get_autonomous_debate_log(session_id: str):
    """Return the full JSONL event log for an autonomous-debate session."""
    from pathlib import Path
    import json as _json
    from app.services.autonomous_debate import RUN_LOG_DIR
    p: Path = RUN_LOG_DIR / f"{session_id}.jsonl"
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"No log for session {session_id}")
    events = []
    with p.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(_json.loads(line))
            except _json.JSONDecodeError:
                continue
    return {"session_id": session_id, "n_events": len(events), "events": events}


@router.get("/autonomous-debate/_logs")
async def list_autonomous_debate_logs():
    """List all session-log files on disk (most recent first), with metadata."""
    from app.services.autonomous_debate import RUN_LOG_DIR
    import json as _json
    items = []
    for p in sorted(RUN_LOG_DIR.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True):
        topic, branches, cost = "", 0, 0.0
        try:
            with p.open() as f:
                for line in f:
                    try:
                        ev = _json.loads(line)
                    except _json.JSONDecodeError:
                        continue
                    t = ev.get("type")
                    if t == "auto_session_start":
                        topic = ev.get("data", {}).get("config", {}).get("seed_topic", "")
                    elif t == "auto_branch_eval":
                        branches += 1
                    elif t == "auto_final_synth":
                        cost = ev.get("data", {}).get("token_usage", {}).get("estimated_cost_usd", 0.0)
        except Exception:
            pass
        items.append({
            "session_id": p.stem,
            "topic": topic,
            "branches": branches,
            "cost_usd": cost,
            "size_bytes": p.stat().st_size,
            "mtime": int(p.stat().st_mtime),
        })
    return {"sessions": items}


@router.post("/autonomous-debate/{session_id}/kill-branch")
async def kill_autonomous_branch(session_id: str, body: dict):
    """Mark a branch_id to be skipped or aborted in the running session."""
    branch_id = body.get("branch_id", "")
    ok = _autonomous.kill_branch(session_id, branch_id)
    return {"status": "ok" if ok else "not_found", "session_id": session_id, "branch_id": branch_id}


@router.post("/autonomous-debate/{session_id}/inject")
async def add_autonomous_injection(session_id: str, body: dict):
    """User-supplied injection seed for the running session's next cycle."""
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    ok = _autonomous.add_user_injection(session_id, text)
    return {"status": "ok" if ok else "not_found", "session_id": session_id, "injection": text}


@router.post("/autonomous-debate/_compare")
async def compare_autonomous_sessions(body: dict):
    """Side-by-side comparison data for N session_ids — terse summary per session
    so the frontend can render a comparison table without fetching N briefings.
    """
    from pathlib import Path
    import json as _json
    from app.services.autonomous_debate import RUN_LOG_DIR
    session_ids = body.get("session_ids") or []
    if not isinstance(session_ids, list) or not session_ids:
        raise HTTPException(status_code=400, detail="session_ids (list) required")

    out = []
    for sid in session_ids[:6]:  # cap at 6 — UI gets cramped beyond that
        p: Path = RUN_LOG_DIR / f"{sid}.jsonl"
        if not p.exists():
            out.append({"session_id": sid, "missing": True})
            continue
        topic = ""
        branches: dict[str, dict] = {}
        decisions = []
        final = ""
        cost = 0.0
        elapsed_s = 0
        try:
            with p.open() as f:
                for line in f:
                    try:
                        ev = _json.loads(line)
                    except _json.JSONDecodeError:
                        continue
                    t, d = ev.get("type"), ev.get("data", {})
                    if t == "auto_session_start":
                        topic = d.get("config", {}).get("seed_topic", "")
                    elif t == "auto_branch_eval":
                        bid = d.get("branch_id", "")
                        branches[bid] = {
                            "branch_id": bid,
                            "cycle": d.get("cycle", 0),
                            "injection": d.get("injection", ""),
                            "eval": d.get("eval"),
                        }
                    elif t == "auto_decision":
                        decisions.append({
                            "cycle": d.get("cycle", 0),
                            "action": d.get("verdict", {}).get("action", ""),
                            "confidence": d.get("verdict", {}).get("overall_confidence", 0),
                        })
                    elif t == "auto_final_synth":
                        final = d.get("text", "")
                        cost = d.get("token_usage", {}).get("estimated_cost_usd", 0.0)
                        elapsed_s = d.get("elapsed_s", 0)
        except Exception as e:
            out.append({"session_id": sid, "error": str(e)})
            continue
        # Top-3 branches by confidence
        ranked = sorted(branches.values(),
                        key=lambda b: (b.get("eval") or {}).get("confidence", 0),
                        reverse=True)[:3]
        out.append({
            "session_id": sid,
            "topic": topic,
            "branches_count": len(branches),
            "decisions_count": len(decisions),
            "cost_usd": cost,
            "elapsed_s": elapsed_s,
            "top_branches": ranked,
            "final_synthesis_preview": (final or "")[:600],
        })
    return {"sessions": out}


@router.get("/autonomous-debate/{session_id}/briefing")
async def export_autonomous_briefing(session_id: str):
    """Render the session log as a self-contained markdown briefing."""
    from pathlib import Path
    import json as _json
    from app.services.autonomous_debate import RUN_LOG_DIR

    p: Path = RUN_LOG_DIR / f"{session_id}.jsonl"
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"No log for session {session_id}")

    events = []
    with p.open() as f:
        for line in f:
            try:
                events.append(_json.loads(line))
            except _json.JSONDecodeError:
                continue

    topic, personas = "", []
    branches: dict[str, dict] = {}
    decisions = []
    final = ""
    stop_reason = ""
    cost, total_branches = 0.0, 0

    for ev in events:
        t, d = ev.get("type"), ev.get("data", {})
        if t == "auto_session_start":
            topic = d.get("config", {}).get("seed_topic", "")
            personas = d.get("personas", [])
        elif t == "auto_branch_eval":
            bid = d.get("branch_id", "")
            existing = branches.get(bid, {})
            existing.update({
                "branch_id": bid,
                "cycle": d.get("cycle", 0),
                "injection": d.get("injection", ""),
                "eval": d.get("eval"),
            })
            branches[bid] = existing
            total_branches += 1
        elif t == "persona_summary" or t == "auto_branch_summary":
            bid = d.get("branch_id", "")
            existing = branches.setdefault(bid, {"branch_id": bid, "summaries": []})
            existing.setdefault("summaries", []).append({
                "persona": d.get("persona_name", ""),
                "summary": d.get("summary", ""),
            })
        elif t == "auto_decision":
            decisions.append(d)
        elif t == "auto_final_synth":
            final = d.get("text", "")
            stop_reason = d.get("stop_reason", "")
            cost = d.get("token_usage", {}).get("estimated_cost_usd", 0.0)

    md_lines = [
        f"# 自主议题探索简报 · `{session_id}`",
        "",
        f"**议题**：{topic}",
        "",
        f"**Persona 池**：{', '.join(p.get('name', '') for p in personas)}",
        "",
        f"**总体**：{len(branches)} 分支 · {len(decisions)} 决策 · ${cost:.3f} · 终止原因 `{stop_reason}`",
        "",
        "---",
        "## ⚖ Opus 终评",
        "",
        final or "_(无)_",
        "",
        "---",
        "## ⊕ 已探索分支",
        "",
    ]
    for bid in sorted(branches.keys()):
        b = branches[bid]
        ev = b.get("eval") or {}
        md_lines.append(f"### `{bid}` — cycle {b.get('cycle', 0)}")
        md_lines.append(f"**注入**：{b.get('injection') or '(基线)'}")
        if ev:
            md_lines.append(
                f"**评分**：信心 {ev.get('confidence','?')} · 一致 {ev.get('coherence','?')} · "
                f"新颖 {ev.get('novelty','?')} · 风险 {ev.get('risk_signal','?')}"
            )
            md_lines.append(f"**核心**：{ev.get('one_line_takeaway','')}")
            if ev.get("notable_disagreement"):
                md_lines.append(f"**分歧**：{ev.get('notable_disagreement')}")
        for s in b.get("summaries", []):
            md_lines.append(f"- *{s['persona']}*：{s['summary']}")
        md_lines.append("")

    md_lines.extend(["---", "## 🧠 决策日志", ""])
    for d in decisions:
        v = d.get("verdict", {})
        md_lines.append(f"- **cycle {d.get('cycle','?')} · {v.get('action','?')}** ({v.get('overall_confidence','?')}%) — {v.get('rationale','')}")

    return {"session_id": session_id, "markdown": "\n".join(md_lines)}


@router.get("/auto-loop/{session_id}")
async def get_auto_loop_result(session_id: str):
    """Get a cached auto-loop result."""
    result = _auto_loop.get_result(session_id)
    if not result:
        raise HTTPException(status_code=404, detail="Auto-loop session not found")
    return {
        "session_id": result.session_id,
        "mode": result.mode,
        "event_id": result.event_id,
        "seed_hypothesis": result.seed_hypothesis,
        "total_cycles": result.total_cycles,
        "stopped_reason": result.stopped_reason,
        "evolution_chain": result.evolution_chain,
        "cycles": [
            {
                "cycle": c.cycle,
                "hypothesis": c.hypothesis,
                "loop_id": c.loop_id,
                "synthesis_preview": c.synthesis[:300],
                "next_hypothesis": c.next_hypothesis,
                "converged": c.converged,
            }
            for c in result.cycles
        ],
    }
