"""Autonomous Topic Explorer.

Long-running orchestrator that: (1) runs a baseline debate, (2) asks Haiku
to propose K alternative event-injection branches, (3) runs them, (4) lets
Sonnet rate each, (5) lets Opus decide deepen/diverge/converge, (6) loops
until time / cost / cycle budget exhausted or convergence.

Tiered models keep cost predictable:
    persona statements    → local Ollama
    per-statement summary → local 27B
    injection variants    → Haiku  (cheap)
    branch evaluation     → Sonnet
    branch decisions      → Opus   (rare)
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

# All SSE events for autonomous-debate runs are tee'd to JSONL here.
# Use GET /api/orchestrator/autonomous-debate/{session_id}/log to retrieve.
RUN_LOG_DIR = Path(os.environ.get("WHATIF_RUN_LOG_DIR", "/tmp/whatif-runs"))
RUN_LOG_DIR.mkdir(parents=True, exist_ok=True)

from app.core.inference import (
    get_backend_for_persona,
    get_cheap_backend,
    get_judge_backend,
    get_decider_backend,
)
from app.core.streaming import sse_event
from app.core.token_tracker import TokenTracker
from app.core.prompt_engine import PromptEngine
from app.schemas.autonomous import AutonomousDebateConfig, BranchEval, DeciderVerdict
from app.services.debate_room import DOMAIN_PERSONA_MAP
from app.services.persona_summary import _summarize_one

logger = logging.getLogger(__name__)


def _extract_json(text: str, kind: str = "object") -> dict | list | None:
    text = re.sub(r"```(?:json)?\s*", "", text)
    text = re.sub(r"```\s*$", "", text)
    pat = r"\[.*\]" if kind == "array" else r"\{.*\}"
    m = re.search(pat, text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


class AutonomousDebateService:
    """Single-instance service. Sessions are tracked in self.sessions."""

    def __init__(self):
        self.tracker = TokenTracker()
        self.prompt_engine = PromptEngine()
        # session_id → {"cancel": bool, "branches": list, ...}
        self.sessions: dict[str, dict] = {}

    def cancel(self, session_id: str) -> bool:
        s = self.sessions.get(session_id)
        if not s:
            return False
        s["cancel"] = True
        return True

    def kill_branch(self, session_id: str, branch_id: str) -> bool:
        """Mark a branch to be skipped / killed mid-flight."""
        s = self.sessions.get(session_id)
        if not s:
            return False
        s.setdefault("killed", set()).add(branch_id)
        return True

    def add_user_injection(self, session_id: str, text: str) -> bool:
        """User-supplied injection seed for the next cycle's Haiku prompt."""
        s = self.sessions.get(session_id)
        if not s:
            return False
        s.setdefault("user_seeds", []).append(text)
        return True

    # ──────────────────────────────────────────────────────────────────
    # Persona resolution (mirrors DebateRoomService minus session storage)
    # ──────────────────────────────────────────────────────────────────
    def _personas_for_domain(self, domain: str, scenario_context: str) -> list[dict]:
        ids = DOMAIN_PERSONA_MAP.get(domain, DOMAIN_PERSONA_MAP["general"])
        out: list[dict] = []
        for pid in ids:
            try:
                data = self.prompt_engine.load_persona(pid)
                out.append({
                    "id": pid,
                    "name": data.get("name", pid),
                    "role": data.get("role", ""),
                    "system_prompt": self.prompt_engine.render_persona_system_prompt(data, scenario_context),
                })
            except FileNotFoundError:
                out.append({
                    "id": pid,
                    "name": pid.replace("_", " ").title(),
                    "role": "分析师",
                    "system_prompt": (
                        f"你是 {pid.replace('_',' ').title()}。"
                        f"请从你的专业视角分析以下场景：\n{scenario_context}"
                    ),
                })
        return out

    # ──────────────────────────────────────────────────────────────────
    # Run one branch (N rounds, single injection)
    # ──────────────────────────────────────────────────────────────────
    async def _run_branch(
        self,
        seed_topic: str,
        injection: str,
        personas: list[dict],
        rounds: int,
        session_id: str,
        branch_id: str,
        cycle: int,
    ) -> AsyncGenerator[dict, None]:
        """Yield SSE events for one branch and at the end yield a summary dict
        via a special `__branch_done` event the caller can pick up."""
        full_statements: list[dict] = []
        previous_text = ""

        for r in range(1, rounds + 1):
            if self.sessions.get(session_id, {}).get("cancel"):
                return
            for idx, persona in enumerate(personas):
                if self.sessions.get(session_id, {}).get("cancel"):
                    return
                backend = get_backend_for_persona(self.tracker, idx)
                anti_conform = (
                    "\n硬约束（违反则输出无价值）：\n"
                    "  ·  禁止重复任何已被前面 persona 说过的论点 / 例证 / 表述\n"
                    "  ·  你必须挖出一个别人没看到的：反例 / 隐含假设 / 边缘场景 / 反直觉链条\n"
                    "  ·  如果立场与某 persona 相同，必须说明你的论证机制为何更深\n"
                    "  ·  禁用空话：'多极化'、'风险与机遇并存'、'需要平衡'、'各国应加强合作'等一概不要\n"
                    "  ·  ≤280 字，必须包含一个具体可证伪的因果链条\n"
                    if previous_text else
                    "\n要求：≤280 字，必须给出一个可证伪的因果链条 + 一个具体例证或数据。"
                )
                user_prompt = (
                    f"原始假设：{seed_topic}\n"
                    f"{'当前注入事件：' + injection + chr(10) if injection else ''}"
                    f"{'本轮之前发言摘要（你必须超越这些，不重复）：' + chr(10) + previous_text + chr(10) if previous_text else ''}"
                    f"{anti_conform}"
                )
                yield sse_event("auto_persona_start", {
                    "branch_id": branch_id,
                    "round": r,
                    "persona_id": persona["id"],
                    "persona_name": persona["name"],
                    "model": backend.backend_name(),
                })
                chunks: list[str] = []
                async for ch in backend.stream(
                    system_prompt=persona["system_prompt"],
                    messages=[{"role": "user", "content": user_prompt}],
                    max_tokens=600,
                    temperature=0.7,
                ):
                    chunks.append(ch)
                    yield sse_event("auto_persona_chunk", {
                        "branch_id": branch_id,
                        "round": r,
                        "persona_id": persona["id"],
                        "text": ch,
                    })
                content = "".join(chunks)
                full_statements.append({
                    "branch_id": branch_id,
                    "round": r,
                    "persona_id": persona["id"],
                    "persona_name": persona["name"],
                    "content": content,
                })
                yield sse_event("auto_persona_complete", {
                    "branch_id": branch_id,
                    "round": r,
                    "persona_id": persona["id"],
                    "persona_name": persona["name"],
                    "model": backend.backend_name(),
                    "content": content,
                })
            # update inter-round context
            previous_text = "\n".join(
                f"· {s['persona_name']}：{s['content'][:160]}"
                for s in full_statements if s["round"] == r
            )

        # Per-statement summaries (local model — free, parallel)
        async def tagged(s):
            t = await _summarize_one(s["persona_name"], s["content"], self.tracker)
            return s["persona_id"], s["persona_name"], t

        sum_tasks = [asyncio.create_task(tagged(s)) for s in full_statements if s["round"] == rounds]
        persona_summaries: list[dict] = []
        for done in asyncio.as_completed(sum_tasks):
            pid, pname, summary = await done
            persona_summaries.append({"persona_id": pid, "persona_name": pname, "summary": summary})
            yield sse_event("auto_branch_summary", {
                "branch_id": branch_id,
                "persona_id": pid,
                "persona_name": pname,
                "summary": summary,
            })

        # Branch-level evaluation (Sonnet)
        eval_obj = await self._evaluate_branch(seed_topic, injection, full_statements, branch_id)
        yield sse_event("auto_branch_eval", {
            "branch_id": branch_id,
            "cycle": cycle,
            "injection": injection,
            "eval": eval_obj.model_dump() if eval_obj else None,
        })

        # Sentinel event — caller stores branch result (now incl. full statements
        # so the briefing export and persona-evolution view can read them later)
        yield sse_event("__branch_done", {
            "branch_id": branch_id,
            "cycle": cycle,
            "injection": injection,
            "rounds_run": rounds,
            "persona_summaries": persona_summaries,
            "statements": full_statements,
            "eval": eval_obj.model_dump() if eval_obj else None,
        })

    async def _evaluate_branch(
        self,
        seed_topic: str,
        injection: str,
        statements: list[dict],
        branch_id: str,
    ) -> BranchEval | None:
        """Single-branch eval (kept for the baseline branch where no peer comparison exists)."""
        backend = get_judge_backend(self.tracker)
        last_round = max(s["round"] for s in statements)
        latest = [s for s in statements if s["round"] == last_round]
        body = "\n\n".join(f"【{s['persona_name']}】{s['content']}" for s in latest)
        system = (
            "你是一位严苛的辩论裁判。**避免给所有维度打 75/80/65/70 这种平庸中位数** —— "
            "如果论证空洞、重复、流于'多极化/共赢'套话，confidence/coherence 应低于 50。"
            "如果出现真正反直觉、可证伪的洞见，novelty 应高于 80。"
            "严格输出 JSON：{confidence,coherence,novelty,risk_signal: 0..100, "
            "one_line_takeaway: 一句中文不超过 30 字, notable_disagreement: 一句不超过 30 字}。"
        )
        user = (
            f"原假设：{seed_topic}\n"
            f"分支注入事件：{injection or '(无 — 基线分支)'}\n\n"
            f"末轮发言：\n{body}"
        )
        try:
            raw = await backend.complete(
                system_prompt=system,
                messages=[{"role": "user", "content": user}],
                max_tokens=800,
                temperature=0.2,
            )
        except Exception as e:
            logger.error(f"branch eval failed for {branch_id}: {e}")
            return None
        parsed = _extract_json(raw, "object")
        if not isinstance(parsed, dict):
            logger.warning(f"branch eval non-JSON for {branch_id} (len={len(raw or '')}): {(raw or '')[:300]}")
            return None
        def clamp(v, lo=0, hi=100, default=50):
            try: return max(lo, min(hi, int(v)))
            except (TypeError, ValueError): return default
        return BranchEval(
            confidence=clamp(parsed.get("confidence")),
            coherence=clamp(parsed.get("coherence")),
            novelty=clamp(parsed.get("novelty")),
            risk_signal=clamp(parsed.get("risk_signal")),
            one_line_takeaway=str(parsed.get("one_line_takeaway", ""))[:60],
            notable_disagreement=str(parsed.get("notable_disagreement", ""))[:60],
        )

    async def _evaluate_branches_batch(
        self,
        seed_topic: str,
        cycle_branches: list[dict],   # [{branch_id, injection, statements}]
    ) -> dict[str, BranchEval]:
        """Evaluate K branches IN ONE CALL with relative ranking.
        Forces the judge to differentiate them rather than giving all 75/80/65/70.
        """
        backend = get_judge_backend(self.tracker)
        body_blocks = []
        for cb in cycle_branches:
            stmts = cb["statements"]
            if not stmts:
                continue
            last = max(s["round"] for s in stmts)
            latest = [s for s in stmts if s["round"] == last]
            block = (
                f"==== {cb['branch_id']} ====\n"
                f"注入：{cb['injection'] or '(基线)'}\n\n"
                + "\n\n".join(f"【{s['persona_name']}】{s['content']}" for s in latest)
            )
            body_blocks.append(block)

        system = (
            "你是一位严苛裁判，正在**同时**评估 N 个分支辩论的相对优劣。"
            "你的核心任务：**拉开评分差距**。 \n"
            "  · 不允许多个分支拿到完全相同的四维评分组合。\n"
            "  · 在 confidence 维度上，最弱与最强分支至少差 25 分。\n"
            "  · 在 novelty 维度上，找出真正最反直觉的那个分支并显著拉高其分。\n"
            "  · 套话和重复是减分项；可证伪的具体因果链是加分项。\n\n"
            "输出 JSON 数组，每个元素：{branch_id, confidence, coherence, novelty, risk_signal: 0..100, "
            "one_line_takeaway: ≤30字, notable_disagreement: ≤30字, rank_reason: ≤25字相对优劣理由}"
        )
        user = (
            f"原假设：{seed_topic}\n\n"
            f"待评估的 {len(body_blocks)} 个分支：\n\n"
            + "\n\n".join(body_blocks)
            + "\n\n按相对优劣评分，强制拉开差距。仅输出 JSON 数组。"
        )
        try:
            raw = await backend.complete(
                system_prompt=system,
                messages=[{"role": "user", "content": user}],
                max_tokens=2000,
                temperature=0.3,
            )
        except Exception as e:
            logger.error(f"batch eval failed: {e}")
            return {}
        parsed = _extract_json(raw, "array")
        if not isinstance(parsed, list):
            logger.warning(f"batch eval non-JSON (len={len(raw or '')}): {(raw or '')[:300]}")
            return {}

        def clamp(v, lo=0, hi=100, default=50):
            try: return max(lo, min(hi, int(v)))
            except (TypeError, ValueError): return default

        out: dict[str, BranchEval] = {}
        for item in parsed:
            if not isinstance(item, dict):
                continue
            bid = str(item.get("branch_id", "")).strip()
            if not bid:
                continue
            out[bid] = BranchEval(
                confidence=clamp(item.get("confidence")),
                coherence=clamp(item.get("coherence")),
                novelty=clamp(item.get("novelty")),
                risk_signal=clamp(item.get("risk_signal")),
                one_line_takeaway=str(item.get("one_line_takeaway", ""))[:60],
                notable_disagreement=str(item.get("notable_disagreement", ""))[:60],
            )
        return out

    # ──────────────────────────────────────────────────────────────────
    # Cheap-tier injection variant generation (Haiku)
    # ──────────────────────────────────────────────────────────────────
    async def _propose_injections(
        self,
        seed_topic: str,
        existing_branches: list[dict],
        decider_seeds: list[str],
        n: int,
    ) -> list[str]:
        backend = get_cheap_backend(self.tracker)
        existing = "\n".join(f"  - {b.get('injection', '(无)')}" for b in existing_branches[-6:])
        seed_hint = "\n".join(f"  - {s}" for s in decider_seeds[:5]) or "  (无)"
        system = (
            "你是一位创造力极强的情景规划员。任务：为一个假设场景生成 N 个截然不同的"
            "「事件注入」 — 即一个突发事件、外部冲击或反例假设，会显著改变原场景的走向。\n"
            "要求：每条 ≤30 字，立即可用，避免抽象口号。输出 JSON 数组的字符串列表，不要其他内容。"
        )
        user = (
            f"原始假设：{seed_topic}\n\n"
            f"已探索过的注入：\n{existing}\n\n"
            f"决策者的方向提示（如有）：\n{seed_hint}\n\n"
            f"请生成 {n} 个新的、与已探索过的明显不同的注入事件。仅输出 JSON 数组。"
        )
        try:
            raw = await backend.complete(
                system_prompt=system,
                messages=[{"role": "user", "content": user}],
                max_tokens=400,
                temperature=0.9,
            )
        except Exception as e:
            logger.error(f"injection proposal failed: {e}")
            return []
        parsed = _extract_json(raw, "array")
        if not isinstance(parsed, list):
            return []
        out = [str(x).strip()[:80] for x in parsed if isinstance(x, str) and x.strip()]
        return out[:n]

    # ──────────────────────────────────────────────────────────────────
    # Decider tier (Opus) — verdict on what to do next
    # ──────────────────────────────────────────────────────────────────
    async def _decide(
        self,
        seed_topic: str,
        branches: list[dict],
        cycle: int,
        cycles_remaining: int,
        force_premium: bool = False,
    ) -> DeciderVerdict:
        # Cost-aware tier escalation: Sonnet for cycles 1-2 (cheap), Opus only when
        # the stakes are high (cycle ≥3 or judge flagged low confidence).
        from app.core.inference import get_judge_backend as _judge
        if force_premium or cycle >= 3:
            backend = get_decider_backend(self.tracker)  # Opus
        else:
            backend = _judge(self.tracker)               # Sonnet (cheap)
        body = []
        for b in branches:
            ev = b.get("eval") or {}
            body.append(
                f"branch {b['branch_id']}  cycle={b['cycle']}  inject={b.get('injection','—') or '(基线)'}\n"
                f"  conf={ev.get('confidence','?')} coher={ev.get('coherence','?')} "
                f"nov={ev.get('novelty','?')} risk={ev.get('risk_signal','?')}\n"
                f"  takeaway: {ev.get('one_line_takeaway','')}\n"
                f"  disagreement: {ev.get('notable_disagreement','')}"
            )
        system = (
            "你是一位顶级战略分析师。任务：根据已跑过的多个分支辩论结果，决定下一步如何推进探索。\n"
            "可选行动：\n"
            "  - deepen: 选择一个最值得深挖的分支，以它的注入为基础再开支线\n"
            "  - diverge: 跳出当前所有分支，换全新方向\n"
            "  - converge: 已收敛，不必再探，直接进入终评\n\n"
            "严格输出 JSON：{action,target_branch_id,next_injection_seeds: [≤5 条短句],"
            "rationale: 一句中文不超过 60 字, overall_confidence: 0..100}\n"
            "不要其他内容。"
        )
        user = (
            f"原假设：{seed_topic}\n"
            f"已跑 {len(branches)} 分支，剩余 cycle 预算：{cycles_remaining}\n\n"
            "分支结果：\n" + "\n\n".join(body)
        )
        try:
            raw = await backend.complete(
                system_prompt=system,
                messages=[{"role": "user", "content": user}],
                max_tokens=500,
                temperature=0.4,
            )
        except Exception as e:
            logger.error(f"decider failed: {e}")
            return DeciderVerdict(action="diverge", overall_confidence=50, rationale=f"decider error: {e}")
        parsed = _extract_json(raw, "object") or {}
        action = str(parsed.get("action", "diverge"))
        if action not in ("deepen", "diverge", "converge"):
            action = "diverge"
        seeds = [str(x).strip()[:80] for x in parsed.get("next_injection_seeds", []) if isinstance(x, str)]
        return DeciderVerdict(
            action=action,
            target_branch_id=parsed.get("target_branch_id") or None,
            next_injection_seeds=seeds[:5],
            rationale=str(parsed.get("rationale", ""))[:120],
            overall_confidence=max(0, min(100, int(parsed.get("overall_confidence", 50) or 50))),
        )

    # ──────────────────────────────────────────────────────────────────
    # Final meta-synthesis (Opus)
    # ──────────────────────────────────────────────────────────────────
    async def _final_synthesis(self, seed_topic: str, branches: list[dict]) -> str:
        backend = get_decider_backend(self.tracker)
        body = []
        for b in branches:
            ev = b.get("eval") or {}
            body.append(
                f"· {b['branch_id']} (cycle {b['cycle']}): inj={b.get('injection','基线')} | "
                f"conf={ev.get('confidence','?')} | take={ev.get('one_line_takeaway','')}"
            )
        system = (
            "你是一位资深战略分析师，正在为决策者撰写一份"
            "跨多分支推演的终评。要求：800 字以内，分四节 — "
            "1) 核心洞见  2) 不可调和的分歧  3) 高风险信号  4) 决策建议。"
            "中文输出，禁用空话套话。"
        )
        user = f"原假设：{seed_topic}\n\n探索过的所有分支：\n" + "\n".join(body)
        try:
            return await backend.complete(
                system_prompt=system,
                messages=[{"role": "user", "content": user}],
                max_tokens=1500,
                temperature=0.4,
            )
        except Exception as e:
            logger.error(f"final synthesis failed: {e}")
            return f"[终评失败：{e}]"

    # ──────────────────────────────────────────────────────────────────
    # Top-level orchestration
    # ──────────────────────────────────────────────────────────────────
    async def run(self, config: AutonomousDebateConfig) -> AsyncGenerator[dict, None]:
        """Outer wrapper: tee every SSE event to a per-session JSONL log
        for later offline analysis. Inner generator does the actual work.
        """
        session_id_holder: dict[str, str] = {}
        async def inner():
            async for ev in self._run_impl(config, session_id_holder):
                yield ev

        # We don't know session_id until inner yields the first auto_session_start
        # event. Buffer first event, learn id, open log, then start writing.
        gen = inner()
        first_ev = None
        async for ev in gen:
            first_ev = ev
            break
        # Resolve session_id from first event payload
        session_id = (first_ev or {}).get("data", {}).get("session_id") or "unknown"
        log_path = RUN_LOG_DIR / f"{session_id}.jsonl"
        log_fh = log_path.open("w", buffering=1)
        start_ts = time.time()
        def _write(ev: dict):
            try:
                log_fh.write(json.dumps({"t_ms": int((time.time() - start_ts) * 1000), **ev}, ensure_ascii=False) + "\n")
            except Exception:  # log corruption shouldn't break the stream
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

    async def _run_impl(self, config: AutonomousDebateConfig, session_id_holder: dict) -> AsyncGenerator[dict, None]:
        session_id = str(uuid.uuid4())[:8]
        session_id_holder["id"] = session_id
        self.sessions[session_id] = {"cancel": False, "branches": []}
        start_ts = time.time()

        scenario_context = f"假设场景：{config.seed_topic}\n领域：{config.domain}"
        personas = self._personas_for_domain(config.domain, scenario_context)

        yield sse_event("auto_session_start", {
            "session_id": session_id,
            "config": config.model_dump(),
            "personas": [{"id": p["id"], "name": p["name"], "role": p["role"]} for p in personas],
            "started_at": start_ts,
        })

        cycle = 0
        decider_seeds: list[str] = []
        branches: list[dict] = self.sessions[session_id]["branches"]
        stop_reason = "completed"

        # ── Cycle 0: baseline branch (no injection) ──
        branch_id = f"b{cycle}-base"
        async for ev in self._run_branch(
            config.seed_topic, "", personas, config.rounds_per_branch,
            session_id, branch_id, cycle,
        ):
            if ev.get("type") == "__branch_done":
                branches.append(ev["data"])
            else:
                yield ev
        cycle += 1

        # ── Main loop ──
        while True:
            if self.sessions[session_id]["cancel"]:
                stop_reason = "cancelled"
                break
            if cycle > config.max_cycles:
                stop_reason = "max_cycles_reached"
                break
            elapsed = time.time() - start_ts
            if elapsed > config.time_budget_seconds:
                stop_reason = "time_budget_exhausted"
                break
            cost = self.tracker.summary().get("estimated_cost_usd", 0.0)
            if cost > config.cost_budget_usd:
                stop_reason = "cost_budget_exhausted"
                break

            yield sse_event("auto_cycle_start", {
                "cycle": cycle,
                "elapsed_s": int(elapsed),
                "cost_usd": cost,
                "branches_so_far": len(branches),
            })

            # Cheap-tier: propose injections.
            # Pull and consume any user-supplied seeds first — they take priority.
            user_seeds = list(self.sessions[session_id].get("user_seeds", []))
            self.sessions[session_id]["user_seeds"] = []
            yield sse_event("auto_decider_thinking", {"phase": "haiku_injections"})
            generated = await self._propose_injections(
                config.seed_topic, branches,
                decider_seeds + user_seeds,
                max(0, config.branches_per_cycle - len(user_seeds)),
            )
            # Combine: user seeds first (they're explicit asks), then generated
            injections = (user_seeds + generated)[: config.branches_per_cycle]
            if not injections:
                # Retry once before giving up — Haiku sometimes returns no JSON on first try
                yield sse_event("auto_decider_thinking", {"phase": "haiku_retry"})
                generated = await self._propose_injections(
                    config.seed_topic, branches, decider_seeds, config.branches_per_cycle,
                )
                injections = generated[: config.branches_per_cycle]
            if not injections:
                stop_reason = "no_more_variants"
                break
            yield sse_event("auto_injections_proposed", {"cycle": cycle, "injections": injections})

            # Run K branches sequentially (Ollama GPU load makes parallel risky)
            cycle_branch_ids: list[str] = []
            for i, inj in enumerate(injections):
                if self.sessions[session_id]["cancel"]:
                    break
                bid = f"b{cycle}-{i}"
                cycle_branch_ids.append(bid)
                # Allow runtime "kill branch" — skip if user marked it before it ran
                if bid in self.sessions[session_id].get("killed", set()):
                    yield sse_event("auto_branch_skipped", {"branch_id": bid, "reason": "user_killed"})
                    continue
                async for ev in self._run_branch(
                    config.seed_topic, inj, personas, config.rounds_per_branch,
                    session_id, bid, cycle,
                ):
                    if ev.get("type") == "__branch_done":
                        branches.append(ev["data"])
                    else:
                        yield ev
                # Honor mid-branch kill request
                if bid in self.sessions[session_id].get("killed", set()):
                    yield sse_event("auto_branch_killed", {"branch_id": bid})

            # Batch re-eval: judge all just-finished branches together to force
            # discrimination instead of all-75/80/65/70 mediocrity.
            this_cycle_branches = [
                {
                    "branch_id": b["branch_id"],
                    "injection": b.get("injection", ""),
                    "statements": b.get("statements", []),
                }
                for b in branches
                if b["branch_id"] in cycle_branch_ids and b.get("statements")
            ]
            if len(this_cycle_branches) >= 2:
                yield sse_event("auto_decider_thinking", {"phase": "batch_judge"})
                batch_evals = await self._evaluate_branches_batch(
                    config.seed_topic, this_cycle_branches,
                )
                # Merge into branches list and re-emit eval events
                for b in branches:
                    if b["branch_id"] in batch_evals:
                        b["eval"] = batch_evals[b["branch_id"]].model_dump()
                        yield sse_event("auto_branch_eval", {
                            "branch_id": b["branch_id"],
                            "cycle": b["cycle"],
                            "injection": b.get("injection", ""),
                            "eval": b["eval"],
                        })

            # Cost-aware decider: was last cycle's confidence low? → escalate to Opus
            last_decision_low = bool(
                self.sessions[session_id].get("_last_decision_conf", 100) < 70
            )
            yield sse_event("auto_decider_thinking", {
                "phase": "opus_decide" if (cycle >= 3 or last_decision_low) else "sonnet_decide",
            })
            verdict = await self._decide(
                config.seed_topic, branches, cycle, config.max_cycles - cycle,
                force_premium=last_decision_low,
            )
            self.sessions[session_id]["_last_decision_conf"] = verdict.overall_confidence
            yield sse_event("auto_decision", {
                "cycle": cycle,
                "verdict": verdict.model_dump(),
                "elapsed_s": int(time.time() - start_ts),
                "cost_usd": self.tracker.summary().get("estimated_cost_usd", 0.0),
            })

            if verdict.action == "converge" or verdict.overall_confidence >= config.confidence_threshold:
                stop_reason = "converged"
                break
            decider_seeds = verdict.next_injection_seeds or []
            cycle += 1

        # ── Final meta-synthesis ──
        yield sse_event("auto_final_synth_start", {
            "stop_reason": stop_reason,
            "total_branches": len(branches),
        })
        final_text = await self._final_synthesis(config.seed_topic, branches)
        yield sse_event("auto_final_synth", {
            "text": final_text,
            "stop_reason": stop_reason,
            "total_branches": len(branches),
            "elapsed_s": int(time.time() - start_ts),
            "token_usage": self.tracker.summary(),
        })

        yield sse_event("auto_session_end", {
            "session_id": session_id,
            "stop_reason": stop_reason,
        })
