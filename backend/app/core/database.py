"""SQLite data layer — turns one-shot SSE sessions into a searchable archive.

Persists every completed auto-loop session as a row + per-cycle / per-persona
rows. FTS5 index over scenario text + persona statements + synthesis enables
"find every session where I discussed AGI" queries.

Writes happen at session completion (bus.mark_completed). On crash, the
in-flight session is lost but already-completed ones survive — acceptable
trade-off vs. an incremental writer that doubles every commit cost.

The DB file lives in ``$WHATIF_DATA_DIR/sessions.db`` (default
``backend/data/sessions.db``).
"""

from __future__ import annotations

import logging
import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────────
# Path resolution + schema
# ────────────────────────────────────────────────────────────────────

def _resolve_db_path() -> Path:
    """Default to ``backend/data/sessions.db`` unless WHATIF_DATA_DIR is set."""
    explicit = os.environ.get("WHATIF_DATA_DIR")
    if explicit:
        base = Path(explicit).expanduser()
    else:
        # backend/app/core/database.py → backend/data/
        base = Path(__file__).resolve().parents[2] / "data"
    base.mkdir(parents=True, exist_ok=True)
    return base / "sessions.db"


DB_PATH = _resolve_db_path()

_SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
    session_id        TEXT PRIMARY KEY,
    created_at        TEXT NOT NULL,            -- ISO 8601
    finished_at       TEXT,
    mode              TEXT NOT NULL,            -- 'philosophical' | 'historical'
    seed_hypothesis   TEXT NOT NULL,
    max_cycles        INTEGER NOT NULL,
    cycle_count       INTEGER NOT NULL DEFAULT 0,
    stopped_reason    TEXT,                     -- converged | max_cycles | cancelled | error
    final_synthesis   TEXT,
    total_input_tokens   INTEGER DEFAULT 0,
    total_output_tokens  INTEGER DEFAULT 0,
    total_cost_usd       REAL    DEFAULT 0.0,
    elapsed_seconds      INTEGER DEFAULT 0,
    -- Feature flags this session ran with — useful for cross-session analysis
    flags_json        TEXT                      -- JSON: {adversarial, branching, ...}
);

CREATE TABLE IF NOT EXISTS cycles (
    session_id        TEXT NOT NULL,
    cycle_num         INTEGER NOT NULL,
    hypothesis        TEXT NOT NULL,
    synthesis         TEXT,
    next_hypothesis   TEXT,
    converged         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, cycle_num),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS persona_statements (
    session_id        TEXT NOT NULL,
    cycle_num         INTEGER NOT NULL,
    persona_id        TEXT NOT NULL,
    persona_name      TEXT NOT NULL,
    model             TEXT,
    content           TEXT NOT NULL,
    falsifiability    TEXT,                     -- extracted "可证伪线" if present
    is_dogmatic       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, cycle_num, persona_id),
    FOREIGN KEY (session_id, cycle_num) REFERENCES cycles(session_id, cycle_num) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS judge_verdicts (
    session_id        TEXT NOT NULL,
    cycle_num         INTEGER NOT NULL,
    -- The full verdict JSON; cheaper than splitting per-verdict into rows
    -- since current usage queries by session rather than verdict count.
    verdict_json      TEXT NOT NULL,
    PRIMARY KEY (session_id, cycle_num),
    FOREIGN KEY (session_id, cycle_num) REFERENCES cycles(session_id, cycle_num) ON DELETE CASCADE
);

-- FTS5 virtual table over scenario + synthesis + persona content so
-- "find every session where I discussed AGI" works in one query.
CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
    session_id UNINDEXED,
    seed_hypothesis,
    final_synthesis,
    all_personas_content,
    tokenize = 'unicode61'
);

