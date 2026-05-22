"""Persona-label shuffling utility for the negative-control experiment.

Spec: ../../../../What-If-paper/methodology/Y5_negative_control.md

We swap each persona's system_prompt with another persona's, while keeping
the persona id/name/role labels in their original order. If the stance
extractor is truly persona-grounded, the resulting stance matrix should
diverge meaningfully from the original; if extracted stances stay roughly
the same, the method is text-pattern driven and we must report that as a
limitation in the paper.

This is a derangement (no persona keeps its own prompt) so the contrast
is sharp; degenerate cases with <2 personas just return the input unchanged.
"""
from __future__ import annotations
import copy
import random
from typing import Sequence


def derange_personas(personas: Sequence[dict], seed: int) -> list[dict]:
    """Return a list of persona dicts where each persona's `system_prompt`
    has been swapped with another persona's prompt under a derangement.

    Other fields (`id`, `name`, `role`, …) are preserved from the original
    position so downstream code keeps using the original persona identity
    for reporting; only the prompt body is reassigned.

    Args:
        personas: list of dicts, each with at least `id` and `system_prompt`.
        seed: RNG seed; same seed → same permutation.

    Returns:
        A new list (deep-copied entries; input is not mutated). With <2
        personas a deep copy is returned unchanged.

    Raises:
        ValueError: if any persona is missing `system_prompt` or `id`.
    """
    n = len(personas)
    out = [copy.deepcopy(p) for p in personas]
    if n < 2:
        return out

    for i, p in enumerate(personas):
        if "system_prompt" not in p or "id" not in p:
            raise ValueError(
                f"persona at index {i} missing required keys 'id'/'system_prompt'"
            )

    rng = random.Random(seed)
    indices = list(range(n))
    # Derangement via Fisher-Yates with rejection (n is tiny — 5 personas typical)
    while True:
        perm = indices[:]
        rng.shuffle(perm)
        if all(perm[i] != i for i in indices):
            break

    prompts = [p["system_prompt"] for p in personas]
    for i, src in enumerate(perm):
        out[i]["system_prompt"] = prompts[src]
        # Stamp provenance so downstream logs / analysis can verify the shuffle
        out[i]["_shuffled_from_id"] = personas[src]["id"]
    return out


def is_derangement(original: Sequence[dict], shuffled: Sequence[dict]) -> bool:
    """Return True iff every position has a different system_prompt than the
    original. Used in tests + assertion at runtime."""
    if len(original) != len(shuffled):
        return False
    return all(
        original[i]["system_prompt"] != shuffled[i]["system_prompt"]
        for i in range(len(original))
    )


# ──────────────────────────────────────────────────────────────────────
# Transcript-level label shuffle (the spec-correct Y5 control)
# ──────────────────────────────────────────────────────────────────────


def shuffle_transcript_labels(
    responses: Sequence[dict],
    seed: int,
) -> tuple[list[dict], dict[str, str]]:
    """Permute persona ids across a list of response dicts WITHOUT touching
    the text content. This is the methodologically correct Y5 negative
    control (spec: ../../../../What-If-paper/methodology/Y5_negative_control.md):

        > 取一条已完成的 run 的 transcript;
        > 把每个 persona 的发言**随机重新分配**给其他 persona name
        > (保持发言池不变, 只 permute label);

    Pre-2026-05-12 the harness implemented Y5 by running `b3_shuffled` (a
    second b3_full with derangement-permuted persona PROMPTS), which produces
    different debate text — not what the spec specifies. This function does
    the spec-correct operation on an existing transcript: same text, different
    attribution.

    Args:
        responses: list of dicts each carrying at least `persona_id` and
            `content` (text). Other fields (cycle, model, ...) are preserved.
        seed: RNG seed; same seed + same input → same permutation.

    Returns:
        (shuffled_responses, mapping) where mapping[new_persona_id] =
        original_persona_id_whose_content_now_lives_under_this_label. Stamping
        the mapping into the report lets the recovery metric measure whether
        the extractor follows labels (high recovery) or content (low recovery).
    """
    n_unique = len({r["persona_id"] for r in responses})
    if n_unique < 2:
        return [copy.deepcopy(r) for r in responses], {}

    persona_order = []
    seen_ids: set[str] = set()
    for r in responses:
        pid = r["persona_id"]
        if pid not in seen_ids:
            seen_ids.add(pid)
            persona_order.append(pid)

    rng = random.Random(seed)
    while True:
        perm = persona_order[:]
        rng.shuffle(perm)
        if all(a != b for a, b in zip(persona_order, perm)):
            break

    # mapping: new_label → original_label whose content moved here
    label_to_source = dict(zip(persona_order, perm))
    # We need the inverse for relabeling each response: if source `S` was
    # remapped to `T`, then any response originally tagged S should now be
    # tagged T. Build that inverse.
    source_to_new = {src: new for new, src in label_to_source.items()}

    shuffled: list[dict] = []
    for r in responses:
        new_r = copy.deepcopy(r)
        new_label = source_to_new[r["persona_id"]]
        new_r["persona_id"] = new_label
        new_r["_shuffled_from_id"] = r["persona_id"]
        shuffled.append(new_r)

    return shuffled, label_to_source
