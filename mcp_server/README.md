# What-If MCP server

Exposes the philosophical-debate engine as MCP tools so any MCP-compatible
client (Claude Desktop, Claude Code, Cursor, …) can invoke it as a sub-tool.

## What it gives you

5 tools + 2 resources:

| Kind | Name | What it does |
| --- | --- | --- |
| tool | `philosophical_debate` | Run a multi-cycle debate with optional judge / fact-check / self-contradict / future-perspective |
| tool | `list_recent_sessions` | Search the persisted archive |
| tool | `get_session_detail` | Fetch a full session by id |
| tool | `compare_persona_across_models` | Same persona × Claude / GPT-5 / DeepSeek |
| tool | `find_structural_analogies` | 3-5 historical analogues for any topic |
| tool | `extract_recurring_concepts` | Cross-session concept map |
| resource | `whatif://personas` | Built-in persona registry |
| resource | `whatif://stats` | Cross-session aggregates |

## Setup

1. Make sure the What-If backend is running (default `http://localhost:8000`):

   ```bash
   cd backend && uvicorn app.main:app --reload
   ```

2. Install MCP dependencies (use the backend's venv if convenient):

   ```bash
   pip install -r mcp_server/requirements.txt
   ```

3. Add to your MCP client config. **Claude Desktop**
   (`~/Library/Application Support/Claude/claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "what-if": {
         "command": "python",
         "args": ["-m", "mcp_server.server"],
         "cwd": "/absolute/path/to/What-If",
         "env": {
           "WHATIF_BACKEND_URL": "http://localhost:8000"
         }
       }
     }
   }
   ```

   **Claude Code** (`~/.claude.json` → `mcpServers`): same shape.

4. Restart the client. The What-If tools should appear under the MCP servers list.

## Try it

In your MCP-aware client:

> Use What-If to run a 3-cycle philosophical debate on "Should AI systems
> be granted legal personhood?" with judge verdicts and fact-check on.

The client should call `philosophical_debate(question=…, cycles=3,
judge_verdict=True, fact_check=True)` and return the full session.

## Environment vars

| Var | Default | Notes |
| --- | --- | --- |
| `WHATIF_BACKEND_URL` | `http://localhost:8000` | Where the FastAPI backend lives |
| `WHATIF_MCP_TIMEOUT` | `300` | HTTP timeout per call (seconds) — debates can take a while |

## Limitations

- The server is a thin proxy — it requires the FastAPI backend to be
  running. There's no standalone mode.
- `philosophical_debate` runs the full SSE stream synchronously before
  returning. For very long debates this means MCP timeouts may bite;
  bump `WHATIF_MCP_TIMEOUT` if needed.
- Concurrent calls share the same backend's TokenTracker singleton —
  cost / latency metrics will be merged.
