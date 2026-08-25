# INVENTORY — What-If 代码库扫描报告

> 生成时间：2026-05-23
> 扫描范围：仓库根目录 `.`，排除 `node_modules/`、`.git/`、`__pycache__/`、`.venv/`、`dist/`、`runs/`、`pilot_runs/`、`evaluation/`、`benchmark/`、`.pytest_cache/`
> 方法：只读静态扫描；任何无法直接从代码确认的判断都标注「不确定」。

---

## 1. 目录结构（三层）

```
What-If/
├── backend/                            # FastAPI 后端 + 推理/数据/实验代码
│   ├── app/
│   │   ├── core/                       # 推理后端抽象、SSE、SQLite、Token 追踪、prompt 引擎
│   │   ├── routers/                    # 8 个 HTTP router（见第 2 节）
│   │   ├── services/                   # 业务编排（辩论/因果/反事实/编排/自主循环等）
│   │   ├── schemas/                    # Pydantic 请求/响应模型
│   │   ├── research/                   # 论文实验工具（shuffle / stance / transcript）
│   │   ├── data/                       # 角色 YAML、历史事件 YAML、prompt 模板
│   │   ├── config.py                   # pydantic-settings，env 前缀 WHATIF_
│   │   └── main.py                     # FastAPI 入口
│   ├── tests/                          # pytest（test_api / debate / prompt / schemas / streaming / token_tracker）
│   ├── data/sessions.db                # 运行时 SQLite 档案（gitignored）
│   ├── runs/、pilot_runs/、evaluation/ # 实验产物输出（gitignored）
│   ├── Dockerfile                      # python:3.12-slim + uvicorn
│   ├── requirements.txt
│   └── sweep.log                       # 1.3MB，疑似遗留的 sweep 日志（见第 5 节）
├── frontend/                           # React + Vite + TS 前端
│   ├── src/
│   │   ├── components/                 # 按模块分组（causal/common/counterfactual/debate/orchestrator/voting）
│   │   ├── store/                      # 12 个 Zustand store
│   │   ├── hooks/、lib/、services/     # useSSE、coneRenderer、api/sessionsApi
│   │   ├── App.tsx、main.tsx、index.css
│   ├── public/tutorials.html
│   ├── Dockerfile、index.html、vite.config.ts、tsconfig.json
│   ├── tailwind.config.js、postcss.config.js
│   └── package.json / package-lock.json
├── mcp_server/                         # MCP 服务器，作为后端 HTTP 的 MCP 代理
│   ├── server.py、__init__.py、requirements.txt、README.md
├── scripts/local-models-setup.sh       # 仅一个脚本：批量 pull Ollama 模型
├── benchmark/                          # 测试场景 jsonl（含 3 份 .bak 备份）
├── runs/                               # 历史实验输出（gitignored，目录按日期分组）
├── docker-compose.yml                  # backend:8000 + frontend:5173
├── CLAUDE.md                           # 当前项目说明（Claude Code 自动加载）
├── Claude.md                           # 旧版本说明（见第 5 节）
├── .gitignore
├── .logs → /Users/.../Ofe/.logs        # 符号链接（外部集中日志目录）
└── .runs → /tmp/whatif-runs            # 符号链接（外部 run 目录）
```

各主目录用途（基于代码内容推断）：

