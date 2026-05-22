"""Token usage tracking and cost estimation.

Records every API call with optional tier/phase/cycle context so we can
report (cost × quality) Pareto data per tier and per phase, not just totals.
Existing call sites that pass only (input_tokens, output_tokens, label) keep
working — new fields are optional and inherit from a per-tracker context dict
that auto_loop sets at phase/cycle boundaries.
"""

from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from app.config import get_settings


# Pricing table — loaded lazily and cached so repeated record() calls are cheap.
_PRICING_PATH = Path(__file__).resolve().parent / "pricing.yaml"
_PRICING_CACHE: dict[str, dict] | None = None


def _load_pricing() -> dict[str, dict]:
    """Read pricing.yaml; return a dict keyed by backend_spec, with a 'default'
    fallback entry. Cached after first call. Yaml import is local so the
    module is importable without PyYAML when pricing isn't consulted."""
    global _PRICING_CACHE
    if _PRICING_CACHE is not None:
        return _PRICING_CACHE
    try:
        import yaml
        data = yaml.safe_load(_PRICING_PATH.read_text(encoding="utf-8")) or {}
        if not isinstance(data, dict):
            data = {}
    except Exception:
        data = {}
    _PRICING_CACHE = data
    return data


@dataclass
class TokenRecord:
    """A single API call's token usage. Optional fields default so older
    call sites that don't supply them still produce valid records."""
    input_tokens: int
    output_tokens: int
    label: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    cached_input_tokens: int = 0
    backend_spec: Optional[str] = None        # e.g. "claude:claude-sonnet-4-6"
    tier: Optional[str] = None                # cheap | judge | decider | strong | summarizer | extractor | persona
    phase: Optional[str] = None               # e.g. "cycle_1_debate" | "cycle_2_synthesis" | "stance_extraction"
    cycle: Optional[int] = None
    persona: Optional[str] = None
    cost_usd: float = 0.0
    latency_ms: float = 0.0                   # wall-clock duration of this API call
    error: Optional[str] = None               # non-None means the call failed


