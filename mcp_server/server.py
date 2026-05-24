"""What-If MCP server — exposes the philosophical-debate engine as MCP tools
so any MCP-compatible client (Claude Desktop, Claude Code, Cursor, etc.) can
invoke it as a sub-tool.

Why an MCP server: the auto-loop / persona endpoints are too rich to leave
behind a single HTTP boundary. MCP lets another agent say "use the What-If
tool to run a 3-cycle philosophical debate on AGI governance" — and the
tool returns a structured result the calling agent can reason over.

This server is a thin HTTP proxy over the existing FastAPI backend.
Requires the backend running at WHATIF_BACKEND_URL (default
http://localhost:8000).

Install (one-time):
    pip install mcp httpx

Run (stdio transport, default for Claude Desktop / Code):
    python -m mcp_server.server

Or via the MCP CLI:
    mcp install mcp_server/server.py --name what-if

Then in Claude Desktop config (~/Library/Application Support/Claude/claude_desktop_config.json):
    {
      "mcpServers": {
        "what-if": {
          "command": "python",
          "args": ["-m", "mcp_server.server"],
          "env": {"WHATIF_BACKEND_URL": "http://localhost:8000"}
        }
      }
    }
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx

try:
    from mcp.server.fastmcp import FastMCP
except ImportError as e:
    raise SystemExit(
        "mcp package not installed. Run: pip install mcp httpx\n"
        f"Original error: {e}"
    )


BACKEND_URL = os.environ.get("WHATIF_BACKEND_URL", "http://localhost:8000").rstrip("/")
TIMEOUT = float(os.environ.get("WHATIF_MCP_TIMEOUT", "300"))


mcp = FastMCP(
    name="what-if",
    instructions=(
        "Multi-LLM philosophical debate engine. Five philosophical traditions "
        "(rationalist, existentialist, pragmatist, eastern, critical theorist) "
        "argue a question across multiple cycles, with synthesis and structured "
        "verdicts. Persists every session for cross-session bias analysis and "
        "concept evolution tracking."
    ),
)


async def _post(path: str, json_body: dict[str, Any]) -> dict:
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.post(f"{BACKEND_URL}{path}", json=json_body)
        r.raise_for_status()
        return r.json()


async def _get(path: str, params: dict[str, Any] | None = None) -> dict:
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.get(f"{BACKEND_URL}{path}", params=params or {})
        r.raise_for_status()
        return r.json()


# ────────────────────────────────────────────────────────────────────
# Tools
# ────────────────────────────────────────────────────────────────────


@mcp.tool()
async def philosophical_debate(
    question: str,
    cycles: int = 3,
    judge_verdict: bool = True,
    fact_check: bool = False,
    self_contradict: bool = False,
    future_perspective: bool = False,
) -> str:
    """Run a multi-cycle philosophical debate on a question.

    Five philosophical traditions argue, synthesize, and (optionally) issue
    structured verdicts. Returns the full session including per-cycle
    persona statements, synthesis, and verdicts.

    Use this when you want plural perspectives on an open-ended philosophical
    or policy question — not for factual lookups.

    Args:
        question: The question to debate (e.g. "Is free will compatible with determinism?").
        cycles: Number of debate cycles (1-10; default 3). Each cycle is full debate + synthesis.
        judge_verdict: If true, after each synthesis a judge LLM gives explicit verdicts
            on contested points with winner + confidence.
        fact_check: If true, every persona statement gets plausibility-checked for
            empirical claims (certain/uncertain/likely_wrong/unverifiable).
        self_contradict: If true, every persona must also write the strongest
            counter-argument against its own position + why they still hold it.
        future_perspective: If true, every persona answers as its 2050 self looking
            back at 2026, surfacing blind spots from the future.

    Returns: full session JSON including session_id (use it with `get_session_detail`).
    """
    cycles = max(1, min(int(cycles), 10))
    payload = {
        "seed_hypothesis": question,
        "mode": "philosophical",
        "max_cycles": cycles,
        "judge_verdict": bool(judge_verdict),
        "fact_check": bool(fact_check),
        "self_contradict": bool(self_contradict),
        "future_perspective": bool(future_perspective),
    }
    # The backend streams SSE; for the MCP boundary we want a single
    # synchronous result. We poll the bus until completion.
    import uuid as _uuid
    # Forward the request, then read all SSE events into a single response.
    # Easiest: open the SSE stream, drain it, then fetch the persisted session.
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        async with client.stream("POST", f"{BACKEND_URL}/api/orchestrator/auto-loop", json=payload) as resp:
            resp.raise_for_status()
            session_id: str | None = None
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                try:
                    data = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue
                if not session_id and isinstance(data, dict) and data.get("session_id"):
                    session_id = data["session_id"]
                # Drain the rest; we'll fetch the persisted session below.
            if not session_id:
                return json.dumps({"error": "session_id never appeared in stream"}, ensure_ascii=False)

    # Now fetch the persisted full session from the archive.
    detail = await _get(f"/api/sessions/{session_id}")
    return json.dumps(detail, ensure_ascii=False, indent=2)


@mcp.tool()
async def list_recent_sessions(limit: int = 10, query: str = "") -> str:
    """List recently completed philosophical-debate sessions, newest first.

    Args:
        limit: How many to return (default 10, max 100).
        query: Optional search string — matches against hypotheses, persona
            statements, and synthesis. Works for both ASCII (FTS5) and CJK
            (substring LIKE).

    Returns: JSON list of session summaries (session_id, seed_hypothesis,
    cycle_count, total_cost_usd, stopped_reason, created_at).
    """
    params: dict[str, Any] = {"limit": max(1, min(int(limit), 100))}
    if query.strip():
        params["q"] = query.strip()
    result = await _get("/api/sessions", params=params)
    return json.dumps(result, ensure_ascii=False, indent=2)


@mcp.tool()
async def get_session_detail(session_id: str) -> str:
    """Fetch the full persisted session: cycles, persona statements (with
    falsifiability lines and dogmatic flags), judge verdicts, final synthesis.

    Args:
        session_id: The 8-character session id returned by `philosophical_debate`
            or `list_recent_sessions`.
    """
    detail = await _get(f"/api/sessions/{session_id}")
    return json.dumps(detail, ensure_ascii=False, indent=2)


@mcp.tool()
async def compare_persona_across_models(question: str, persona_id: str) -> str:
    """Run the same persona's system prompt against three model providers
    (Claude / GPT-5 / DeepSeek) on the same question, returning all three
    responses for comparison. Useful for understanding how each model's
    internal philosophical biases shape its persona reading.

    Args:
        question: The question to ask.
        persona_id: One of rationalist | existentialist | pragmatist |
            eastern_philosopher | critical_theorist | adversary | virtue_ethicist |
            utilitarian | feminist_theorist | religious_traditionalist |
            complexity_theorist.
    """
    payload = {"persona_id": persona_id, "question": question}
    result = await _post("/api/orchestrator/persona/compare", payload)
    return json.dumps(result, ensure_ascii=False, indent=2)


@mcp.tool()
async def find_structural_analogies(topic: str) -> str:
    """Find 3-5 historical / cross-domain cases that are structurally
    analogous to the given topic. Useful for activating analogical reasoning
    on novel problems (e.g. "AGI governance" → "early radio spectrum
    allocation" + "industrial labor law 1880s" + ...).

    Args:
        topic: The current topic / question.
    """
    payload = {"topic": topic}
    result = await _post("/api/orchestrator/topic/analogies", payload)
    return json.dumps(result, ensure_ascii=False, indent=2)


@mcp.tool()
async def extract_recurring_concepts(limit: int = 20) -> str:
    """Run cross-session concept extraction over recent debates. Returns
    the core philosophical concepts that have recurred across multiple
    sessions, with brief gloss + which sessions discussed each.

    Args:
        limit: How many recent sessions to include (default 20, max 40).
    """
    payload = {"limit": max(3, min(int(limit), 40))}
    result = await _post("/api/sessions/_concepts", payload)
    return json.dumps(result, ensure_ascii=False, indent=2)


# ────────────────────────────────────────────────────────────────────
# Resources — let MCP clients pull static data via resource:// URIs.
# ────────────────────────────────────────────────────────────────────


@mcp.resource("whatif://personas")
async def list_personas_resource() -> str:
    """Built-in persona registry — id, name, role, default system prompt.
    Useful for introspecting what personas are available before invoking
    `philosophical_debate` or `compare_persona_across_models`."""
    data = await _get("/api/orchestrator/personas")
    return json.dumps(data, ensure_ascii=False, indent=2)


@mcp.resource("whatif://stats")
async def session_stats_resource() -> str:
    """Cross-session aggregate stats — how many sessions persisted,
    average cycle count, per-persona dogmatic rates, etc."""
    data = await _get("/api/sessions/_stats")
    return json.dumps(data, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    mcp.run()
