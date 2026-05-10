"""Voting Hall service — runs structured votes with stackable analysis methods.

Methods (any combination):
  panel        : each model in pool votes once
  calibration  : single model votes N times across temperatures
  matrix       : models × temps grid (cap 30)

  framing_flip     : also run negated question, distill comparison via Haiku
  super_forecaster : prompt forces base_rate + adjustments + final
  role_framing     : each model votes 3x as optimist / pessimist / neutral
  delphi           : 3-phase silent → cross-debate → re-vote (with stance-shift map)
  human_baseline   : ingest user's pre-vote, embed in aggregate
"""

import asyncio
import json
import logging
import os
import re
import time
import uuid
from pathlib import Path
from typing import AsyncGenerator

from app.config import get_settings
from app.core.inference import get_backend_from_spec, get_cheap_backend, get_judge_backend
from app.core.streaming import sse_event
from app.core.token_tracker import TokenTracker
from app.schemas.voting import VotingConfig

logger = logging.getLogger(__name__)

VOTE_LOG_DIR = Path(os.environ.get("WHATIF_VOTE_LOG_DIR", "/tmp/whatif-runs"))
VOTE_LOG_DIR.mkdir(parents=True, exist_ok=True)


# ──────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────

def _extract_json(text: str) -> dict | None:
    text = re.sub(r"```(?:json)?\s*", "", text or "")
    text = re.sub(r"```\s*$", "", text)
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def _resolve_pool(specs_in: list[str]) -> list[str]:
    if specs_in:
        return [s.strip() for s in specs_in if s.strip()]
    pool_str = getattr(get_settings(), "persona_pool", "")
    return [s.strip() for s in pool_str.split(",") if s.strip()] if pool_str else []


def _build_prompt(
    cfg: VotingConfig,
    question_override: str | None = None,
    role: str | None = None,
) -> tuple[str, str]:
    """Returns (system_prompt, user_prompt). Honors super_forecaster + role_framing."""
    if cfg.vote_type == "binary":
        opts = "yes / no / uncertain"
        vote_field = '"yes" 或 "no" 或 "uncertain"'
    else:
        opts = "1 到 10 的整数（1=完全否定，10=完全肯定）"
        vote_field = '"1" 到 "10" 的字符串'

    role_directive = ""
    if role:
        role_map = {
            "optimist": "你扮演一位**乐观主义者**：倾向于认为机遇会到来、风险被高估、人类会找到办法。但仍要给出真实判断（不是装乐观）。",
            "pessimist": "你扮演一位**悲观主义者**：倾向于看见隐患、技术债、外部冲击和系统脆弱性。但仍要给出真实判断（不是装悲观）。",
            "neutral":   "你扮演一位**中性专家**：刻意剥离任何情感倾向，只看证据和概率。这是基线对照。",
        }
        role_directive = "\n\n" + role_map.get(role, "")

    if cfg.super_forecaster:
        # Tetlock-style structured prediction.
        body = (
            f"严格按以下三步推理后输出 JSON：\n"
            f"1. base_rate：估计历史上类似事件的发生频率（如'过去 20 年里类似突破出现过 X 次'）\n"
            f"2. adjustments：列出 1-3 个让概率偏离 base rate 的具体因素（每条 ≤20 字）\n"
            f"3. final：综合得到最终判断\n\n"
            f"投票选项：{opts}\n\n"
            f"输出 JSON：{{\n"
            f'  "base_rate": "对 base rate 的估计 + 出处推断（≤40字）",\n'
            f'  "adjustments": ["≤20字 调整因素1", "≤20字 调整因素2"],\n'
            f'  "vote": {vote_field},\n'
            f'  "confidence": 0-100 整数,\n'
            f'  "rationale": 一句中文 ≤60 字总结\n'
            f"}}\n"
            "不要任何额外内容，仅 JSON。"
        )
    else:
        body = (
            f"投票选项：{opts}\n\n"
            f"输出 JSON：{{\n"
            f'  "vote": {vote_field},\n'
            f'  "confidence": 0-100 整数,\n'
            f'  "rationale": 一句中文 ≤60 字简短理由\n'
            f"}}\n"
            "不要任何额外内容、不要 markdown。直接输出 JSON。"
        )

    system = "你是一位被随机抽中的专家代表。" + role_directive + "\n\n" + body
    q = question_override or cfg.question
    ctx = f"\n\n背景：{cfg.context}" if cfg.context else ""
    user = f"命题：{q}{ctx}\n\n请投票。"
    return system, user