class TokenTracker:
    """Tracks token usage across a session and estimates cost.

    Context: callers can `set_context(phase=..., cycle=..., persona=...)`
    once at a phase boundary; subsequent record() calls inherit the context
    unless explicit kwargs override it. tier is set by the InferenceBackend
    that owns the call (passed via `record(tier=...)`).
    """

    def __init__(self):
        self.records: list[TokenRecord] = []
        self._context: dict[str, Any] = {
            "phase": None,
            "cycle": None,
            "persona": None,
        }
        # Run-level LLM seed. Harness sets this before kicking off auto_loop;
        # backends read it and forward to APIs that accept a seed parameter
        # (OpenAI/DeepSeek/Ollama). Anthropic API does not currently expose
        # seed, so Claude calls remain best-effort even when this is set.
        self.llm_seed: int | None = None

    # ---- context management ----------------------------------------------

    def set_context(self, **kwargs) -> None:
        """Update current call context. Pass None to clear a key."""
        for k, v in kwargs.items():
            if k not in {"phase", "cycle", "persona"}:
                continue
            self._context[k] = v

    def clear_context(self) -> None:
        self._context = {"phase": None, "cycle": None, "persona": None}

    # ---- recording -------------------------------------------------------

    def record(
        self,
        input_tokens: int,
        output_tokens: int,
        label: str = "",
        *,
        cached_input_tokens: int = 0,
        backend_spec: Optional[str] = None,
        tier: Optional[str] = None,
        phase: Optional[str] = None,
        cycle: Optional[int] = None,
        persona: Optional[str] = None,
        latency_ms: float = 0.0,
        error: Optional[str] = None,
    ):
        """Record one API call. Explicit kwargs override the tracker context."""
        ctx_phase = phase if phase is not None else self._context.get("phase")
        ctx_cycle = cycle if cycle is not None else self._context.get("cycle")
        ctx_persona = persona if persona is not None else self._context.get("persona")
        rec = TokenRecord(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            label=label,
            cached_input_tokens=cached_input_tokens,
            backend_spec=backend_spec or label or None,
            tier=tier,
            phase=ctx_phase,
            cycle=ctx_cycle,
            persona=ctx_persona,
            latency_ms=latency_ms,
            error=error,
        )
        rec.cost_usd = self._cost_for(rec)
        self.records.append(rec)

    # ---- cost ------------------------------------------------------------

    def _cost_for(self, rec: TokenRecord) -> float:
        """Per-record cost. Looks up pricing.yaml by `backend_spec`; falls
        back to a `default` entry, and ultimately to the legacy flat settings
        rate when neither is configured."""
        pricing = _load_pricing()
        entry: dict | None = None
        if rec.backend_spec and rec.backend_spec in pricing:
            entry = pricing[rec.backend_spec]
        elif "default" in pricing:
            entry = pricing["default"]

        if entry is not None:
            fresh_input = max(0, rec.input_tokens - rec.cached_input_tokens)
            in_cost = fresh_input * float(entry.get("input_per_token", 0.0))
            cache_cost = rec.cached_input_tokens * float(entry.get("cached_input_per_token", 0.0))
            out_cost = rec.output_tokens * float(entry.get("output_per_token", 0.0))
            return round(in_cost + cache_cost + out_cost, 6)

        settings = get_settings()
        in_cost = (rec.input_tokens / 1_000_000) * settings.cost_per_million_input_tokens
        out_cost = (rec.output_tokens / 1_000_000) * settings.cost_per_million_output_tokens
        return round(in_cost + out_cost, 6)

    def total_input_tokens(self) -> int:
        return sum(r.input_tokens for r in self.records)

    def total_output_tokens(self) -> int:
        return sum(r.output_tokens for r in self.records)

    def total_cached_input_tokens(self) -> int:
        return sum(r.cached_input_tokens for r in self.records)

    def estimated_cost_usd(self) -> float:
        return round(sum(r.cost_usd for r in self.records), 4)

    # ---- aggregations (Y1) -----------------------------------------------

    def _aggregate_by(self, key_fn) -> dict[str, dict]:
        groups: dict[str, dict] = defaultdict(
            lambda: {
                "input_tokens": 0,
                "output_tokens": 0,
                "cached_input_tokens": 0,
                "cost_usd": 0.0,
                "api_calls": 0,
            }
        )
        for r in self.records:
            k = key_fn(r)
            if k is None:
                k = "unknown"
            k = str(k)
            g = groups[k]
            g["input_tokens"] += r.input_tokens
            g["output_tokens"] += r.output_tokens
            g["cached_input_tokens"] += r.cached_input_tokens
            g["cost_usd"] += r.cost_usd
            g["api_calls"] += 1
        for g in groups.values():
            g["cost_usd"] = round(g["cost_usd"], 6)
        return dict(groups)

    def by_tier(self) -> dict[str, dict]:
        return self._aggregate_by(lambda r: r.tier)

    def by_phase(self) -> dict[str, dict]:
        return self._aggregate_by(lambda r: r.phase)

    def by_cycle(self) -> dict[str, dict]:
        return self._aggregate_by(lambda r: r.cycle)

    def by_persona(self) -> dict[str, dict]:
        return self._aggregate_by(lambda r: r.persona)

    def by_backend(self) -> dict[str, dict]:
        return self._aggregate_by(lambda r: r.backend_spec)

    def latency_by(self, key_fn) -> dict[str, dict]:
        """For each group, return latency stats: count, avg_ms, p50_ms, p95_ms,
        max_ms, error_count. Ignores zero-latency records (unintrumented calls)."""
        groups: dict[str, list[float]] = defaultdict(list)
        error_groups: dict[str, int] = defaultdict(int)
        for r in self.records:
            k = key_fn(r)
            if k is None:
                k = "unknown"
            k = str(k)
            if r.error is not None:
                error_groups[k] += 1
            if r.latency_ms > 0:
                groups[k].append(r.latency_ms)

        out: dict[str, dict] = {}
        for k, latencies in groups.items():
            latencies_sorted = sorted(latencies)
            n = len(latencies_sorted)
            out[k] = {
                "count": n,
                "avg_ms": round(sum(latencies_sorted) / n, 1),
                "p50_ms": round(latencies_sorted[n // 2], 1),
                "p95_ms": round(latencies_sorted[min(n - 1, int(n * 0.95))], 1),
                "max_ms": round(latencies_sorted[-1], 1),
                "error_count": error_groups.get(k, 0),
            }
        # Also surface groups that only had errors (no latencies)
        for k, ec in error_groups.items():
            if k not in out:
                out[k] = {
                    "count": 0, "avg_ms": 0.0, "p50_ms": 0.0,
                    "p95_ms": 0.0, "max_ms": 0.0, "error_count": ec,
                }
        return out

    def latency_by_backend(self) -> dict[str, dict]:
        return self.latency_by(lambda r: r.backend_spec)

    def latency_by_phase(self) -> dict[str, dict]:
        return self.latency_by(lambda r: r.phase)

    # ---- summary ---------------------------------------------------------

    def summary(self) -> dict:
        return {
            "total_input_tokens": self.total_input_tokens(),
            "total_output_tokens": self.total_output_tokens(),
            "total_cached_input_tokens": self.total_cached_input_tokens(),
            "total_api_calls": len(self.records),
            "estimated_cost_usd": self.estimated_cost_usd(),
            "by_tier": self.by_tier(),
            "by_phase": self.by_phase(),
            "by_cycle": self.by_cycle(),
            "by_persona": self.by_persona(),
            "records": [asdict(r) for r in self.records],
        }

    def reset(self):
        self.records.clear()
        self.clear_context()
