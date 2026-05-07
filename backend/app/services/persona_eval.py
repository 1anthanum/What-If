"""Judge-issued evaluation of persona statements after each debate round.

Given a scenario + N persona statements, asks the strong backend (Claude)
to rate each persona on five dimensions in one batch JSON call. Cheaper
and more consistent than asking each local 7B model to self-rate.

Dimensions:
  - confidence  (0..100):       how forcefully the persona presents their view
  - stance      (-100..+100):   −strongly opposes  /  0 neutral  /  +strongly supports the hypothesis
  - novelty     (0..100):       how far from conventional consensus
  - risk        (0..100):       how urgent / concerning the implications
  - style       (enum):         经验主义 / 理论推演 / 直觉判断 / 对抗反驳 / 整合调和
"""

import json
import logging
import re
from typing import Iterable

from app.core.inference import get_strong_backend
from app.core.token_tracker import TokenTracker

logger = logging.getLogger(__name__)

VALID_STYLES = {
    "经验主义", "理论推演", "直觉判断", "对抗反驳", "整合调和",
}

SYSTEM_PROMPT = (
    "你是一位严谨的辩论裁判。任务：观察多位 persona 对一个假设场景的发言，"
    "对每位 persona 在 5 个维度上做精准评分。\n\n"
    "评分维度：\n"
    "1. confidence (0-100)：发言中表达确定性的强度（不是你认为他对，而是他自己显得多自信）\n"
    "2. stance (-100~+100)：对原始假设的立场。-100=强烈反对/否认会发生，0=纯中性分析，+100=强烈支持/认为会成真\n"
    "3. novelty (0-100)：观点偏离常识共识的程度（0=陈词滥调，100=反直觉的新颖洞察）\n"
    "4. risk (0-100)：发言中提示的风险或紧迫性（0=岁月静好，100=灾难预警）\n"
    "5. style：必须从以下五选一 — 经验主义 / 理论推演 / 直觉判断 / 对抗反驳 / 整合调和\n\n"
    "输出严格 JSON 数组，每个元素含字段：persona_id, confidence, stance, novelty, risk, style, rationale。"
    "rationale 用一句中文简述（≤30 字）。不要任何额外解释或 markdown 代码块。"
)


def _extract_json_array(text: str) -> list[dict] | None:
    """Tolerant JSON extraction — handle code fences, leading prose, trailing text."""
    # strip markdown fences
    text = re.sub(r"```(?:json)?\s*", "", text)
    text = re.sub(r"```\s*$", "", text)
    # find first [ ... ] block
    m = re.search(r"\[\s*\{.*\}\s*\]", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def _coerce_eval(raw: dict, fallback_id: str) -> dict:
    """Clamp and validate one persona-eval dict so frontend never gets garbage."""
    def clamp_int(v, lo, hi, default=0):
        try:
            return max(lo, min(hi, int(v)))
        except (TypeError, ValueError):
            return default

    style = raw.get("style", "整合调和")
    if style not in VALID_STYLES:
        style = "整合调和"

    return {
        "persona_id": str(raw.get("persona_id", fallback_id)),
        "confidence": clamp_int(raw.get("confidence"), 0, 100, 50),
        "stance": clamp_int(raw.get("stance"), -100, 100, 0),
        "novelty": clamp_int(raw.get("novelty"), 0, 100, 50),
        "risk": clamp_int(raw.get("risk"), 0, 100, 50),
        "style": style,
        "rationale": str(raw.get("rationale", "")).strip()[:120],
    }


async def evaluate_round(
    scenario_hypothesis: str,
    statements: Iterable[dict],
    tracker: TokenTracker,
    max_tokens: int = 1200,
    temperature: float = 0.2,
) -> tuple[list[dict], str]:
    """Batch-rate all personas in a single judge call.

    `statements` items must have: persona_id, persona_name, content.
    Returns (list[eval_dict], judge_model_name).
    On any failure, returns ([], "") so callers can degrade gracefully.
    """
    stmts = list(statements)
    if not stmts:
        return [], ""

    # Build the user prompt — all personas in one shot
    user_lines = [
        f"原假设：{scenario_hypothesis}",
        "",
        "请评分以下发言：",
    ]
    for s in stmts:
        user_lines.extend([
            f"\n──── persona_id={s['persona_id']} ({s.get('persona_name','')}) ────",
            (s.get("content") or "").strip(),
        ])
    user_lines.append("\n输出严格 JSON 数组，按上面 persona_id 顺序。")
    user_prompt = "\n".join(user_lines)

    backend = get_strong_backend(tracker)
    try:
        raw = await backend.complete(
            system_prompt=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
            max_tokens=max_tokens,
            temperature=temperature,
        )
    except Exception as e:
        logger.error(f"Round evaluation backend call failed: {e}")
        return [], backend.backend_name()

    parsed = _extract_json_array(raw)
    if not parsed:
        logger.warning(f"Round evaluation produced unparseable output:\n{raw[:400]}")
        return [], backend.backend_name()

    # Index by persona_id for lookup
    by_id = {p.get("persona_id"): p for p in parsed if isinstance(p, dict)}
    out = []
    for s in stmts:
        pid = s["persona_id"]
        raw_eval = by_id.get(pid) or {}
        out.append(_coerce_eval(raw_eval, pid))
    return out, backend.backend_name()