def _normalize_vote(vote_raw, vote_type: str) -> str:
    vote = str(vote_raw or "").strip().lower()
    if vote_type == "binary":
        if vote not in ("yes", "no", "uncertain"):
            mapping = {"是": "yes", "否": "no", "不确定": "uncertain", "支持": "yes", "反对": "no"}
            vote = mapping.get(vote, "uncertain")
    else:
        try:
            n = int(float(vote))
            vote = str(max(1, min(10, n)))
        except (ValueError, TypeError):
            vote = "5"
    return vote


async def _cast_one(
    spec: str, temperature: float, cfg: VotingConfig, tracker: TokenTracker,
    question_override: str | None = None, role: str | None = None,
) -> dict:
    backend = get_backend_from_spec(spec, tracker)
    system, user = _build_prompt(cfg, question_override=question_override, role=role)
    t0 = time.time()
    try:
        raw = await backend.complete(
            system_prompt=system,
            messages=[{"role": "user", "content": user}],
            max_tokens=cfg.max_tokens + (200 if cfg.super_forecaster else 0),
            temperature=temperature,
        )
    except Exception as e:
        return {
            "model": backend.backend_name(),
            "temperature": temperature, "vote": "ERROR", "confidence": 0,
            "rationale": f"调用失败：{type(e).__name__}", "raw": "",
            "duration_ms": int((time.time() - t0) * 1000),
            "role": role,
        }
    duration_ms = int((time.time() - t0) * 1000)
    parsed = _extract_json(raw) or {}
    confidence = parsed.get("confidence", 50)
    try: confidence = max(0, min(100, int(confidence)))
    except (TypeError, ValueError): confidence = 50

    out = {
        "model": backend.backend_name(),
        "temperature": temperature,
        "vote": _normalize_vote(parsed.get("vote"), cfg.vote_type) if parsed else "PARSE_ERROR",
        "confidence": confidence,
        "rationale": str(parsed.get("rationale", ""))[:120],
        "raw": (raw or "")[:300],
        "duration_ms": duration_ms,
        "role": role,
    }
    if cfg.super_forecaster:
        out["base_rate"] = str(parsed.get("base_rate", ""))[:80]
        out["adjustments"] = [str(x)[:50] for x in (parsed.get("adjustments") or [])][:3]
    return out


def _temps_for(votes_per_model: int) -> list[float]:
    if votes_per_model <= 1: return [0.5]
    if votes_per_model == 2: return [0.3, 0.8]
    if votes_per_model == 3: return [0.3, 0.6, 0.9]
    lo, hi = 0.2, 1.0
    return [round(lo + (hi - lo) * i / (votes_per_model - 1), 2) for i in range(votes_per_model)]


def _aggregate(results: list[dict], vote_type: str) -> dict:
    if vote_type == "binary":
        counts = {"yes": 0, "no": 0, "uncertain": 0, "ERROR": 0, "PARSE_ERROR": 0}
        for r in results:
            counts[r["vote"]] = counts.get(r["vote"], 0) + 1
        valid = sum(counts.get(k, 0) for k in ("yes", "no", "uncertain"))
        if valid == 0:
            return {"type": "binary", "counts": counts, "winner": "n/a", "consensus": 0, "avg_confidence": 0}
        winner = max(("yes", "no", "uncertain"), key=lambda k: counts.get(k, 0))
        avg_conf = sum(r["confidence"] for r in results if r["vote"] in ("yes", "no", "uncertain")) / max(1, valid)
        return {
            "type": "binary", "counts": counts, "winner": winner,
            "consensus": counts.get(winner, 0) / max(1, valid),
            "avg_confidence": round(avg_conf, 1),
        }
    nums = []
    for r in results:
        try: nums.append(int(r["vote"]))
        except (ValueError, TypeError): pass
    if not nums:
        return {"type": "scale10", "n": 0}
    mean = sum(nums) / len(nums)
    var = sum((n - mean) ** 2 for n in nums) / len(nums)
    return {
        "type": "scale10", "n": len(nums), "mean": round(mean, 2),
        "stddev": round(var ** 0.5, 2), "min": min(nums), "max": max(nums),
        "histogram": {str(i): nums.count(i) for i in range(1, 11)},
        "avg_confidence": round(sum(r["confidence"] for r in results) / len(results), 1),
    }


