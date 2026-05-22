"""Prompt template registry — version-pinned, hash-stable.

Spec: ../../../../What-If-paper/methodology/Y2_prompt_versioning.md

Bootstrapping pattern:
- Each prompt lives at backend/app/data/prompts/<version_dir>/<purpose>.txt
- First line is a Jinja-style header `{# version: ... purpose: ... #}` block
- The hash is computed over the **whole file bytes** including the header,
  so editing the header (e.g. bumping the parent pointer) produces a new
  hash and a new logged version, which is the property we want.

Today this registry is **not yet wired into auto_loop.py**; the inline
prompts there still ship verbatim. The registry exists so:
  1. The harness `run_meta` event can stamp `prompts.<purpose>.hash` for
     reproducibility, even before auto_loop reads the registry.
  2. The Y5 negative-control shuffle can reference persona prompts as data.
  3. R2 stance_extractor decoupling can pick up `extract_stance(...)`
     from this registry instead of re-importing inline strings.

Use:
    from app.core.prompt_registry import load_prompt, list_prompts
    text, h = load_prompt("stance_extractor", version="v1")
    inventory = list_prompts(version="v1")
"""
from __future__ import annotations
import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
PROMPTS_ROOT = DATA_DIR / "prompts"

_HEADER_RE = re.compile(
    r"\{#\s*(?P<body>.*?)\s*#\}",
    re.DOTALL,
)


@dataclass(frozen=True)
class PromptRecord:
    name: str
    version_dir: str           # e.g. "v1"
    version: str               # value of `version:` header field, e.g. "2026-05-09-a"
    text: str                  # full file text including header
    hash: str                  # sha256 of text (with `sha256:` prefix)
    path: Path
    metadata: dict             # parsed header fields (purpose, author, parent, notes)


def _parse_header(text: str) -> dict:
    """Parse the leading {# … #} Jinja-style block into a dict. Each line
    inside the block is `key: value`."""
    m = _HEADER_RE.match(text)
    if not m:
        return {}
    body = m.group("body")
    out: dict = {}
    for line in body.splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        k, _, v = line.partition(":")
        out[k.strip()] = v.strip()
    return out


def _sha256(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_prompt(name: str, *, version: str = "v1") -> PromptRecord:
    """Load one prompt template by name.

    Bilingual support (2026-05-17): when WHATIF_LANGUAGE=en is set and a
    sibling `<name>_en.txt` exists, that variant is loaded instead. The
    original zh template stays the canonical default so existing pinned
    `prompt_versions` (in baseline configs) keep working — the `_en` file
    declares its own version stamp.

    Raises:
        FileNotFoundError if the file does not exist.
        ValueError if the file lacks a version header (we refuse to load
            unversioned prompts so reproducibility is enforced).
    """
    import os
    lang = os.environ.get("WHATIF_LANGUAGE", "zh").lower()
    if lang == "en":
        en_path = PROMPTS_ROOT / version / f"{name}_en.txt"
        if en_path.exists():
            path = en_path
        else:
            path = PROMPTS_ROOT / version / f"{name}.txt"
    else:
        path = PROMPTS_ROOT / version / f"{name}.txt"
    if not path.exists():
        raise FileNotFoundError(f"prompt '{name}' not found at {path}")
    text = path.read_text(encoding="utf-8")
    meta = _parse_header(text)
    if not meta or "version" not in meta:
        raise ValueError(
            f"prompt {path} missing a {{# version: ... #}} header — "
            f"add one (Y2 spec) before this prompt can be loaded."
        )
    return PromptRecord(
        name=name,
        version_dir=version,
        version=meta["version"],
        text=text,
        hash=_sha256(text),
        path=path,
        metadata=meta,
    )


def list_prompts(*, version: str = "v1") -> dict[str, dict]:
    """Return a mapping {name: {version, hash, path}} for every prompt under
    `prompts/<version>/`. Used by the eval harness to stamp run_meta."""
    base = PROMPTS_ROOT / version
    if not base.exists():
        return {}
    out: dict[str, dict] = {}
    for f in sorted(base.glob("*.txt")):
        try:
            rec = load_prompt(f.stem, version=version)
        except ValueError as e:
            # Surface unversioned files loudly rather than silently dropping.
            out[f.stem] = {"error": str(e)}
            continue
        out[rec.name] = {
            "version": rec.version,
            "hash": rec.hash,
            "purpose": rec.metadata.get("purpose"),
            "parent": rec.metadata.get("parent"),
        }
    return out
