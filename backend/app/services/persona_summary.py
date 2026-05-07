"""Per-statement core-takeaway summarization, run on a local Ollama model.

Compresses each persona's full response down to a single sentence (≤40 字)
so the right-side dock can show all 5 personas' positions at a glance.

Runs in parallel with asyncio.gather — independent of the strong/judge
backend, so summaries are free (local) and don't block Claude budget.
"""

import asyncio
import logging

from app.core.inference import get_summarizer_backend
from app.core.token_tracker import TokenTracker

logger = logging.getLogger(__name__)

SUMMARY_SYSTEM = (
    "你是一位精炼的辩论速记员。任务：把一段较长的 persona 发言压缩成一句话核心观点。\n"
    "要求：\n"
    "  ·  ≤40 个汉字\n"
    "  ·  保留 persona 的立场动词（支持 / 反对 / 警告 / 提议 …）\n"
    "  ·  不要旁白、不加引号、不要「该 persona 认为」等套话\n"
    "  ·  直接输出那一句话，不要任何前后缀"
)


async def _summarize_one(
    persona_name: str,
    content: str,
    tracker: TokenTracker,
) -> str:
    backend = get_summarizer_backend(tracker)
    user = (
        f"persona：{persona_name}\n\n"
        f"原发言：\n{content.strip()}\n\n"
        "压缩为一句话核心观点："
    )
    try:
        out = await backend.complete(
            system_prompt=SUMMARY_SYSTEM,
            messages=[{"role": "user", "content": user}],
            max_tokens=120,
            temperature=0.2,
        )
        # Strip quotes/whitespace/leading bullets the model sometimes adds
        out = out.strip().strip("「」\"'·•-—").strip()
        # Trim to ~50 chars (some safety beyond 40)
        if len(out) > 60:
            out = out[:60].rstrip("，。；,;.") + "…"
        return out
    except Exception as e:
        logger.error(f"Summarize failed for {persona_name}: {e}")
        return ""


async def summarize_statements_concurrent(
    statements: list[dict],
    tracker: TokenTracker,
) -> list[tuple[str, str]]:
    """Summarize all statements in parallel. Returns [(persona_id, summary), ...]."""
    tasks = [
        _summarize_one(s.get("persona_name", ""), s.get("content", ""), tracker)
        for s in statements
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    out: list[tuple[str, str]] = []
    for s, r in zip(statements, results):
        text = r if isinstance(r, str) else ""
        out.append((s["persona_id"], text))
    return out