def _detect_strong_disagreements(results: list[dict], vote_type: str) -> list[dict]:
    """Find pairs where two models voted opposite at high confidence."""
    if vote_type != "binary":
        return []
    flags = []
    valid = [r for r in results if r["vote"] in ("yes", "no") and r["confidence"] >= 75]
    for i, a in enumerate(valid):
        for b in valid[i + 1:]:
            if a["vote"] != b["vote"] and a["model"] != b["model"]:
                flags.append({
                    "model_a": a["model"], "vote_a": a["vote"], "conf_a": a["confidence"],
                    "model_b": b["model"], "vote_b": b["vote"], "conf_b": b["confidence"],
                    "rationale_a": a["rationale"], "rationale_b": b["rationale"],
                    "intensity": (a["confidence"] + b["confidence"]) // 2,
                })
    return sorted(flags, key=lambda f: -f["intensity"])[:8]


# ──────────────────────────────────────────────────────────────────────
# Method: framing_flip — distill the two outcomes
# ──────────────────────────────────────────────────────────────────────

def _negate_question(q: str) -> str:
    """Heuristic negation. For more reliable phrasing we'd ask Haiku, but we
    inline a simple rule to keep flip_flip cheap. Frontend can override."""
    q = q.strip().rstrip("。？?")
    return f"{q} —— **不会**发生 / **不能**成立"


async def _distill_flip(
    original: str, original_agg: dict, flipped: str, flipped_agg: dict,
    tracker: TokenTracker,
) -> str:
    backend = get_cheap_backend(tracker)
    system = (
        "你是一位决策分析员。给定**同一个问题被正反两种 framing 投票后的结果**，"
        "用一段（≤120 字）中文回答两件事：\n"
        "  1. 两次投票是否一致？（一致 → 模型对此命题立场稳健；不一致 → 存在 framing bias）\n"
        "  2. 蒸馏出**核心结论**（不只是描述差异，要给最终判断）。\n"
        "禁用空话，禁用 markdown。"
    )
    user = (
        f"正向命题：{original}\n"
        f"  → 投票分布：{original_agg}\n\n"
        f"反向命题：{flipped}\n"
        f"  → 投票分布：{flipped_agg}"
    )
    try:
        return (await backend.complete(
            system_prompt=system,
            messages=[{"role": "user", "content": user}],
            max_tokens=400, temperature=0.3,
        )).strip()
    except Exception as e:
        return f"[蒸馏失败: {e}]"


# ──────────────────────────────────────────────────────────────────────
# Method: delphi — vote → cross-debate → re-vote (3 phases)
# ──────────────────────────────────────────────────────────────────────

async def _delphi_react(
    spec: str, cfg: VotingConfig, others: list[dict], tracker: TokenTracker,
) -> str:
    """Each model sees other models' votes + reasons, gives ONE-sentence reaction."""
    backend = get_backend_from_spec(spec, tracker)
    others_txt = "\n".join(
        f"- {shortmodel(o['model'])} 投 {o['vote']} (信心 {o['confidence']}%): {o['rationale']}"
        for o in others
    )
    system = (
        "你刚刚对一个命题投了票。现在你看到了其他模型的投票和理由。"
        "你的任务：用**一句话（≤50 字）**回应 — 是承认某条反对意见有道理？还是坚持原立场并指出对方盲点？"
        "禁用空话、禁用'我同意/不同意'之类的废话。直接给出新观点。"
    )
    user = f"命题：{cfg.question}\n\n其他模型投票：\n{others_txt}\n\n请用一句话回应。"
    try:
        out = await backend.complete(
            system_prompt=system,
            messages=[{"role": "user", "content": user}],
            max_tokens=160, temperature=0.5,
        )
        return (out or "").strip()[:200]
    except Exception as e:
        return f"[反应失败: {type(e).__name__}]"


