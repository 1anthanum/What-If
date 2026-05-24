"""Classical-text RAG (lightweight) — loads a curated corpus of 10
philosophers × 5-8 passages each from
``app/data/classics/corpora.json`` and exposes:

- ``list_thinkers()``      — all available thinker metadata
- ``get_thinker(id)``      — full thinker + passages
- ``retrieve(thinker_id, query, top_k=3)``
                            — naive but effective relevance retrieval:
                              ranks passages by `topic` overlap with
                              tokens / phrases in the query, then by
                              substring match. No embeddings needed —
                              corpus per thinker is small (5-8 items),
                              so simple scoring beats overhead.

Used by the philosophical auto-loop when a persona is configured as a
specific historical thinker (via persona_overrides). The retrieved
passages get injected into the persona's system prompt so the LLM
can cite them naturally.
"""

from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

CORPUS_PATH = Path(__file__).resolve().parent.parent / "data" / "classics" / "corpora.json"


@lru_cache(maxsize=1)
def _load_corpus() -> dict[str, Any]:
    if not CORPUS_PATH.exists():
        logger.warning("classics corpus not found at %s", CORPUS_PATH)
        return {"thinkers": []}
    try:
        return json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        logger.exception("failed to load classics corpus: %s", e)
        return {"thinkers": []}


def list_thinkers() -> list[dict]:
    """Return public metadata for each available thinker."""
    data = _load_corpus()
    return [
        {
            "id": t["id"],
            "name": t["name"],
            "name_en": t.get("name_en", ""),
            "tradition": t.get("tradition", ""),
            "method_hint": t.get("method_hint", ""),
            "passage_count": len(t.get("passages", [])),
        }
        for t in data.get("thinkers", [])
    ]


def get_thinker(thinker_id: str) -> dict | None:
    """Return the full thinker record (including passages), or None."""
    data = _load_corpus()
    return next((t for t in data.get("thinkers", []) if t["id"] == thinker_id), None)


def _tokenize_zh(text: str) -> set[str]:
    """Cheap Chinese-friendly tokenizer: extracts 1-char and 2-char
    grams + alphanumeric words. Adequate for topic-overlap scoring
    against a tiny corpus."""
    out: set[str] = set()
    text = text.lower()
    # ASCII words
    for w in re.findall(r"[a-z0-9_]+", text):
        if len(w) >= 2:
            out.add(w)
    # Chinese chars + bigrams
    han = re.findall(r"[一-鿿]", text)
    for ch in han:
        out.add(ch)
    for a, b in zip(han, han[1:]):
        out.add(a + b)
    return out


def retrieve(thinker_id: str, query: str, top_k: int = 3) -> list[dict]:
    """Rank passages by relevance to query. Returns top_k passages with
    each augmented with a relevance score 0-1.

    Scoring (simple, effective for tiny corpora):
    - +5 per `topic` keyword that appears in the query
    - +1 per token overlap between query and passage text
    """
    thinker = get_thinker(thinker_id)
    if not thinker:
        return []
    passages = thinker.get("passages", [])
    if not passages:
        return []

    q_tokens = _tokenize_zh(query)
    scored: list[tuple[int, dict]] = []
    for p in passages:
        score = 0
        for topic in (p.get("topic") or []):
            if topic in query or any(t in q_tokens for t in _tokenize_zh(topic)):
                score += 5
        p_tokens = _tokenize_zh(p.get("text", ""))
        score += len(q_tokens & p_tokens)
        scored.append((score, p))

    scored.sort(key=lambda x: x[0], reverse=True)
    # Normalize: best score → 1.0; if best is 0, all are 0
    if scored and scored[0][0] > 0:
        best = scored[0][0]
        out = []
        for s, p in scored[:top_k]:
            out.append({**p, "relevance": round(s / best, 2)})
        return out
    # No matches → return first top_k anyway (so RAG never returns empty)
    return [{**p, "relevance": 0.0} for _, p in scored[:top_k]]


def render_passages_for_prompt(passages: list[dict]) -> str:
    """Format retrieved passages into a system-prompt insert."""
    if not passages:
        return ""
    lines = ["", "## 你的传统文本（可在论证时引用，注明出处）"]
    for p in passages:
        rel = p.get("relevance", 0)
        rel_chip = f" (匹配度 {rel:.0%})" if rel > 0 else ""
        lines.append(f"\n**{p['source']}**{rel_chip}")
        lines.append(p["text"])
    lines.append(
        "\n要求：在你的论证中**至少引用一段**上述文本（用引号 + 出处），"
        "并基于此延伸 / 现代化你的立场。如果检索到的段落都不直接相关，"
        "可以诚实指出「相关传统文本不在此」再用你自己的话回答。"
    )
    return "\n".join(lines)


def thinker_persona_prompt(thinker_id: str, query: str | None = None,
                           top_k: int = 3) -> dict | None:
    """Generate a full persona system prompt for a specific historical
    thinker. The result is suitable for use as a persona_override.

    Returns: {persona_id, name, system_prompt, passages_used} or None.
    """
    thinker = get_thinker(thinker_id)
    if not thinker:
        return None
    passages = retrieve(thinker_id, query or "", top_k=top_k) if query else thinker.get("passages", [])[:top_k]
    base = (
        f"你正在扮演**{thinker['name']}**（{thinker.get('name_en','')}），一位"
        f"{thinker.get('tradition', '')}传统的思想家。你的方法论："
        f"{thinker.get('method_hint','')}。\n\n"
        f"保持这位思想家的：(a) 核心概念，(b) 论证风格，(c) 时代敏感性"
        f"（不要谈论他时代之后的事件，除非作为推论），(d) 学术诚实"
        f"（你不会假装知道他没写过的事）。中文回答，300 字以内。"
    )
    return {
        "persona_id": thinker_id,
        "name": thinker["name"],
        "name_en": thinker.get("name_en", ""),
        "system_prompt": base + render_passages_for_prompt(passages),
        "passages_used": passages,
    }
