"""Standalone stance extraction module.

Spec: ../../../../What-If-paper/methodology/R2_stance_extractor.md

Decoupled from AutoLoopScheduler so the function can be:
1. Called on **any** debate transcript (replay, human debate, competitor system output)
2. Backed by **any** InferenceBackend (Y3 cross-extractor reliability)
3. Configured per-call (Y4 ablation switches)
4. Versioned via prompt_registry (Y2)

The legacy `phil_stance_matrix` SSE event payload shape — `{"arguments": [...],
"stances": {persona_id: [score, ...]}}` — is preserved through
`extract_stance_legacy()` so frontend rendering does not break.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from app.core.inference import InferenceBackend
from app.core.prompt_registry import load_prompt

logger = logging.getLogger(__name__)


class StanceExtractionError(Exception):
    """Raised when the LLM response cannot be parsed into a StanceMatrix.

    Carries the raw text and parse error for diagnosis. Avoids silent
    fallback to empty matrix (which the old `_extract_stance_matrix` did),
    so harness runs surface extraction failures instead of hiding them.
    """

    def __init__(self, raw: str, parse_error: str):
        super().__init__(f"stance extraction failed: {parse_error}")
        self.raw = raw
        self.parse_error = parse_error


@dataclass(frozen=True)
class StanceCell:
    persona: str
    argument: str
    score: float                # -1.0 (oppose) to +1.0 (support); 0 = neutral / not addressed
    confidence: float = 1.0


@dataclass
class StanceMatrix:
    """Persona × argument stance map. arguments and personas list the labels
    in the order the extractor produced them; cells contains every populated
    (persona, argument) entry."""
    question: str
    arguments: list[str]
    personas: list[str]
    cells: dict[tuple[str, str], StanceCell]
    extractor_meta: dict = field(default_factory=dict)

    def score(self, persona: str, argument: str) -> float:
        """Return score for (persona, argument), 0.0 if cell missing."""
        c = self.cells.get((persona, argument))
        return c.score if c else 0.0

    def to_legacy_dict(self) -> dict:
        """Render in the historic phil_stance_matrix SSE payload shape so
        frontend rendering and existing JSONL consumers do not break."""
        scores: dict[str, list[float]] = {p: [] for p in self.personas}
        for p in self.personas:
            for a in self.arguments:
                scores[p].append(self.score(p, a))
        return {"arguments": list(self.arguments), "stances": scores}


@dataclass(frozen=True)
class ExtractorConfig:
    """Knobs for Y4 ablation. `prompt_version_dir` selects the directory
    under backend/app/data/prompts/ (e.g. "v1"); `prompt_name` is the
    single-pass extractor's filename stem.

    show_persona_names: when False, transcripts get persona ids replaced by
        anonymous tags before extraction. Used to test whether the extractor
        leans on labels instead of content (S1).

    two_step: when True, the extractor first prompts for argument list using
        `step1_prompt_name`, then for scores using `step2_prompt_name`.
        Decouples argument generation from scoring (S2).

    arguments: when not None, fix the argument set instead of letting the
        model propose; only scoring is requested. Reuses `step2_prompt_name` (S4).

    cycle_filter: when set, the caller is responsible for passing a transcript
        that only includes responses matching this filter (e.g. "cycle_2_only").
        Recorded in extractor_meta so reviewers can audit which cycle slice
        the matrix was extracted from (S5).
    """
    prompt_name: str = "stance_extractor"
    step1_prompt_name: str = "stance_extractor_step1_args"
    step2_prompt_name: str = "stance_extractor_step2_scores"
    prompt_version_dir: str = "v1"
    show_persona_names: bool = True
    two_step: bool = False
    temperature: float = 0.2
    max_tokens: int = 800
    arguments: list[str] | None = None
    cycle_filter: str | None = None    # informational; transcript filtering done by caller


# ──────────────────────────────────────────────────────────────────────
# Internal helpers
# ──────────────────────────────────────────────────────────────────────


def _strip_code_fence(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        # Drop opening fence (with optional language tag) + closing fence
        try:
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        except IndexError:
            pass
    return raw


def _parse_arguments_only(raw: str) -> list[str]:
    """Parse step-1 (two-step extraction) response: {"arguments": [...]}.

    Tolerates the model accidentally including a `stances` field — we just
    ignore everything except `arguments`.
    """
    cleaned = _strip_code_fence(raw)
    try:
        obj = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise StanceExtractionError(raw, f"step1 JSONDecodeError: {e}")
    if not isinstance(obj, dict) or "arguments" not in obj:
        raise StanceExtractionError(
            raw, f"step1 missing 'arguments' key; got {sorted(obj) if isinstance(obj, dict) else type(obj).__name__}"
        )
    args = obj["arguments"]
    if not isinstance(args, list) or not all(isinstance(a, (str, bytes)) for a in args):
        raise StanceExtractionError(raw, f"step1 arguments is not a list of strings: {type(args).__name__}")
    return [str(a).strip() for a in args if str(a).strip()]


def _parse_response(question: str, raw: str, extractor_meta: dict, *, arguments_override: list[str] | None = None) -> StanceMatrix:
    """Parse the JSON the model returned into a StanceMatrix.

    The current prompt format is::

        {"arguments": [...], "stances": {persona_id: [score, ...], ...}}

    This is the legacy in-the-wild shape that the inline `_extract_stance_matrix`
    produced; we keep it so existing transcripts are interpretable. R2 spec
    leaves room to evolve to a richer (cells: list of dicts) shape later.

    `arguments_override`: when set, ignore whatever arguments the model
    echoed back and use the provided list. Used by step-2 of two-step
    extraction and by S4 arguments_provided ablation, so the scoring
    matrix is guaranteed to align with the requested argument set.
    """
    cleaned = _strip_code_fence(raw)
    try:
        obj = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise StanceExtractionError(raw, f"JSONDecodeError: {e}")

    if not isinstance(obj, dict) or "stances" not in obj:
        raise StanceExtractionError(
            raw, f"missing required keys; got {sorted(obj) if isinstance(obj, dict) else type(obj).__name__}"
        )

    if arguments_override is not None:
        arguments = list(arguments_override)
    else:
        if "arguments" not in obj:
            raise StanceExtractionError(raw, "missing 'arguments' key (no override supplied)")
        arguments = list(obj["arguments"])
    stances = obj["stances"] or {}
    if not isinstance(stances, dict):
        raise StanceExtractionError(raw, f"stances is {type(stances).__name__}, expected dict")

    personas = list(stances.keys())
    cells: dict[tuple[str, str], StanceCell] = {}
    for p, scores in stances.items():
        if not isinstance(scores, list):
            raise StanceExtractionError(raw, f"stances[{p!r}] is {type(scores).__name__}, expected list")
        for i, score in enumerate(scores):
            if i >= len(arguments):
                # extra column — drop silently rather than fail
                break
            try:
                s = float(score)
            except (TypeError, ValueError):
                raise StanceExtractionError(
                    raw, f"stances[{p!r}][{i}] = {score!r} is not numeric"
                )
            # clamp to [-1, 1] to bound downstream metrics
            s = max(-1.0, min(1.0, s))
            cells[(p, arguments[i])] = StanceCell(
                persona=p, argument=arguments[i], score=s,
            )

    return StanceMatrix(
        question=question,
        arguments=arguments,
        personas=personas,
        cells=cells,
        extractor_meta=extractor_meta,
    )


def _anonymize_persona_labels(transcript: str, personas: list[str]) -> str:
    """For Y4 S1 ablation: replace persona id tags with anonymous participant
    tags. Mapping is stable so repeated occurrences of the same id collapse."""
    mapping = {pid: f"participant_{i+1}" for i, pid in enumerate(personas)}
    out = transcript
    for orig, anon in mapping.items():
        out = out.replace(f"[{orig}]", f"[{anon}]")
    return out


# ──────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────


async def extract_stance(
    transcript: str,
    backend: InferenceBackend,
    *,
    question: str = "",
    config: ExtractorConfig | None = None,
    personas: list[str] | None = None,
) -> StanceMatrix:
    """Extract a StanceMatrix from a free-text debate transcript.

    Args:
        transcript: Canonical transcript string (see transcript.format_transcript).
        backend: An InferenceBackend; the caller decides which model runs the
            extraction. For Y3 reliability this is varied across providers.
        question: The original question being debated; included in the prompt.
        config: ExtractorConfig — defaults are R3-B3 production settings.
        personas: Persona id list, only required when
            `config.show_persona_names is False` (so we know what to anonymize).

    Raises:
        StanceExtractionError: when the LLM response can't be parsed. We
            deliberately do NOT fall back to an empty matrix; harness runs
            mark `outcome=error` and the run is excluded from analysis.
    """
    cfg = config or ExtractorConfig()

    use_transcript = transcript
    if not cfg.show_persona_names:
        if not personas:
            raise ValueError("show_persona_names=False requires explicit `personas` list")
        use_transcript = _anonymize_persona_labels(transcript, personas)

    user_suffix = f"问题: {question}\n\n各方回应:\n{use_transcript}" if question else use_transcript
    common_meta = {
        "backend_name": backend.backend_name(),
        "show_persona_names": cfg.show_persona_names,
        "temperature": cfg.temperature,
        "cycle_filter": cfg.cycle_filter,
    }

    # ── Path A: single-pass (S2=off, S4=off) ────────────────────────────
    if not cfg.two_step and cfg.arguments is None:
        prompt_record = load_prompt(cfg.prompt_name, version=cfg.prompt_version_dir)
        raw = await backend.complete(
            prompt_record.text,
            [{"role": "user", "content": user_suffix}],
            max_tokens=cfg.max_tokens,
            temperature=cfg.temperature,
        )
        meta = {
            **common_meta,
            "mode": "single_pass",
            "prompt_name": cfg.prompt_name,
            "prompt_version": prompt_record.version,
            "prompt_hash": prompt_record.hash,
        }
        return _parse_response(question, raw, meta)

    # ── Path B: arguments provided up front (S4) ────────────────────────
    if cfg.arguments is not None:
        provided = list(cfg.arguments)
        step2 = load_prompt(cfg.step2_prompt_name, version=cfg.prompt_version_dir)
        user = (
            f"已确定的论点列表:\n"
            + "\n".join(f"{i+1}. {a}" for i, a in enumerate(provided))
            + "\n\n"
            + user_suffix
        )
        raw = await backend.complete(
            step2.text,
            [{"role": "user", "content": user}],
            max_tokens=cfg.max_tokens,
            temperature=cfg.temperature,
        )
        meta = {
            **common_meta,
            "mode": "arguments_provided",
            "prompt_name": cfg.step2_prompt_name,
            "prompt_version": step2.version,
            "prompt_hash": step2.hash,
            "provided_arguments": provided,
        }
        return _parse_response(question, raw, meta, arguments_override=provided)

    # ── Path C: two-step (S2) ───────────────────────────────────────────
    step1 = load_prompt(cfg.step1_prompt_name, version=cfg.prompt_version_dir)
    step2 = load_prompt(cfg.step2_prompt_name, version=cfg.prompt_version_dir)

    raw1 = await backend.complete(
        step1.text,
        [{"role": "user", "content": user_suffix}],
        max_tokens=cfg.max_tokens,
        temperature=cfg.temperature,
    )
    proposed = _parse_arguments_only(raw1)

    user2 = (
        f"已确定的论点列表（来自第一步抽取）:\n"
        + "\n".join(f"{i+1}. {a}" for i, a in enumerate(proposed))
        + "\n\n"
        + user_suffix
    )
    raw2 = await backend.complete(
        step2.text,
        [{"role": "user", "content": user2}],
        max_tokens=cfg.max_tokens,
        temperature=cfg.temperature,
    )
    meta = {
        **common_meta,
        "mode": "two_step",
        "step1_prompt": {"name": cfg.step1_prompt_name, "version": step1.version, "hash": step1.hash},
        "step2_prompt": {"name": cfg.step2_prompt_name, "version": step2.version, "hash": step2.hash},
        "step1_arguments": proposed,
    }
    return _parse_response(question, raw2, meta, arguments_override=proposed)


async def extract_stance_legacy(
    responses: list[dict],
    backend: InferenceBackend,
    *,
    question: str = "",
    config: ExtractorConfig | None = None,
) -> dict:
    """Backwards-compatible wrapper that returns the historic
    `{"arguments": [...], "stances": {...}}` dict shape used by the
    `phil_stance_matrix` SSE event.

    Internally calls extract_stance(); on extraction failure logs a warning
    and returns an empty matrix so the auto-loop stays alive (vs. crashing
    a long-running session). Harness paths should call extract_stance()
    directly so they get StanceExtractionError instead.
    """
    from app.research.transcript import format_transcript
    transcript = format_transcript(responses, question=question)
    # Derive personas from responses so S1 (anonymized) ablation can run
    # without each caller supplying the list explicitly.
    seen = set()
    personas = [r.get("persona_id") for r in responses if r.get("persona_id")]
    personas = [p for p in personas if not (p in seen or seen.add(p))]
    try:
        matrix = await extract_stance(
            transcript, backend, question=question, config=config,
            personas=personas or None,
        )
        return matrix.to_legacy_dict()
    except StanceExtractionError as e:
        logger.warning("stance extraction failed (legacy path swallowed): %s", e.parse_error)
        return {"arguments": [], "stances": {}}
    except Exception:
        logger.exception("stance extraction unexpected failure")
        return {"arguments": [], "stances": {}}