def shortmodel(s: str) -> str:
    for p in ("ollama:", "claude:", "openai:", "glm:", "deepseek:"):
        if s.startswith(p):
            return s[len(p):]
    return s


# ──────────────────────────────────────────────────────────────────────
# Main runner
# ──────────────────────────────────────────────────────────────────────

async def run_voting(cfg: VotingConfig, tracker: TokenTracker) -> AsyncGenerator[dict, None]:
    session_id = uuid.uuid4().hex[:8]
    log_path = VOTE_LOG_DIR / f"vote-{session_id}.jsonl"
    log_fh = log_path.open("w", buffering=1)
    start_ts = time.time()
    def _emit(ev: dict):
        try:
            log_fh.write(json.dumps(
                {"t_ms": int((time.time() - start_ts) * 1000), **ev},
                ensure_ascii=False,
            ) + "\n")
        except Exception:
            pass

    try:
        # ── Build base plan (model_spec, temperature) ──
        if cfg.mode == "panel":
            models = _resolve_pool(cfg.models)
            if not models:
                ev = sse_event("vote_error", {"error": "panel mode: no models in pool"})
                _emit(ev); yield ev; return
            base_plan = [(m, 0.5) for m in models]
        elif cfg.mode == "calibration":
            base_plan = [(cfg.calibration_model, t) for t in _temps_for(cfg.votes_per_model)]
        else:  # matrix
            models = _resolve_pool(cfg.models)
            if not models:
                ev = sse_event("vote_error", {"error": "matrix mode: no models in pool"})
                _emit(ev); yield ev; return
            base_plan = [(m, t) for m in models for t in _temps_for(cfg.votes_per_model)]
            if len(base_plan) > 30:
                base_plan = base_plan[:30]

        # Role framing → expand each plan entry × 3 roles
        roles = [None]
        if cfg.role_framing:
            roles = ["neutral", "optimist", "pessimist"]
        expanded_plan = [(m, t, r) for (m, t) in base_plan for r in roles]

        ev = sse_event("vote_session_start", {
            "session_id": session_id,
            "question": cfg.question,
            "vote_type": cfg.vote_type,
            "mode": cfg.mode,
            "methods": {
                "framing_flip": cfg.framing_flip,
                "super_forecaster": cfg.super_forecaster,
                "role_framing": cfg.role_framing,
                "delphi": cfg.delphi,
                "human_baseline": cfg.human_baseline,
            },
            "human_pre_vote": cfg.human_pre_vote if cfg.human_baseline else "",
            "total_votes": len(expanded_plan) * (2 if cfg.framing_flip else 1) * (2 if cfg.delphi else 1),
            "plan_size": len(expanded_plan),
        })
        _emit(ev); yield ev

        # ── PHASE 1: original question ──
        ev = sse_event("vote_phase", {"phase": "original", "label": "Phase 1 · 原命题投票"})
        _emit(ev); yield ev

        original_results = []
        async def _wrapped(spec, temp, role, channel):
            r = await _cast_one(spec, temp, cfg, tracker, role=role)
            r["channel"] = channel
            return r
        tasks = [
            asyncio.create_task(_wrapped(m, t, r, "original"))
            for (m, t, r) in expanded_plan
        ]
        for fut in asyncio.as_completed(tasks):
            result = await fut
            original_results.append(result)
            ev = sse_event("vote_received", {
                "channel": "original",
                "completed": len(original_results),
                "total": len(expanded_plan),
                "result": result,
            })
            _emit(ev); yield ev

        original_agg = _aggregate(original_results, cfg.vote_type)
        original_disagreements = _detect_strong_disagreements(original_results, cfg.vote_type)

        ev = sse_event("vote_aggregate", {
            "channel": "original",
            "aggregate": original_agg,
            "strong_disagreements": original_disagreements,
        })
        _emit(ev); yield ev

        # ── PHASE 2: framing flip ──
        flipped_results, flipped_agg, flipped_disagreements, distillation = [], None, [], ""
        if cfg.framing_flip:
            flipped_q = _negate_question(cfg.question)
            ev = sse_event("vote_phase", {
                "phase": "flipped", "label": "Phase 2 · 反向 framing", "question": flipped_q,
            })
            _emit(ev); yield ev

            tasks = [
                asyncio.create_task(_cast_one(m, t, cfg, tracker, question_override=flipped_q, role=r))
                for (m, t, r) in expanded_plan
            ]
            for fut in asyncio.as_completed(tasks):
                result = await fut
                result["channel"] = "flipped"
                flipped_results.append(result)
                ev = sse_event("vote_received", {
                    "channel": "flipped",
                    "completed": len(flipped_results),
                    "total": len(expanded_plan),
                    "result": result,
                })
                _emit(ev); yield ev

            flipped_agg = _aggregate(flipped_results, cfg.vote_type)
            flipped_disagreements = _detect_strong_disagreements(flipped_results, cfg.vote_type)

            ev = sse_event("vote_aggregate", {
                "channel": "flipped", "aggregate": flipped_agg,
                "strong_disagreements": flipped_disagreements,
            })
            _emit(ev); yield ev

            distillation = await _distill_flip(
                cfg.question, original_agg, flipped_q, flipped_agg, tracker,
            )
            ev = sse_event("vote_distillation", {
                "original_question": cfg.question,
                "flipped_question": flipped_q,
                "distillation": distillation,
            })
            _emit(ev); yield ev

        # ── PHASE 3: Delphi cross-debate + re-vote ──
        delphi_reactions, revote_results, revote_agg = [], [], None
        if cfg.delphi:
            ev = sse_event("vote_phase", {
                "phase": "delphi_react", "label": "Phase 3 · 互看反应",
                "warning": "解读时小心：辩论后变票可能是真心改变，也可能是从众压力。",
            })
            _emit(ev); yield ev

            # Each model sees others' votes and reacts
            unique_models = list({r["model"] for r in original_results})
            react_tasks = []
            for m in unique_models:
                others = [r for r in original_results if r["model"] != m and r["channel"] == "original"]
                # find this model's spec from the original plan
                spec = next((s for (s, _, _) in expanded_plan if get_backend_from_spec(s, tracker).backend_name() == m), None)
                if not spec:
                    spec = m  # already a spec
                react_tasks.append((m, spec, others))

            async def _react_wrap(m, spec, others):
                txt = await _delphi_react(spec, cfg, others, tracker)
                return {"model": m, "reaction": txt}
            tasks = [asyncio.create_task(_react_wrap(m, s, o)) for (m, s, o) in react_tasks]
            for fut in asyncio.as_completed(tasks):
                rxn = await fut
                delphi_reactions.append(rxn)
                ev = sse_event("delphi_reaction", rxn)
                _emit(ev); yield ev

            # Re-vote: each model, knowing reactions, votes again
            ev = sse_event("vote_phase", {"phase": "revote", "label": "Phase 4 · 重投"})
            _emit(ev); yield ev

            revote_tasks = [
                asyncio.create_task(_cast_one(m, t, cfg, tracker, role=r))
                for (m, t, r) in expanded_plan
            ]
            for fut in asyncio.as_completed(revote_tasks):
                result = await fut
                result["channel"] = "revote"
                revote_results.append(result)
                ev = sse_event("vote_received", {
                    "channel": "revote",
                    "completed": len(revote_results),
                    "total": len(expanded_plan),
                    "result": result,
                })
                _emit(ev); yield ev

            revote_agg = _aggregate(revote_results, cfg.vote_type)
            ev = sse_event("vote_aggregate", {
                "channel": "revote", "aggregate": revote_agg,
            })
            _emit(ev); yield ev

            # Stance shift map
            shifts = []
            for orig in original_results:
                if orig.get("role"): continue  # only top-level for shifts
                rev = next((r for r in revote_results if r["model"] == orig["model"]
                            and r["temperature"] == orig["temperature"]
                            and r.get("role") == orig.get("role")), None)
                if rev:
                    shifts.append({
                        "model": orig["model"],
                        "before": orig["vote"], "after": rev["vote"],
                        "shifted": orig["vote"] != rev["vote"],
                        "before_conf": orig["confidence"], "after_conf": rev["confidence"],
                    })
            ev = sse_event("delphi_shifts", {"shifts": shifts})
            _emit(ev); yield ev

        # ── Final wrap-up ──
        all_results = original_results + flipped_results + revote_results
        ev = sse_event("vote_complete", {
            "session_id": session_id,
            "total_votes": len(all_results),
            "original_aggregate": original_agg,
            "flipped_aggregate": flipped_agg,
            "revote_aggregate": revote_agg,
            "strong_disagreements": original_disagreements,
            "distillation": distillation,
            "delphi_reactions": delphi_reactions,
            "human_pre_vote": cfg.human_pre_vote if cfg.human_baseline else "",
            "token_usage": tracker.summary(),
        })
        _emit(ev); yield ev
    finally:
        log_fh.close()


