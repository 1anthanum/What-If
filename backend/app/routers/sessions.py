"""Session archive endpoints — list / search / fetch / delete persisted
auto-loop sessions.

Powered by app.core.database. Sessions land in the DB automatically when
they finish (via ``archive_auto_loop`` hooked into the SSE bus pipe).
"""

import json
import logging
import re

from fastapi import APIRouter, HTTPException, Query

from app.core.database import (
    list_sessions, get_session, session_stats, delete_session, bias_analytics,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("")
async def get_sessions(
    q: str | None = Query(None, description="Optional search query — FTS5 for ASCII, LIKE for CJK"),
    limit: int = Query(30, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """List recent sessions, newest first. Optional ?q= filters by text."""
    return {"sessions": list_sessions(q=q, limit=limit, offset=offset)}


@router.get("/_stats")
async def get_stats():
    """Cross-session aggregate stats — total sessions, avg cycles, per-persona
    dogmatic counts, etc. Used by future analytics dashboards."""
    return session_stats()


@router.get("/_bias")
async def get_bias():
    """Deeper per-persona / per-model bias aggregations: dogmatic rates,
    judge-verdict win counts, avg content length, top model per persona,
    persona × strongest/weakest counts."""
    return bias_analytics()


CONCEPT_EXTRACT_SYSTEM = (
    "你是一位概念分析师。下面是来自多个 philosophical session 的摘录。"
    "你的任务：找出**跨 session 反复出现的核心哲学概念**（例如「自由」"
    "「正义」「缘起」「公正」「效率」「主体性」），并为每个概念追踪："
    "(a) 它在不同 session 中分别被如何定义或使用，"
    "(b) 与哪些其他概念形成对照 / 关联。\n\n"
    "**重要**：\n"
    "- 只选**真正反复出现**的概念，至少在 2 个 session 中明确讨论\n"
    "- 名词或名词短语（≤ 4 字优先），不要选动词 / 形容词\n"
    "- 不要选过于具体（「AGI」「2027 年」）或过于宽泛（「人」「事情」）\n"
    "- 数据少时诚实地少给几个概念，不要编造\n\n"
    "严格输出 JSON：\n"
    "{\n"
    "  \"concepts\": [\n"
    "    {\n"
    "      \"name\": \"概念名（≤ 6 字）\",\n"
    "      \"gloss\": \"≤ 40 字的简要说明\",\n"
    "      \"count\": 出现的 session 数,\n"
    "      \"session_ids\": [\"出现此概念的 session id\"],\n"
    "      \"related\": [\"≤ 3 个相关概念名\"]\n"
    "    }\n"
    "  ]\n"
    "}\n"
    "至少 5、至多 15 个概念。只输出 JSON。"
)


@router.post("/_concepts")
async def extract_concepts(body: dict | None = None):
    """Cross-session concept extraction — identify recurring philosophical
    concepts and which sessions discussed them. Powers the concept-evolution
    panel.

    Body: {limit?: int}
    """
    body = body or {}
    limit = max(3, min(int(body.get("limit", 20)), 40))

    from app.core.inference import get_strong_backend
    from app.routers.orchestrator import _auto_loop

    sessions = list_sessions(limit=limit)
    if not sessions:
        return {"concepts": [], "sessions_analyzed": 0}

    parts: list[str] = []
    for s in sessions:
        full = get_session(s["session_id"])
        if not full:
            continue
        sid = s["session_id"]
        block = [f"=== {sid} ===", f"种子: {s['seed_hypothesis']}"]
        for c in (full.get("cycles") or [])[:2]:
            if c.get("hypothesis") and c["hypothesis"] != s["seed_hypothesis"]:
                block.append(f"假设: {c['hypothesis']}")
            for p in (c.get("personas") or []):
                snippet = (p.get("content") or "").replace("\n", " ")[:200]
                if snippet:
                    block.append(f"  {p['persona_name']}: {snippet}")
        if full.get("final_synthesis"):
            block.append(f"综合: {(full['final_synthesis'])[:300]}")
        parts.append("\n".join(block))

    context = "\n\n".join(parts)[:30000]
    backend = get_strong_backend(_auto_loop.tracker)
    try:
        raw = await backend.complete(
            system_prompt=CONCEPT_EXTRACT_SYSTEM,
            messages=[{"role": "user", "content": f"以下是 {len(parts)} 个 session 的摘录：\n\n{context}\n\n请按 schema 输出 JSON。"}],
            max_tokens=2000, temperature=0.3,
        )
    except Exception as e:
        raise HTTPException(500, f"concept extraction backend error: {type(e).__name__}: {str(e)[:200]}")

    raw = re.sub(r"```(?:json)?\s*", "", raw or "")
    raw = re.sub(r"```\s*$", "", raw)
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return {"concepts": [], "sessions_analyzed": len(parts), "parse_error": True}
    try:
        parsed = json.loads(m.group(0))
    except json.JSONDecodeError:
        return {"concepts": [], "sessions_analyzed": len(parts), "parse_error": True}

    concepts = []
    for c in (parsed.get("concepts") or [])[:15]:
        if not isinstance(c, dict):
            continue
        concepts.append({
            "name": str(c.get("name", ""))[:30],
            "gloss": str(c.get("gloss", ""))[:120],
            "count": int(c.get("count", 0)) if isinstance(c.get("count"), (int, float)) else 0,
            "session_ids": [str(x)[:20] for x in (c.get("session_ids") or [])][:8],
            "related": [str(x)[:30] for x in (c.get("related") or [])][:3],
        })
    return {
        "concepts": concepts,
        "sessions_analyzed": len(parts),
        "model": backend.backend_name(),
    }


PERSONALIZED_ADVERSARY_SYSTEM = (
    "你是一位 prompt 工程师 + 用户认知分析师。下面是某个用户最近 N 个哲学辩论 session 的"
    "摘录。你的任务：基于此用户**显示出来的论证模式 / 立场偏好 / 思维习惯**，"
    "生成一个**专门攻击这个用户的魔鬼代言人（adversary）的 system prompt**。\n\n"
    "这个 adversary 比通用 adversary 强 5 倍 — 因为它知道：\n"
    "- 这个用户**反复回到哪些立场**（他们的舒适区）\n"
    "- **从不质疑哪些预设**（他们的盲点）\n"
    "- **被哪种论证形式说服得最快**（他们对哪种修辞最没抵抗力）\n"
    "- **对哪个 persona 最反感 / 最跳过**（他们的厌恶过滤）\n\n"
    "输出严格 JSON：\n"
    "{\n"
    "  \"user_fingerprint\": \"≤ 150 字 — 用户的核心认知模式画像（具体！不要泛泛）\",\n"
    "  \"blind_spots\": [\"≤ 3 个用户从不质疑的具体预设\"],\n"
    "  \"comfort_positions\": [\"≤ 3 个用户反复回到的立场\"],\n"
    "  \"adversary_prompt\": \"完整的 adversary system prompt（≤ 600 字），中文，"
    "明确告诉这个 adversary 它要专门攻击什么、用什么策略，不要泛泛说『质疑一切』\",\n"
    "  \"sample_attacks\": [\"≤ 3 个示例攻击 — 当这个 adversary 实际工作时会问什么具体问题\"]\n"
    "}\n\n"
    "**重要**：\n"
    "- 不要做出价值判断（用户的偏好不是「错」的，只是有被挑战的空间）\n"
    "- adversary 必须**精准、不烦人** — 它的攻击应该让用户「我从没这样想过」而不是「又来了」\n"
    "- 样本不足时诚实说「需要更多 session 才能生成精准画像」\n\n"
    "只输出 JSON。"
)


@router.post("/_personalized_adversary")
async def personalized_adversary(body: dict | None = None):
    """Generate a custom devil's-advocate system prompt tailored to this
    user's specific argumentation patterns + blind spots, based on their
    archived sessions.

    Body: {limit?: int}  — default 15 most recent sessions
    """
    body = body or {}
    limit = max(3, min(int(body.get("limit", 15)), 30))

    from app.core.inference import get_strong_backend
    from app.routers.orchestrator import _auto_loop

    sessions = list_sessions(limit=limit)
    if not sessions or len(sessions) < 3:
        return {
            "user_fingerprint": "样本不足 — 至少需要 3 个持久化 session 才能生成画像",
            "blind_spots": [],
            "comfort_positions": [],
            "adversary_prompt": "",
            "sample_attacks": [],
            "sessions_analyzed": len(sessions or []),
        }

    parts: list[str] = []
    for s in sessions:
        full = get_session(s["session_id"])
        if not full:
            continue
        block = [f"=== {s['session_id']} ({s['mode']}) ===",
                 f"用户提的种子: {s['seed_hypothesis']}"]
        for c in (full.get("cycles") or [])[:2]:
            if c.get("hypothesis") and c["hypothesis"] != s["seed_hypothesis"]:
                block.append(f"演化为: {c['hypothesis']}")
        if full.get("final_synthesis"):
            block.append(f"用户接受的综合: {(full['final_synthesis'])[:300]}")
        parts.append("\n".join(block))

    context = "\n\n".join(parts)[:20000]
    backend = get_strong_backend(_auto_loop.tracker)
    try:
        raw = await backend.complete(
            system_prompt=PERSONALIZED_ADVERSARY_SYSTEM,
            messages=[{"role": "user", "content": f"以下是 {len(parts)} 个用户 session：\n\n{context}\n\n请按 schema 输出 JSON。"}],
            max_tokens=2000, temperature=0.4,
        )
    except Exception as e:
        raise HTTPException(500, f"personalized adversary backend error: {type(e).__name__}: {str(e)[:200]}")

    raw = re.sub(r"```(?:json)?\s*", "", raw or "")
    raw = re.sub(r"```\s*$", "", raw)
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return {
            "user_fingerprint": "解析失败",
            "blind_spots": [], "comfort_positions": [],
            "adversary_prompt": "", "sample_attacks": [],
            "sessions_analyzed": len(parts),
        }
    try:
        parsed = json.loads(m.group(0))
    except json.JSONDecodeError:
        return {
            "user_fingerprint": "JSON 解析失败",
            "blind_spots": [], "comfort_positions": [],
            "adversary_prompt": "", "sample_attacks": [],
            "sessions_analyzed": len(parts),
        }

    return {
        "user_fingerprint": str(parsed.get("user_fingerprint", ""))[:500],
        "blind_spots": [str(x)[:120] for x in (parsed.get("blind_spots") or [])][:5],
        "comfort_positions": [str(x)[:120] for x in (parsed.get("comfort_positions") or [])][:5],
        "adversary_prompt": str(parsed.get("adversary_prompt", ""))[:3000],
        "sample_attacks": [str(x)[:200] for x in (parsed.get("sample_attacks") or [])][:5],
        "sessions_analyzed": len(parts),
        "model": backend.backend_name(),
    }


RETROSPECTIVE_SYSTEM = (
    "你是一位元分析专家。下面是来自多个 philosophical auto-loop session 的"
    "**摘录**：每段包含 seed hypothesis、几个 persona 的发言节选、综合摘要。\n\n"
    "你的任务：从**跨 session 的层面**识别：\n"
    "1. **每个 persona 的复发模式** —— 某 persona 是否反复落入同一种论证陷阱、"
    "反复回避某类话题、反复使用同一个套路？\n"
    "2. **缺席的视角** —— 哪些立场 / 文化 / 学科明显从未被讨论到？\n"
    "3. **质量改进建议** —— 给每个明显有问题的 persona 提出**具体的 system "
    "prompt 修改建议**（例如「在 critical_theorist 的 prompt 末尾添加 X」）。\n\n"
    "**重要**：只指出有具体例子支撑的模式，不要凭空猜测。"
    "如果数据太少，诚实地说 \"样本不足\" 而非编造模式。\n\n"
    "严格输出 JSON：\n"
    "{\n"
    "  \"persona_patterns\": [\n"
    "    {\"persona_id\": str, \"pattern\": \"≤ 60 字的复发模式描述\", "
    "\"evidence\": [\"≤ 40 字的具体引用\"], \"prompt_suggestion\": \"≤ 80 字的修改建议\"}\n"
    "  ],\n"
    "  \"missing_perspectives\": [\"≤ 40 字的缺席视角\"],\n"
    "  \"meta_observation\": \"≤ 120 字的总体观察\"\n"
    "}\n"
    "至少 0、至多 5 个 persona_patterns。只输出 JSON。"
)


@router.post("/_retrospective")
async def run_retrospective(body: dict | None = None):
    """Meta-LLM reads recent sessions and surfaces recurring failure modes
    per persona + missing perspectives + prompt-improvement suggestions.

    Body: {limit?: int}  — default 10 most-recent sessions
    """
    body = body or {}
    limit = max(3, min(int(body.get("limit", 10)), 30))

    # Need late imports to avoid circular: this router gets imported into
    # app.main; auto_loop pulls heavy graph deps.
    from app.core.inference import get_strong_backend
    from app.routers.orchestrator import _auto_loop

    sessions = list_sessions(limit=limit)
    if not sessions:
        return {
            "persona_patterns": [],
            "missing_perspectives": [],
            "meta_observation": "样本不足 — 尚无持久化 session。",
            "sessions_analyzed": 0,
        }

    # Build a compact context from each session: seed hypothesis, top-3
    # persona statement snippets, final synthesis preview.
    excerpts: list[str] = []
    for s in sessions:
        full = get_session(s["session_id"])
        if not full:
            continue
        parts = [
            f"=== Session #{s['session_id']} ({s['mode']}) ===",
            f"种子: {s['seed_hypothesis']}",
        ]
        for c in (full.get("cycles") or [])[:2]:  # first 2 cycles only — keep context tight
            for p in (c.get("personas") or []):
                snippet = (p.get("content") or "").replace("\n", " ")[:240]
                parts.append(f"  [{p['persona_name']} ({p['persona_id']})] {snippet}")
        if full.get("final_synthesis"):
            parts.append(f"综合: {(full['final_synthesis'] or '')[:300]}")
        excerpts.append("\n".join(parts))

    context_block = "\n\n".join(excerpts)[:24000]  # cap at ~24k chars

    backend = get_strong_backend(_auto_loop.tracker)
    user = f"以下是 {len(excerpts)} 个 session 的摘录：\n\n{context_block}\n\n请按 schema 输出 JSON。"
    try:
        raw = await backend.complete(
            system_prompt=RETROSPECTIVE_SYSTEM,
            messages=[{"role": "user", "content": user}],
            max_tokens=2000, temperature=0.3,
        )
    except Exception as e:
        raise HTTPException(500, f"retrospective backend error: {type(e).__name__}: {str(e)[:200]}")

    raw = re.sub(r"```(?:json)?\s*", "", raw or "")
    raw = re.sub(r"```\s*$", "", raw)
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return {
            "persona_patterns": [],
            "missing_perspectives": [],
            "meta_observation": "解析失败 — 模型未返回 JSON",
            "sessions_analyzed": len(excerpts),
            "raw_excerpt": raw[:200],
        }
    try:
        parsed = json.loads(m.group(0))
    except json.JSONDecodeError as e:
        logger.warning("retrospective JSON parse failed: %s", e)
        return {
            "persona_patterns": [],
            "missing_perspectives": [],
            "meta_observation": "JSON 解析失败",
            "sessions_analyzed": len(excerpts),
            "raw_excerpt": m.group(0)[:200],
        }
    return {
        "persona_patterns": (parsed.get("persona_patterns") or [])[:5],
        "missing_perspectives": (parsed.get("missing_perspectives") or [])[:6],
        "meta_observation": str(parsed.get("meta_observation", ""))[:500],
        "sessions_analyzed": len(excerpts),
        "model": backend.backend_name(),
    }


CONSISTENCY_COMPARE_SYSTEM = (
    "你是一位 LLM 立场一致性评估员。两段文本来自**同一个 persona**回答**同一个问题**，"
    "但产生时间不同（可能间隔几天到几个月）。判定该 persona 的立场在两次之间是否一致。\n\n"
    "评级标签（必须选其一）：\n"
    "- consistent：核心立场和论证路径基本一致\n"
    "- nuance_shift：立场方向一致，但论证侧重 / 例子 / 边界条件变化\n"
    "- significant_drift：立场明显改变（不必完全相反，但权重显著倒过来）\n"
    "- contradicted：直接反驳了之前的立场\n\n"
    "严格输出 JSON：\n"
    "{\n"
    "  \"verdict\": \"consistent|nuance_shift|significant_drift|contradicted\",\n"
    "  \"reason\": \"≤ 80 字的具体说明（指出关键差异 / 共通点）\",\n"
    "  \"key_continuity\": \"≤ 40 字：什么保留了\",\n"
    "  \"key_change\": \"≤ 40 字：什么变了（若 consistent 则填 '无显著变化'）\"\n"
    "}\n"
    "只输出 JSON。"
)


@router.post("/{session_id}/consistency_test")
async def run_consistency_test(session_id: str):
    """Replay each persona's cycle-1 question with the same model + prompt,
    then have an LLM compare the new response to the original. Tests whether
    LLM positions on philosophical questions drift over time.

    Returns one comparison per persona that spoke in cycle 1.
    """
    import asyncio as _asyncio
    import time as _time

    from app.core.inference import get_strong_backend, get_backend_from_spec
    from app.routers.orchestrator import _auto_loop
    from app.services.auto_loop import PHILOSOPHICAL_PERSONAS, ADVERSARIAL_SYSTEM_PROMPT

    full = get_session(session_id)
    if not full:
        raise HTTPException(404, f"session {session_id} not found")
    cycles = full.get("cycles") or []
    if not cycles:
        raise HTTPException(400, "session has no cycles to replay")
    target = cycles[0]
    question = target.get("hypothesis") or full.get("seed_hypothesis", "")
    original_personas = target.get("personas") or []
    if not original_personas:
        raise HTTPException(400, "cycle 1 has no persona statements to compare against")

    # Build persona spec lookup so we can re-run with the same model.
    PERSONA_BY_ID = {p["id"]: p for p in PHILOSOPHICAL_PERSONAS}
    PERSONA_BY_ID["adversary"] = {
        "id": "adversary", "name": "魔鬼代言人", "role": "对抗",
        "system_prompt": ADVERSARIAL_SYSTEM_PROMPT,
    }

    async def _replay_and_compare(orig: dict) -> dict:
        pid = orig.get("persona_id", "")
        persona = PERSONA_BY_ID.get(pid)
        if persona is None:
            return {"persona_id": pid, "error": "unknown persona", "skipped": True}
        model_spec = orig.get("model") or "claude:claude-sonnet-4-6"

        user_prompt = (
            f"问题：{question}\n\n"
            f"请从你的哲学立场出发，对这个问题给出你的分析和立场（300 字以内）。"
        )

        # Re-run
        t0 = _time.perf_counter()
        try:
            backend = get_backend_from_spec(model_spec, _auto_loop.tracker, tier="persona")
            new_content = await backend.complete(
                system_prompt=persona["system_prompt"],
                messages=[{"role": "user", "content": user_prompt}],
                max_tokens=700, temperature=0.7,
            )
        except Exception as e:
            return {
                "persona_id": pid,
                "persona_name": orig.get("persona_name", pid),
                "model": model_spec,
                "error": f"replay failed: {type(e).__name__}",
                "skipped": True,
            }
        replay_ms = round((_time.perf_counter() - t0) * 1000, 1)

        # Compare via strong-tier LLM
        comparator = get_strong_backend(_auto_loop.tracker)
        compare_user = (
            f"问题：{question}\n\n"
            f"Persona: {orig.get('persona_name', pid)} ({pid})\n\n"
            f"原 (Time A):\n{orig.get('content','')}\n\n"
            f"新 (Time B):\n{new_content}\n\n"
            f"请按 schema 输出 JSON 评估。"
        )
        try:
            raw = await comparator.complete(
                system_prompt=CONSISTENCY_COMPARE_SYSTEM,
                messages=[{"role": "user", "content": compare_user}],
                max_tokens=500, temperature=0.2,
            )
            raw = re.sub(r"```(?:json)?\s*", "", raw or "")
            raw = re.sub(r"```\s*$", "", raw)
            m = re.search(r"\{.*\}", raw, re.DOTALL)
            verdict_data = json.loads(m.group(0)) if m else None
        except Exception as e:
            logger.warning("compare LLM failed for %s: %s", pid, e)
            verdict_data = None

        return {
            "persona_id": pid,
            "persona_name": orig.get("persona_name", pid),
            "model": model_spec,
            "original_content": orig.get("content", ""),
            "original_falsifiability": orig.get("falsifiability"),
            "new_content": new_content,
            "verdict": (verdict_data or {}).get("verdict", "unknown"),
            "reason": (verdict_data or {}).get("reason", ""),
            "key_continuity": (verdict_data or {}).get("key_continuity", ""),
            "key_change": (verdict_data or {}).get("key_change", ""),
            "replay_ms": replay_ms,
            "skipped": False,
        }

    results = await _asyncio.gather(*[_replay_and_compare(p) for p in original_personas])
    return {
        "session_id": session_id,
        "question": question,
        "original_finished_at": full.get("finished_at"),
        "replayed_at": _time.strftime("%Y-%m-%dT%H:%M:%SZ", _time.gmtime()),
        "results": results,
    }


@router.get("/{session_id}")
async def get_session_detail(session_id: str):
    """Full session: cycles + persona statements + judge verdicts."""
    s = get_session(session_id)
    if s is None:
        raise HTTPException(404, f"session {session_id} not found")
    return s


@router.delete("/{session_id}")
async def remove_session(session_id: str):
    """Delete a session and all its cycles / personas / verdicts."""
    if not delete_session(session_id):
        raise HTTPException(404, f"session {session_id} not found")
    return {"status": "deleted", "session_id": session_id}
