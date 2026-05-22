"""Build a persistable session dict from an auto-loop event stream.

Hooked into ``pipe_to_bus(..., on_complete=archive_auto_loop)``. Replays
the buffered events, reconstructs cycles + persona statements + judge
verdicts + final synthesis, and writes one row to the SQLite store.

Idempotent: re-calling ``persist_session`` for the same session_id
overwrites previous content (used when the same id replays).
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from app.core.database import persist_session

logger = logging.getLogger(__name__)


_FALSIFIABILITY_RE = re.compile(
    r"(?:^|\n)\s*\**\s*(?:可证伪线|Falsifiability\s+line)\s*[:：]\s*(.+)\s*$",
    re.IGNORECASE,
)


def _extract_falsifiability(content: str) -> tuple[str | None, bool]:
    """Returns (falsifiability_line, is_dogmatic).
    is_dogmatic = True when the content is non-empty but has no falsifiability."""
    if not content:
        return None, False
    m = _FALSIFIABILITY_RE.search(content)
    if m:
        return m.group(1).strip(), False
    return None, True


def archive_auto_loop(session_id: str, archive: list[dict]) -> None:
    """Replay events, build session dict, hand to persist_session.

    Robust against partial / out-of-order events — uses .get() everywhere
    and skips unknown event types.
    """
    try:
        session: dict = {
            "session_id": session_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "mode": "philosophical",
            "seed_hypothesis": "",
            "max_cycles": 5,
            "stopped_reason": None,
            "final_synthesis": None,
            "elapsed_seconds": 0,
            "flags": {},
            "cycles": [],
        }
        # Active cycle being built; flush into session.cycles on cycle_complete
        cur_cycle: dict | None = None

        def _ensure_cycle(cycle_num: int, hypothesis: str = "") -> dict:
            nonlocal cur_cycle
            if cur_cycle is None or cur_cycle.get("cycle_num") != cycle_num:
                cur_cycle = {
                    "cycle_num": cycle_num,
                    "hypothesis": hypothesis,
                    "synthesis": None,
                    "next_hypothesis": None,
                    "converged": False,
                    "personas": [],
                    "_persona_index": {},
                    "judge_verdict": None,
                }
                session["cycles"].append(cur_cycle)
            elif hypothesis and not cur_cycle.get("hypothesis"):
                cur_cycle["hypothesis"] = hypothesis
            return cur_cycle

        for ev in archive:
            if not isinstance(ev, dict):
                continue
            t = ev.get("type", "")
            d = ev.get("data") or {}
            if not isinstance(d, dict):
                continue

            if t == "auto_start":
                session["mode"] = d.get("mode", session["mode"])
                session["max_cycles"] = int(d.get("max_cycles", session["max_cycles"]))
                session["seed_hypothesis"] = d.get("seed_hypothesis", session["seed_hypothesis"])
                # Surface known feature flags so we can later answer
                # "in what fraction of adversarial-on sessions did X happen?"
                session["flags"] = {
                    k: bool(d.get(k))
                    for k in (
                        "adversarial", "extract_stances", "branching",
                        "flip_stance", "subq_decomposition", "self_reflection",
                        "subdomain_routing", "judge_verdict",
                    )
                    if k in d
                }
            elif t == "cycle_start":
                _ensure_cycle(int(d.get("cycle", 0)), d.get("hypothesis", ""))
            elif t == "phil_persona_complete":
                cn = int(d.get("cycle", 0))
                c = _ensure_cycle(cn)
                pid = d.get("persona_id", "")
                content = d.get("content", "") or ""
                fals, dogmatic = _extract_falsifiability(content)
                rec = {
                    "persona_id": pid,
                    "persona_name": d.get("persona_name", pid),
                    "model": d.get("model"),
                    "content": content,
                    "falsifiability": fals,
                    "is_dogmatic": dogmatic,
                }
                # Replace existing if same persona spoke twice (shouldn't
                # happen, but defensive)
                if pid in c["_persona_index"]:
                    idx = c["_persona_index"][pid]
                    c["personas"][idx] = rec
                else:
                    c["_persona_index"][pid] = len(c["personas"])
                    c["personas"].append(rec)
            elif t == "phil_synthesis_done":
                cn = int(d.get("cycle", 0))
                c = _ensure_cycle(cn)
                c["synthesis"] = d.get("synthesis", "")
            elif t == "phil_judge_verdict":
                cn = int(d.get("cycle", 0))
                c = _ensure_cycle(cn)
                c["judge_verdict"] = d.get("verdict")
            elif t == "cycle_complete":
                cn = int(d.get("cycle", 0))
                c = _ensure_cycle(cn)
                c["converged"] = bool(d.get("converged"))
                if d.get("synthesis_preview") and not c.get("synthesis"):
                    c["synthesis"] = d["synthesis_preview"]
            elif t == "next_hypothesis":
                # Belongs to the cycle that just completed, not the next one
                cn = int(d.get("cycle", 0))
                c = _ensure_cycle(cn)
                c["next_hypothesis"] = d.get("hypothesis", "")
            elif t == "auto_converged":
                session["stopped_reason"] = "converged"
            elif t == "auto_cancelled":
                session["stopped_reason"] = "cancelled"
            elif t in ("auto_complete", "loop_complete"):
                session["stopped_reason"] = session.get("stopped_reason") or d.get("stopped_reason") or "max_cycles"
                if d.get("final_synthesis"):
                    session["final_synthesis"] = d["final_synthesis"]
                if d.get("elapsed_seconds"):
                    session["elapsed_seconds"] = int(d["elapsed_seconds"])
            elif t == "auto_final_synthesis" or t == "phil_final_synthesis":
                if d.get("synthesis"):
                    session["final_synthesis"] = d["synthesis"]
            elif t in ("error", "bus_error", "auto_error"):
                if not session.get("stopped_reason"):
                    session["stopped_reason"] = "error"

        # Drop helper fields before persisting
        for c in session["cycles"]:
            c.pop("_persona_index", None)

        # Stamp finished_at
        session["finished_at"] = datetime.now(timezone.utc).isoformat()

        # Skip persisting essentially-empty sessions (e.g. error before any
        # cycle started); they pollute the archive.
        if not session["cycles"] and not session["seed_hypothesis"]:
            logger.debug("skip archiving empty session %s", session_id)
            return

        persist_session(session)
        logger.info(
            "archived session %s — %d cycles, %d events",
            session_id, len(session["cycles"]), len(archive),
        )
    except Exception:
        logger.exception("archive_auto_loop failed for %s", session_id)