# ──────────────────────────────────────────────────────────────────────
# Model profile aggregation across past sessions
# ──────────────────────────────────────────────────────────────────────

def aggregate_model_profile(model: str | None = None) -> dict:
    """Read all vote-*.jsonl logs, build per-model behavior profile.

    Per model, returns:
      total_votes, avg_confidence, vote_distribution,
      stance_shift_rate (fraction of delphi shifts), commits_to_uncertain_rate
    """
    by_model: dict[str, dict] = {}
    for p in VOTE_LOG_DIR.glob("vote-*.jsonl"):
        try:
            with p.open() as f:
                for line in f:
                    try: ev = json.loads(line)
                    except json.JSONDecodeError: continue
                    if ev.get("type") == "vote_received":
                        r = ev.get("data", {}).get("result", {})
                        m = r.get("model")
                        if not m: continue
                        if model and m != model: continue
                        prof = by_model.setdefault(m, {
                            "model": m, "total_votes": 0, "yes": 0, "no": 0,
                            "uncertain": 0, "errors": 0, "conf_sum": 0,
                            "channels": {"original": 0, "flipped": 0, "revote": 0},
                        })
                        prof["total_votes"] += 1
                        v = r.get("vote", "")
                        if v in prof:
                            prof[v] += 1
                        elif v in ("ERROR", "PARSE_ERROR"):
                            prof["errors"] += 1
                        prof["conf_sum"] += int(r.get("confidence", 0) or 0)
                        ch = r.get("channel", "original")
                        prof["channels"][ch] = prof["channels"].get(ch, 0) + 1
                    elif ev.get("type") == "delphi_shifts":
                        for s in ev.get("data", {}).get("shifts", []):
                            m = s.get("model")
                            if not m: continue
                            if model and m != model: continue
                            prof = by_model.setdefault(m, {
                                "model": m, "total_votes": 0, "yes": 0, "no": 0,
                                "uncertain": 0, "errors": 0, "conf_sum": 0,
                                "channels": {}, "delphi_shifts_total": 0, "delphi_shifted": 0,
                            })
                            prof.setdefault("delphi_shifts_total", 0)
                            prof.setdefault("delphi_shifted", 0)
                            prof["delphi_shifts_total"] += 1
                            if s.get("shifted"): prof["delphi_shifted"] += 1
        except Exception as e:
            logger.warning(f"profile: failed to parse {p.name}: {e}")
            continue

    # Finalize derived metrics
    out = []
    for m, p in by_model.items():
        n = max(1, p["total_votes"])
        p["avg_confidence"] = round(p["conf_sum"] / n, 1)
        p["yes_rate"] = round(p["yes"] / n, 2)
        p["no_rate"] = round(p["no"] / n, 2)
        p["uncertain_rate"] = round(p["uncertain"] / n, 2)
        p["error_rate"] = round(p["errors"] / n, 2)
        p["stance_shift_rate"] = (
            round(p.get("delphi_shifted", 0) / p["delphi_shifts_total"], 2)
            if p.get("delphi_shifts_total") else None
        )
        # Style classification
        if p["uncertain_rate"] > 0.30: style = "保守"
        elif (p["yes_rate"] + p["no_rate"]) > 0.85 and p["avg_confidence"] > 75: style = "果断"
        elif p["avg_confidence"] < 55: style = "犹豫"
        else: style = "均衡"
        p["style"] = style
        # Drop temp counters
        for k in ("conf_sum",):
            p.pop(k, None)
        out.append(p)
    out.sort(key=lambda p: -p["total_votes"])
    return {"models": out, "log_count": len(list(VOTE_LOG_DIR.glob("vote-*.jsonl")))}