CREATE INDEX IF NOT EXISTS idx_cycles_session  ON cycles(session_id);
CREATE INDEX IF NOT EXISTS idx_personas_session ON persona_statements(session_id);
CREATE INDEX IF NOT EXISTS idx_personas_persona ON persona_statements(persona_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
"""


# ────────────────────────────────────────────────────────────────────
# Connection pool — sqlite3 is thread-locked; we use a per-thread conn
# ────────────────────────────────────────────────────────────────────

_local = threading.local()
_init_lock = threading.Lock()
_initialized = False


def _ensure_initialized() -> None:
    """Create tables on first use. Idempotent."""
    global _initialized
    if _initialized:
        return
    with _init_lock:
        if _initialized:
            return
        with sqlite3.connect(str(DB_PATH)) as con:
            con.executescript(_SCHEMA)
            con.commit()
        _initialized = True
        logger.info("database initialized at %s", DB_PATH)


def _get_conn() -> sqlite3.Connection:
    _ensure_initialized()
    con = getattr(_local, "conn", None)
    if con is None:
        con = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys = ON")
        _local.conn = con
    return con


@contextmanager
def transaction():
    """Context manager that yields a cursor inside a transaction."""
    con = _get_conn()
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise


# ────────────────────────────────────────────────────────────────────
# Writer API — called from the SSE bus pipe at session completion
# ────────────────────────────────────────────────────────────────────

def persist_session(session: dict[str, Any]) -> None:
    """Persist one completed auto-loop session.

    Expected dict shape (subset; missing keys default sanely):
        {
          "session_id": str,
          "created_at": iso str,
          "finished_at": iso str,
          "mode": "philosophical" | "historical",
          "seed_hypothesis": str,
          "max_cycles": int,
          "stopped_reason": str,
          "final_synthesis": str,
          "elapsed_seconds": int,
          "flags": {...},
          "total_input_tokens": int, "total_output_tokens": int, "total_cost_usd": float,
          "cycles": [
             {"cycle_num": int, "hypothesis": str, "synthesis": str,
              "next_hypothesis": str, "converged": bool,
              "personas": [{"persona_id", "persona_name", "model", "content",
                            "falsifiability", "is_dogmatic"}],
              "judge_verdict": {...} | None }
          ]
        }
    """
    import json
    sid = session["session_id"]
    cycles = session.get("cycles") or []
    flags = session.get("flags") or {}

    with transaction() as con:
        # Upsert session
        con.execute(
            """
            INSERT INTO sessions (session_id, created_at, finished_at, mode,
                seed_hypothesis, max_cycles, cycle_count, stopped_reason,
                final_synthesis, total_input_tokens, total_output_tokens,
                total_cost_usd, elapsed_seconds, flags_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
                finished_at = excluded.finished_at,
                cycle_count = excluded.cycle_count,
                stopped_reason = excluded.stopped_reason,
                final_synthesis = excluded.final_synthesis,
                total_input_tokens = excluded.total_input_tokens,
                total_output_tokens = excluded.total_output_tokens,
                total_cost_usd = excluded.total_cost_usd,
                elapsed_seconds = excluded.elapsed_seconds,
                flags_json = excluded.flags_json
            """,
            (
                sid,
                session.get("created_at", ""),
                session.get("finished_at"),
                session.get("mode", "philosophical"),
                session.get("seed_hypothesis", ""),
                int(session.get("max_cycles", 5)),
                len(cycles),
                session.get("stopped_reason"),
                session.get("final_synthesis"),
                int(session.get("total_input_tokens", 0)),
                int(session.get("total_output_tokens", 0)),
                float(session.get("total_cost_usd", 0.0)),
                int(session.get("elapsed_seconds", 0)),
                json.dumps(flags, ensure_ascii=False) if flags else None,
            ),
        )

        # Cycles & per-persona statements — drop any old rows first since
        # cycles can theoretically grow over reruns of the same session_id.
        con.execute("DELETE FROM cycles WHERE session_id = ?", (sid,))
        con.execute("DELETE FROM persona_statements WHERE session_id = ?", (sid,))
        con.execute("DELETE FROM judge_verdicts WHERE session_id = ?", (sid,))

        for c in cycles:
            con.execute(
                """INSERT INTO cycles (session_id, cycle_num, hypothesis,
                    synthesis, next_hypothesis, converged)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    sid, int(c["cycle_num"]), c.get("hypothesis", ""),
                    c.get("synthesis"), c.get("next_hypothesis"),
                    1 if c.get("converged") else 0,
                ),
            )
            for p in (c.get("personas") or []):
                con.execute(
                    """INSERT INTO persona_statements (session_id, cycle_num,
                        persona_id, persona_name, model, content,
                        falsifiability, is_dogmatic)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        sid, int(c["cycle_num"]), p.get("persona_id", ""),
                        p.get("persona_name", ""), p.get("model"),
                        p.get("content", ""), p.get("falsifiability"),
                        1 if p.get("is_dogmatic") else 0,
                    ),
                )
            v = c.get("judge_verdict")
            if v:
                con.execute(
                    "INSERT INTO judge_verdicts (session_id, cycle_num, verdict_json) VALUES (?, ?, ?)",
                    (sid, int(c["cycle_num"]), json.dumps(v, ensure_ascii=False)),
                )

        # Rebuild FTS row — include cycle hypotheses + per-cycle syntheses
        # in addition to persona content so "find every session where
        # cycle-evolved hypothesis mentions X" works.
        all_searchable_parts: list[str] = []
        for c in cycles:
            if c.get("hypothesis"):
                all_searchable_parts.append(c["hypothesis"])
            if c.get("synthesis"):
                all_searchable_parts.append(c["synthesis"])
            for p in (c.get("personas") or []):
                if p.get("content"):
                    all_searchable_parts.append(p["content"])
        all_persona_content = "\n".join(all_searchable_parts)

        con.execute("DELETE FROM session_fts WHERE session_id = ?", (sid,))
        con.execute(
            """INSERT INTO session_fts (session_id, seed_hypothesis,
                final_synthesis, all_personas_content)
               VALUES (?, ?, ?, ?)""",
            (
                sid,
                session.get("seed_hypothesis", ""),
                session.get("final_synthesis") or "",
                all_persona_content,
            ),
        )


# ────────────────────────────────────────────────────────────────────
# Read API
# ────────────────────────────────────────────────────────────────────

def list_sessions(
    q: str | None = None,
    limit: int = 30,
    offset: int = 0,
) -> list[dict]:
    """Return sessions matching FTS query (if any), newest first."""
    con = _get_conn()
    if q:
        # SQLite's unicode61 tokenizer doesn't split CJK well: "自由选择"
        # becomes one token, so FTS MATCH only fires for exact phrase hits.
        # Hybrid strategy:
        #  - ASCII-only query → FTS5 MATCH (fast)
        #  - any non-ASCII → LIKE substring across the same indexed text
        is_ascii = q.isascii()
        if is_ascii:
            rows = con.execute(
                """
                SELECT s.session_id, s.created_at, s.finished_at, s.mode,
                       s.seed_hypothesis, s.cycle_count, s.stopped_reason,
                       s.total_cost_usd, s.elapsed_seconds, s.flags_json,
                       substr(s.final_synthesis, 1, 200) AS synthesis_preview
                FROM sessions s
                WHERE s.session_id IN (
                    SELECT session_id FROM session_fts WHERE session_fts MATCH ?
                )
                ORDER BY s.created_at DESC
                LIMIT ? OFFSET ?
                """,
                (q, limit, offset),
            ).fetchall()
        else:
            like = f"%{q}%"
            rows = con.execute(
                """
                SELECT s.session_id, s.created_at, s.finished_at, s.mode,
                       s.seed_hypothesis, s.cycle_count, s.stopped_reason,
                       s.total_cost_usd, s.elapsed_seconds, s.flags_json,
                       substr(s.final_synthesis, 1, 200) AS synthesis_preview
                FROM sessions s
                WHERE s.session_id IN (
                    SELECT session_id FROM session_fts
                    WHERE seed_hypothesis LIKE ?
                       OR final_synthesis LIKE ?
                       OR all_personas_content LIKE ?
                )
                ORDER BY s.created_at DESC
                LIMIT ? OFFSET ?
                """,
                (like, like, like, limit, offset),
            ).fetchall()
    else:
        rows = con.execute(
            """
            SELECT session_id, created_at, finished_at, mode,
                   seed_hypothesis, cycle_count, stopped_reason,
                   total_cost_usd, elapsed_seconds, flags_json,
                   substr(final_synthesis, 1, 200) AS synthesis_preview
            FROM sessions
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        ).fetchall()
    import json
    out = []
    for r in rows:
        d = dict(r)
        if d.get("flags_json"):
            try:
                d["flags"] = json.loads(d["flags_json"])
            except Exception:
                d["flags"] = None
        d.pop("flags_json", None)
        out.append(d)
    return out


