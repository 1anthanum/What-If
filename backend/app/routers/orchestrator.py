"""API routes for the Cross-Module Feedback Loop (Orchestrator) and Auto-Loop."""

from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException
from app.services.orchestrator import OrchestratorService
from app.services.auto_loop import AutoLoopScheduler
from app.services.autonomous_debate import AutonomousDebateService
from app.core.streaming import create_sse_response
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

    return create_sse_response(
        _auto_loop.run(
            seed_hypothesis=req.seed_hypothesis,
            max_cycles=req.max_cycles,
            mode=req.mode,
            event_id=req.event_id,
            max_iterations_per_loop=req.max_iterations_per_loop,
            time_horizon=req.time_horizon,
            adversarial=req.adversarial,
            extract_stances=req.extract_stances,
            branching=req.branching,
        )
    )


@router.post("/auto-loop/{session_id}/cancel")
async def cancel_auto_loop(session_id: str):
    """Cancel a running auto-loop session."""
    AutoLoopScheduler.cancel(session_id)
    return {"status": "cancellation_requested", "session_id": session_id}


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