| 目录 | 用途 |
|---|---|
| `backend/app/core/` | 推理后端 ABC、Claude/Ollama 实现、SSE 工具与总线、SQLite 数据层、token 计费、prompt 模板与版本注册、session 归档、嵌入客户端 |
| `backend/app/routers/` | FastAPI 路由层，把 services 暴露为 HTTP/SSE 端点 |
| `backend/app/services/` | 业务编排（debate_room / causal_graph / counterfactual / orchestrator / auto_loop / autonomous_debate / voting / persona_eval / persona_summary） |
| `backend/app/schemas/` | Pydantic v2 模型，覆盖所有路由的入参/出参 |
| `backend/app/research/` | 论文实验工具，头部注释引用外部路径 `../../../../What-If-paper/methodology/`（仓库外） |
| `backend/app/data/` | `personas/`（5 个核心 + `historical/` 4 个）、`historical/`（4 个事件 yaml）、`prompts/v1`；`graph_templates/` 为空目录 |
| `backend/tests/` | pytest 用例 + conftest |
| `frontend/src/components/` | 5 个模块各自一个子目录 + `common/`（含 `ui/`：Button/Panel/SectionHeader） |
| `frontend/src/store/` | Zustand store 12 个（含 navStore、onboardingStore、personaPromptStore、portalStore、settingsStore、timeCapsuleStore、persistHelpers——CLAUDE.md 未全部列出） |
| `mcp_server/` | 根据 server.py 顶部注释：把 FastAPI 后端封装成 MCP 工具，供 Claude Desktop / Code / Cursor 调用 |
| `scripts/` | 仅含 `local-models-setup.sh`（拉 qwen/llama/mistral 等到 Ollama） |
| `benchmark/` | 评测集 `scenarios.jsonl` + 3 份带日期后缀的 .bak 备份 |
| `runs/`、`backend/runs/`、`backend/pilot_runs/` | 自动循环实验输出（gitignored） |

---

## 2. 入口文件清单