def get_session(session_id: str) -> dict | None:
    """Return one full session with cycles + personas + verdicts."""
    import json
    con = _get_conn()
    sess = con.execute(
        "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
    ).fetchone()
    if not sess:
        return None
    out = dict(sess)
    if out.get("flags_json"):
        try:
            out["flags"] = json.loads(out["flags_json"])
        except Exception:
            out["flags"] = None
    out.pop("flags_json", None)

    cycles = con.execute(
        "SELECT * FROM cycles WHERE session_id = ? ORDER BY cycle_num",
        (session_id,),
    ).fetchall()
    out["cycles"] = []
    for c in cycles:
        cd = dict(c)
        cd["personas"] = [
            dict(p)
            for p in con.execute(
                """SELECT persona_id, persona_name, model, content,
                          falsifiability, is_dogmatic
                   FROM persona_statements
                   WHERE session_id = ? AND cycle_num = ?
                   ORDER BY rowid""",
                (session_id, c["cycle_num"]),
            ).fetchall()
        ]
        v = con.execute(
            "SELECT verdict_json FROM judge_verdicts WHERE session_id = ? AND cycle_num = ?",
            (session_id, c["cycle_num"]),
        ).fetchone()
        if v:
            try:
                cd["judge_verdict"] = json.loads(v["verdict_json"])
            except Exception:
                cd["judge_verdict"] = None
        out["cycles"].append(cd)

    return out


