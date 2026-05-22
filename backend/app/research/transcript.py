"""Canonical transcript serialization for stance extraction.

Spec: ../../../../What-If-paper/methodology/R2_stance_extractor.md

The stance extractor must accept arbitrary debate transcripts (not just
structures produced by AutoLoopScheduler), so we serialize the in-memory
response list to a stable string format. Same transcript bytes must always
produce the same StanceMatrix (modulo LLM stochasticity), so the format is
deterministic — no timestamps, no ordering by other than (cycle, list_idx).
"""
from __future__ import annotations
from typing import Iterable


def format_transcript(
    responses: Iterable[dict],
    *,
    question: str | None = None,
    cycle_label: str | None = None,
) -> str:
    """Render a list of persona response dicts to canonical transcript form.

    Each response must have keys `persona_id` and `content`; `persona_name`
    is optional and used for the header if present.

    Output looks like::

        === Cycle <n> ===

        [<persona_id>]
        <text>

        [<persona_id>]
        <text>

    If `cycle_label` is omitted the cycle header is skipped (single-cycle
    transcripts read more naturally without it). If `question` is given it
    appears as the first line so the extractor sees the framing.
    """
    parts: list[str] = []
    if question:
        parts.append(f"问题: {question}")
        parts.append("")
    if cycle_label:
        parts.append(f"=== {cycle_label} ===")
        parts.append("")
    for r in responses:
        if "persona_id" not in r or "content" not in r:
            raise ValueError(
                f"response missing required keys (persona_id, content): {sorted(r.keys())}"
            )
        header_id = r["persona_id"]
        content = (r.get("content") or "").strip()
        if not content:
            continue
        parts.append(f"[{header_id}]")
        parts.append(content)
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"