| 类型 | 路径 | 说明 |
|---|---|---|
| 后端 HTTP 入口 | [backend/app/main.py](backend/app/main.py) | FastAPI 实例 + CORS + 8 个 `include_router` |
| 后端启动命令 | [backend/Dockerfile:12](backend/Dockerfile#L12)、[docker-compose.yml:14](docker-compose.yml#L14) | `uvicorn app.main:app --host 0.0.0.0 --port 8000` |
| 前端 HTML | [frontend/index.html](frontend/index.html) | Vite 入口 HTML（未单独阅读，按 Vite 约定推断） |
| 前端 React | [frontend/src/main.tsx](frontend/src/main.tsx) → [frontend/src/App.tsx](frontend/src/App.tsx) | App.tsx 含 5 个模块 tab + 7 个浮层 |
| 前端启动命令 | [frontend/package.json:6-9](frontend/package.json#L6-L9) | `vite` / `tsc && vite build` / `vite preview` |
| MCP 入口 | [mcp_server/server.py](mcp_server/server.py) | `python -m mcp_server.server`（stdio） |
| Shell 脚本 | [scripts/local-models-setup.sh](scripts/local-models-setup.sh) | Ollama 模型批量拉取 |

**HTTP 路由注册点**：[backend/app/main.py:26-33](backend/app/main.py#L26-L33)

按 router 列出全部端点（共 8 个 router，约 50 个端点）：

- `/api/debate` — start / `{id}/round` / `{id}/inject` / `{id}/summary` / `{id}` / personas/list
- `/api/causal` — generate / `{id}/propagate` / `{id}`
- `/api/counterfactual` — events / `events/{id}` / generate / `timelines/{id}` / `timelines/{id}/falsify` / `timelines/{id}/vulnerability` / `timelines/{id}/regenerate` / explore / `fans/{id}` / `attractors/detect` / `attractors/{id}` / `events/{id}/personas` / `explore/embodied`
- `/api/orchestrator` — feedback-loop / `results/{id}` / auto-loop / `auto-loop/{id}/resume` / `auto-loop/{id}/cancel` / `auto-loop/{id}/briefing` / topic/critique / topic/decompose / personas / topic/analogies / persona/classroom_grade / persona/ab_test / persona/followup / persona/compare / auto-loop/_logs / autonomous-debate / `autonomous-debate/{id}/cancel` / `autonomous-debate/{id}/log` / autonomous-debate/_logs
- `/api/voting` — run / usage / profile
- `/api/debug` — log / log.txt
- `/api/metrics` — (root)
- `/api/sessions` — (root) / _stats / _bias / _concepts / _retrospective / `{id}/consistency_test` / `{id}` / DELETE `{id}`
- 顶层：`GET /`、`GET /health`

---

## 3. 外部依赖

### 3.1 backend/requirements.txt

| 包 | 版本 | 使用情况 |
|---|---|---|
| fastapi | 0.115.0 | ✅ `main.py` |
| uvicorn[standard] | 0.30.0 | ✅ Dockerfile / docker-compose |
| pydantic | 2.9.0 | ✅ 所有 schema |
| pydantic-settings | 2.5.0 | ✅ `config.py` |
| anthropic | 0.39.0 | ✅ `claude_client.py`、`inference.py` |
| Jinja2 | 3.1.4 | ✅ `prompt_engine.py` |
| pyyaml | 6.0.2 | ✅ `token_tracker.py`、`prompt_engine.py`、`services/counterfactual.py` |
| httpx | 0.27.0 | ✅ `inference.py`（Ollama）、`embeddings.py` |
| python-dotenv | 1.0.1 | ⚠️ **可能未使用**：`app/` 下无 `dotenv` 导入；pydantic-settings 通过 `model_config={"env_file":...}` 直接读 `.env` |
| sse-starlette | 2.1.0 | ⚠️ **可能未使用**：`app/` 下无 `sse_starlette` 导入；项目自实现 `core/streaming.py` |
| uuid6 | 2024.7.10 | ⚠️ **可能未使用**：`app/` 下无 `uuid6` 导入 |

### 3.2 frontend/package.json

| 包 | 版本 | 使用情况 |
|---|---|---|
| react / react-dom | ^18.3.1 | ✅ App.tsx、main.tsx 等 |
| zustand | ^4.5.0 | ✅ 12 个 store |
| d3 | ^7.9.0 | ✅ `CausalGraph.tsx`（动态 import）、`DecisionTreeView.tsx`（静态 import） |
| react-router-dom | ^6.26.0 | ⚠️ **可能未使用**：`frontend/src/` 下未找到任何 `react-router-dom` 导入；导航由 `store/navStore.ts` 实现 |
| 构建工具：vite ^5.3.4、typescript ^5.5.3、@vitejs/plugin-react ^4.3.1、tailwindcss ^3.4.6、postcss ^8.4.39、autoprefixer ^10.4.19、@types/react、@types/react-dom | ✅ 构建/类型链路 |

### 3.3 mcp_server/requirements.txt

| 包 | 版本 | 使用情况 |
|---|---|---|
| mcp | >=1.0 | ✅ `server.py` 使用 `mcp.server.fastmcp.FastMCP` |
| httpx | >=0.27 | ✅ `server.py` 作 HTTP 客户端 |

---

## 4. 语言 / 框架 / 构建工具 / 版本

| 维度 | 选型 | 版本来源 |
|---|---|---|
| 后端语言 | Python 3.12 | `backend/Dockerfile:1` `python:3.12-slim` |
| 后端 Web 框架 | FastAPI 0.115 | requirements.txt |
| LLM SDK | anthropic 0.39 | requirements.txt |
| 模板引擎 | Jinja2 3.1 | requirements.txt |
| 配置 | pydantic-settings 2.5 + pydantic 2.9 | requirements.txt |
| 前端语言 | TypeScript ~5.5 | package.json devDependencies |
| 前端框架 | React 18.3 | package.json |
| 构建工具 | Vite ^5.3.4 | package.json（注：CLAUDE.md 写「Vite 6」，与实际不符） |
| 样式 | Tailwind CSS 3.4 + PostCSS 8.4 + autoprefixer 10.4 | package.json |
| 状态管理 | Zustand 4.5 | package.json |
| 可视化 | D3.js 7.9 | package.json |
| 容器编排 | Docker Compose v3.8 | docker-compose.yml |
| 测试框架 | pytest（不确定版本：requirements.txt 未列出，但 `backend/tests/` 含 `conftest.py`、`backend/.pytest_cache/` 存在） |
| MCP 框架 | mcp ≥ 1.0 | mcp_server/requirements.txt |

---

## 5. 异常文件

### 5.1 超长文件（> 500 行）

| 文件 | 行数 |
|---|---|
| backend/app/services/auto_loop.py | 1890 |
| frontend/src/components/orchestrator/AutoLoopView.tsx | 1770 |
| frontend/src/components/orchestrator/AutonomousDebateView.tsx | 1500 |
| backend/app/routers/orchestrator.py | 1199 |
| frontend/src/services/api.ts | 1104 |
| backend/app/services/counterfactual.py | 995 |
| frontend/src/components/voting/VotingHall.tsx | 879 |
| frontend/src/store/counterfactualStore.ts | 838 |
| frontend/src/store/autoLoopStore.ts | 755 |
| backend/app/services/autonomous_debate.py | 715 |
| backend/app/core/prompt_engine.py | 714 |
| backend/app/core/inference.py | 681 |
| frontend/src/components/orchestrator/FeedbackLoopView.tsx | 620 |
| backend/app/services/voting.py | 619 |
| frontend/src/components/common/SessionBrowser.tsx | 589 |
| backend/app/core/database.py | 589 |
| frontend/src/components/common/ScenarioInput.tsx | 574 |
| frontend/src/components/counterfactual/CounterfactualView.tsx | 502 |
| frontend/src/components/counterfactual/CounterfactualPanel.tsx | 502 |

### 5.2 命名可疑 / 临时产物

- [backend/sweep.log](backend/sweep.log) — 1.3 MB / 12,548 行；按 `.gitignore` 中 `*.log` 不会被提交，但仍残留在工作树。
- 3 份带 `-bak` 后缀的 env 文件：
  - [backend/.env.local.alllocal-bak](backend/.env.local.alllocal-bak)
  - [backend/.env.local.mixed-bak](backend/.env.local.mixed-bak)
  - 加上同目录还有 `.env`、`.env.api`、`.env.example`、`.env.local`、`.env.local.example`、`.env.ollama_only`、`.env.paper2_local` — 共 9 份 env 变体（不确定哪几份还在引用）。
- 3 份带日期后缀的 jsonl 备份：
  - benchmark/scenarios.jsonl.bak.20260515 / .20260516 / .20260517
- 空目录：[backend/app/data/graph_templates/](backend/app/data/graph_templates/)
- 两份说明文档共存：根目录 [Claude.md](Claude.md)（旧）和 [CLAUDE.md](CLAUDE.md)（新，被 Claude Code 自动加载）。不确定旧版是否应删除。

### 5.3 实验产物目录（gitignored，但占用工作树空间）

- `runs/` — 18+ 子目录，按日期 + 实验代号命名（如 `2026-05-13-round2/abl_s1_no_persona_names/`）
- `backend/runs/`、`backend/pilot_runs/` — 同上
- `backend/evaluation/` — 含 baselines/、configs/

### 5.4 TODO / FIXME / HACK / XXX 注释

在 `backend/app/`、`backend/tests/`、`frontend/src/`、`mcp_server/`、`scripts/` 中以 `grep -E '\b(TODO|FIXME|HACK|XXX)\b'` 扫描，**未发现任何匹配**。

### 5.5 外部引用

- `backend/app/research/*.py` 头部注释引用 `../../../../What-If-paper/methodology/Y5_negative_control.md` 等路径，指向仓库外的另一个 `What-If-paper` 项目。**不确定**该外部仓库是否存在以及是否影响构建（运行时未读这些 md，仅作文档指向）。

---

## 6. 备注

- 本报告中所有「可能未使用」的依赖只是基于 `grep` 静态扫描未找到 import，不排除间接引入或被 pydantic-settings 等工具隐式使用。在删除前建议人工二次确认。
- 旧 `Claude.md` 与新 `CLAUDE.md` 的差异未在本次扫描中比对；如需迁移/合并请单独发起任务。
- `frontend/src/main.tsx`、`frontend/index.html` 内容未在本次扫描中直接读取，按 Vite 约定推断为入口。
