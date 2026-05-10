"""Debug / introspection endpoints.

Lightweight read-only endpoints for tailing logs and inspecting state without
needing shell access. Useful when:
  - the dev is on a phone / iPad
  - reading logs from a constrained sandbox
  - you want to share a log snippet via URL
"""

from pathlib import Path
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

router = APIRouter(prefix="/api/debug", tags=["debug"])

# Centralized log location written by ofe-ctl.sh
DEFAULT_LOG = Path.home() / "Desktop/Ofe/.logs/whatif-backend.log"
FRONTEND_LOG = Path.home() / "Desktop/Ofe/.logs/whatif-frontend.log"


def _tail(path: Path, n: int = 200, grep: str | None = None) -> list[str]:
    if not path.exists():
        return []
    # Read last ~1MB max — enough for thousands of lines, cheap.
    size = path.stat().st_size
    with path.open("rb") as f:
        if size > 1_000_000:
            f.seek(-1_000_000, 2)
            f.readline()  # skip partial line
        data = f.read().decode("utf-8", errors="replace")
    lines = data.splitlines()
    if grep:
        try:
            rx = re.compile(grep, re.IGNORECASE)
            lines = [l for l in lines if rx.search(l)]
        except re.error:
            # Fall back to literal substring match if regex is invalid.
            lines = [l for l in lines if grep.lower() in l.lower()]
    return lines[-n:]


@router.get("/log")
async def get_log(target: str = "backend", tail: int = 200, grep: str | None = None):
    """Return the last N lines of the requested log.

    Query params:
      target: 'backend' (default) | 'frontend'
      tail:   max lines to return (default 200, capped at 5000)
      grep:   optional regex / substring filter
    """
    n = max(1, min(int(tail), 5000))
    path = DEFAULT_LOG if target == "backend" else FRONTEND_LOG
    if not path.exists():
        raise HTTPException(404, f"log not found: {path}")
    lines = _tail(path, n=n, grep=grep)
    return {
        "path": str(path),
        "size_bytes": path.stat().st_size,
        "returned": len(lines),
        "lines": lines,
    }


@router.get("/log.txt", response_class=PlainTextResponse)
async def get_log_text(target: str = "backend", tail: int = 200, grep: str | None = None):
    """Same as /log but returns plain text — convenient for `curl`."""
    n = max(1, min(int(tail), 5000))
    path = DEFAULT_LOG if target == "backend" else FRONTEND_LOG
    if not path.exists():
        return PlainTextResponse(f"log not found: {path}", status_code=404)
    lines = _tail(path, n=n, grep=grep)
    return PlainTextResponse("\n".join(lines))