def session_stats() -> dict:
    """Cross-session aggregate stats — fast since SQLite, no need to cache."""
    con = _get_conn()
    total = con.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    total_cycles = con.execute("SELECT COUNT(*) FROM cycles").fetchone()[0]
    total_cost = con.execute("SELECT COALESCE(SUM(total_cost_usd), 0) FROM sessions").fetchone()[0]
    avg_cycles_per_session = (total_cycles / total) if total else 0.0

    convergence = con.execute(
        "SELECT stopped_reason, COUNT(*) FROM sessions GROUP BY stopped_reason"
    ).fetchall()

    # Per-persona dogmatic rate
    persona_stats = con.execute(
        """
        SELECT persona_id,
               COUNT(*) AS total,
               SUM(is_dogmatic) AS dogmatic,
               SUM(CASE WHEN falsifiability IS NOT NULL THEN 1 ELSE 0 END) AS with_falsifiability
        FROM persona_statements
        GROUP BY persona_id
        ORDER BY total DESC
        """
    ).fetchall()

    return {
        "total_sessions": total,
        "total_cycles": total_cycles,
        "total_cost_usd": round(float(total_cost), 4),
        "avg_cycles_per_session": round(avg_cycles_per_session, 2),
        "stopped_reasons": {(r[0] or "unknown"): r[1] for r in convergence},
        "by_persona": [dict(r) for r in persona_stats],
    }


