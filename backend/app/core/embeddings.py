"""OpenAI-compatible embeddings client.

Used by B1 baseline (R3 spec) to merge synonym arguments before aggregating
across temperature samples, and reusable for any other place we need
sentence embeddings (e.g. future per-cell synonym detection in the human
eval pipeline).

Stays separate from `inference.py` because that file's `InferenceBackend`
protocol is chat-completion-shaped; embeddings are a different endpoint.
"""
from __future__ import annotations

import logging
import math
from typing import Awaitable, Callable, Iterable, Sequence

from app.config import get_settings

logger = logging.getLogger(__name__)

# A callable that maps texts -> list of unit-length-or-not vectors. The
# embed_texts default below produces real OpenAI embeddings; tests inject
# their own callable that returns deterministic synthetic vectors.
EmbedFn = Callable[[Sequence[str]], Awaitable[list[list[float]]]]


# ──────────────────────────────────────────────────────────────────────
# Real embedding client (OpenAI / OpenAI-compatible)
# ──────────────────────────────────────────────────────────────────────


async def embed_texts(
    texts: Sequence[str],
    model: str = "text-embedding-3-small",
    *,
    provider: str = "openai",
    base_url: str | None = None,
    api_key: str | None = None,
) -> list[list[float]]:
    """Dispatch to the right embeddings endpoint based on `provider`.

    Supported providers:
      - openai (default): OpenAI-compatible `/embeddings` (also works for
        DeepSeek, GLM, etc. — pass `provider="deepseek"` or "glm" with the
        corresponding model id).
      - ollama: local Ollama `/api/embed` (no API key required). Use this
        for fully-local scale-up sweeps; recommended models are
        `nomic-embed-text` (768-d, fast) or `bge-large` (1024-d, multilingual).

    Returns one vector per non-empty input; empty strings are dropped so
    the caller is responsible for matching outputs back to the non-empty
    subset.
    """
    cleaned = [t for t in texts if isinstance(t, str) and t.strip()]
    if not cleaned:
        return []

    provider_lc = (provider or "openai").lower()
    if provider_lc == "ollama":
        return await _embed_ollama(cleaned, model=model, base_url=base_url)
    return await _embed_openai_compatible(
        cleaned, model=model, provider=provider_lc,
        base_url=base_url, api_key=api_key,
    )


async def _embed_openai_compatible(
    cleaned: list[str], *, model: str, provider: str,
    base_url: str | None, api_key: str | None,
) -> list[list[float]]:
    import httpx
    settings = get_settings()
    if api_key is None:
        api_key = getattr(settings, f"{provider}_api_key", "") or ""
    if base_url is None:
        base_url = getattr(settings, f"{provider}_base_url", "") or "https://api.openai.com/v1"
    base_url = base_url.rstrip("/")
    if not api_key:
        raise RuntimeError(
            f"embed_texts: missing api key for provider '{provider}'. "
            f"Set {provider.upper()}_API_KEY in .env or pass api_key explicitly."
        )

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{base_url}/embeddings",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={"model": model, "input": cleaned},
        )
        if resp.status_code >= 400:
            body = resp.text[:600]
            logger.error("%s embeddings %s HTTP %s: %s", provider, model, resp.status_code, body)
            resp.raise_for_status()
        data = resp.json()
    items = data.get("data") or []
    return [item["embedding"] for item in items]


async def _embed_ollama(
    cleaned: list[str], *, model: str, base_url: str | None,
) -> list[list[float]]:
    """Call Ollama's `/api/embed`. Ollama accepts either a single `prompt`
    string or a list `input` for batch; we always use the list form."""
    import httpx
    settings = get_settings()
    if base_url is None:
        base_url = getattr(settings, "ollama_base_url", "") or "http://localhost:11434"
    url = base_url.rstrip("/")
    if not url.startswith(("http://", "https://")):
        url = "http://localhost:11434"

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{url}/api/embed",
            json={"model": model, "input": cleaned},
        )
        if resp.status_code >= 400:
            body = resp.text[:600]
            logger.error("ollama embeddings %s HTTP %s: %s", model, resp.status_code, body)
            resp.raise_for_status()
        data = resp.json()

    # Ollama returns {"embeddings": [[...], [...]]} for list input
    embeddings = data.get("embeddings")
    if embeddings is None:
        # Single-prompt fallback: {"embedding": [...]}
        single = data.get("embedding")
        if single is None:
            raise RuntimeError(f"ollama /api/embed returned unexpected shape: {list(data)}")
        return [single]
    return list(embeddings)


# ──────────────────────────────────────────────────────────────────────
# Pure clustering — no network
# ──────────────────────────────────────────────────────────────────────


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def cluster_by_cosine(
    vectors: Sequence[Sequence[float]],
    threshold: float = 0.85,
) -> list[list[int]]:
    """Greedy single-link clustering. Each item joins the existing cluster
    whose **mean centroid** has cosine ≥ threshold; otherwise opens a new
    cluster. Order matters (first-seen wins ties); for deterministic
    behavior across runs, sort the input texts before passing.

    Returns list of clusters, each a list of indices into `vectors`.
    """
    clusters: list[list[int]] = []
    centroids: list[list[float]] = []
    counts: list[int] = []
    for i, v in enumerate(vectors):
        v_list = list(v)
        best_c = -1
        best_sim = -1.0
        for cidx, centroid in enumerate(centroids):
            s = _cosine(v_list, centroid)
            if s > best_sim:
                best_sim = s
                best_c = cidx
        if best_c >= 0 and best_sim >= threshold:
            cnt = counts[best_c]
            centroids[best_c] = [
                (centroids[best_c][j] * cnt + v_list[j]) / (cnt + 1)
                for j in range(len(v_list))
            ]
            counts[best_c] = cnt + 1
            clusters[best_c].append(i)
        else:
            centroids.append(v_list)
            counts.append(1)
            clusters.append([i])
    return clusters


def pick_canonical(args: Sequence[str], cluster_indices: Sequence[int]) -> str:
    """For a cluster of synonym arguments, pick the one to display.

    Heuristic: shortest by character count, ties broken by first-seen index.
    Short labels are usually the most generic / readable form (e.g. "Cost
    matters" beats "Cost considerations are paramount"). For Chinese it also
    favors the most compact phrasing.
    """
    if not cluster_indices:
        return ""
    idx = min(cluster_indices, key=lambda i: (len(args[i]), i))
    return args[idx]