def bias_analytics() -> dict:
    """Deeper aggregations for the bias-analysis dashboard.

    - per-persona: total statements, dogmatic rate, avg content length,
      win count (judge verdicts), top models, sample dogmatic statements
    - per-model: same shape but grouped by `model` instead of persona_id
    - cross-session: how often each persona has been "judged strongest"
      vs "weakest" across all completed cycles
    """
    import json
    con = _get_conn()

    # Per-persona aggregates
    persona_rows = con.execute(
        """
        SELECT persona_id,
               COUNT(*) AS total,
               SUM(is_dogmatic) AS dogmatic,
               SUM(CASE WHEN falsifiability IS NOT NULL THEN 1 ELSE 0 END) AS with_fals,
               AVG(LENGTH(content)) AS avg_len
        FROM persona_statements
        GROUP BY persona_id
        ORDER BY total DESC
        """
    ).fetchall()
    # Top model per persona (most-used)
    top_model_rows = con.execute(
        """
        SELECT persona_id, model, COUNT(*) AS n
        FROM persona_statements
        WHERE model IS NOT NULL AND model != ''
        GROUP BY persona_id, model
        ORDER BY persona_id, n DESC
        """
    ).fetchall()
    top_model_by_persona: dict[str, list[dict]] = {}
    for r in top_model_rows:
        top_model_by_persona.setdefault(r["persona_id"], []).append(
            {"model": r["model"], "count": r["n"]}
        )

    # Per-model aggregates
    model_rows = con.execute(
        """
        SELECT model,
               COUNT(*) AS total,
               SUM(is_dogmatic) AS dogmatic,
               AVG(LENGTH(content)) AS avg_len,
               COUNT(DISTINCT persona_id) AS personas_played
        FROM persona_statements
        WHERE model IS NOT NULL AND model != ''
        GROUP BY model
        ORDER BY total DESC
        """
    ).fetchall()

    # Judge-verdict scoring per persona — count wins by parsing verdict_json
    verdict_rows = con.execute("SELECT verdict_json FROM judge_verdicts").fetchall()
    persona_wins: dict[str, int] = {}
    persona_strongest_count: dict[str, int] = {}
    persona_weakest_count: dict[str, int] = {}
    total_verdicts = 0
    for vr in verdict_rows:
        try:
            v = json.loads(vr["verdict_json"])
        except Exception:
            continue
        total_verdicts += 1
        for item in (v.get("verdicts") or []):
            for pid in (item.get("winning_personas") or []):
                persona_wins[pid] = persona_wins.get(pid, 0) + 1
        s = v.get("overall_strongest") or {}
        if isinstance(s, dict) and s.get("persona_id"):
            pid = s["persona_id"]
            persona_strongest_count[pid] = persona_strongest_count.get(pid, 0) + 1
        w = v.get("overall_weakest") or {}
        if isinstance(w, dict) and w.get("persona_id"):
            pid = w["persona_id"]
            persona_weakest_count[pid] = persona_weakest_count.get(pid, 0) + 1

    # Build per-persona output combining everything
    by_persona = []
    for r in persona_rows:
        pid = r["persona_id"]
        total = int(r["total"])
        by_persona.append({
            "persona_id": pid,
            "total_statements": total,
            "dogmatic_count": int(r["dogmatic"] or 0),
            "dogmatic_rate": round(100 * (r["dogmatic"] or 0) / total, 1) if total else 0,
            "with_falsifiability": int(r["with_fals"] or 0),
            "avg_content_length": round(float(r["avg_len"] or 0), 0),
            "judge_wins": persona_wins.get(pid, 0),
            "judge_strongest": persona_strongest_count.get(pid, 0),
            "judge_weakest": persona_weakest_count.get(pid, 0),
            "top_models": top_model_by_persona.get(pid, [])[:3],
        })

    by_model = []
    for r in model_rows:
        total = int(r["total"])
        by_model.append({
            "model": r["model"],
            "total_statements": total,
            "dogmatic_count": int(r["dogmatic"] or 0),
            "dogmatic_rate": round(100 * (r["dogmatic"] or 0) / total, 1) if total else 0,
            "avg_content_length": round(float(r["avg_len"] or 0), 0),
            "personas_played": int(r["personas_played"]),
        })

    return {
        "by_persona": by_persona,
        "by_model": by_model,
        "total_verdicts_analyzed": total_verdicts,
    }


def delete_session(session_id: str) -> bool:
    """Delete a session and its children. Returns True if a row was removed."""
    with transaction() as con:
        cur = con.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
        con.execute("DELETE FROM session_fts WHERE session_id = ?", (session_id,))
        return cur.rowcount > 0
