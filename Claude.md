# What-If 宏观模拟平台 — LLM 维护指南

> 本文件面向未来使用 LLM（如 Claude）维护、扩展本项目的开发者。
> 它提供架构概览、模块细节、SSE 协议、主题规范和常见陷阱。
> 最后更新：2026-05-04

---

## 1. 项目定位

一个 AI 驱动的宏观场景推演平台。用户输入任意 "what-if" 假设，系统通过多个模块协同探索后果。
后端 Python (FastAPI) + 前端 React (Vite + TypeScript + Zustand)。
LLM 推理同时支持 Claude API 和本地 Ollama 模型。

---

## 2. 技术栈

| 层 | 技术 | 备注 |
|---|---|---|
| 后端框架 | FastAPI | 异步，SSE 流式 |
| LLM SDK | anthropic (Claude API) | 支持 streaming |
| 本地 LLM | Ollama (httpx 调用) | 可选，Qwen2.5/Llama/Mistral 等 |
| Schema | Pydantic v2 + pydantic-settings | 所有请求/响应都有严格类型 |
| 前端框架 | React 18 + Vite 6 | 热更新，ESBuild |
| 状态管理 | Zustand | 5 个独立 store |
| 可视化 | D3.js (因果图)、纯 SVG/CSS (其他) | 无 chart 库依赖 |
| 样式 | Tailwind CSS + 自定义主题 | 深空暖调色系 |
| 部署 | Docker Compose | backend:8000 + frontend:5173 |

---

## 3. 目录结构

```
what-if-simulation/
├── backend/
│   ├── app/
│   │   ├── main.py                       # FastAPI 入口，注册所有 router
│   │   ├── config.py                     # Pydantic Settings，env 前缀 WHATIF_
│   │   ├── core/
│   │   │   ├── claude_client.py          # Anthropic SDK 封装（complete/stream）
│   │   │   ├── inference.py              # InferenceBackend ABC + Claude/Ollama 实现
│   │   │   ├── prompt_engine.py          # Jinja2 模板引擎，所有 LLM prompt 在此
│   │   │   ├── streaming.py              # SSE 工具函数 (sse_event, create_sse_response)
│   │   │   └── token_tracker.py          # Token 用量累计 + 成本估算
│   │   ├── schemas/                      # Pydantic models
│   │   │   ├── scenario.py               # 通用场景 Scenario
│   │   │   ├── debate.py                 # 辩论模块 schema
│   │   │   ├── causal_graph.py           # 因果图 schema
│   │   │   ├── counterfactual.py         # 反事实 + Ensemble + 吸引子 schema
│   │   │   └── orchestration.py          # 编排器 schema
│   │   ├── services/                     # 核心业务逻辑
│   │   │   ├── debate_room.py            # 模块1：AI 辩论室
│   │   │   ├── causal_graph.py           # 模块2：因果图谱
│   │   │   ├── counterfactual.py         # 模块3：历史反事实 + Ensemble 探索
│   │   │   ├── orchestrator.py           # 模块4：跨模块编排器
│   │   │   └── auto_loop.py             # 自主循环探索（历史/哲学双模式）
│   │   ├── routers/                      # API 路由
│   │   │   ├── debate.py
│   │   │   ├── causal.py
│   │   │   ├── counterfactual.py
│   │   │   └── orchestrator.py           # 含 feedback-loop + auto-loop 端点
│   │   └── data/
│   │       └── personas/                 # 角色 YAML 模板
│   ├── requirements.txt
│   └── .env                              # WHATIF_ 前缀环境变量
├── frontend/
│   ├── src/
│   │   ├── App.tsx                       # 4 标签页路由
│   │   ├── main.tsx                      # 入口
│   │   ├── index.css                     # 全局样式 + 动画
│   │   ├── hooks/useSSE.ts               # SSE 连接 hook
│   │   ├── services/api.ts               # API client + 全部类型定义
│   │   ├── store/                        # 5 个 Zustand store
│   │   │   ├── debateStore.ts
│   │   │   ├── causalStore.ts
│   │   │   ├── counterfactualStore.ts
│   │   │   ├── orchestratorStore.ts
│   │   │   └── autoLoopStore.ts
│   │   ├── lib/coneRenderer.ts           # 概率锥渲染算法
│   │   ├── components/common/            # ScenarioInput, CostBadge
│   │   ├── components/debate/            # DebateRoom, PersonaCard, EventInjector
│   │   ├── components/causal/            # CausalGraph (D3), CausalPanel, CausalView
│   │   ├── components/counterfactual/    # Timeline, PossibilityFan, AttractorView 等
│   │   └── components/orchestrator/      # FeedbackLoopView, AutoLoopView, 4 个子面板
│   ├── tailwind.config.js                # 深空暖调主题色彩定义
│   ├── vite.config.ts
│   └── package.json
└── docker-compose.yml
```

---

## 4. 四大核心模块

### 4.1 AI 辩论室 (Debate Room)

**后端**: `services/debate_room.py` → `routers/debate.py`
**前端**: `components/debate/` + `store/debateStore.ts`

功能：
- 用户提交场景 → 系统分配 4-6 个角色（从 YAML 模板加载）
- 回合制辩论：每个角色看到其他人上轮发言后回应
- 支持事件注入（"旱灾来了"），所有角色必须在下一回合回应
- 每回合结束后"分析师"生成摘要（共识/分歧/风险）

API 端点：
- `POST /api/debate/start` — 创建辩论
- `POST /api/debate/{session_id}/round` — 执行一回合（SSE）
- `POST /api/debate/{session_id}/inject` — 注入事件
- `GET /api/debate/{session_id}/summary` — 分析师摘要
- `GET /api/debate/personas/list` — 列出可用角色

### 4.2 因果图谱 (Causal Graph)

**后端**: `services/causal_graph.py` → `routers/causal.py`
**前端**: `components/causal/` + `store/causalStore.ts`

功能：
- Claude 根据场景生成因果节点和边（JSON 格式）
- D3 力导向图可视化，节点按类别着色
- 点击节点 → 输入扰动 → BFS 沿因果链传播 → Claude 评估每个受影响节点

API 端点：
- `POST /api/causal/generate` — 生成因果图（SSE）
- `POST /api/causal/{graph_id}/propagate` — 传播分析（SSE）
- `GET /api/causal/{graph_id}` — 获取图数据

节点类别色彩：经济=#C49058, 社会=#8BA888, 环境=#6EBF8B, 政治=#8B9FBF

### 4.3 历史反事实 (Counterfactual)

**后端**: `services/counterfactual.py` → `routers/counterfactual.py`
**前端**: `components/counterfactual/` + `store/counterfactualStore.ts`

功能：
- 预置历史事件 + 用户修改参数
- 单一时间线生成（SSE 流式）
- **Ensemble 探索**：Haiku ×15 并行发散 → Sonnet 聚类 → Sonnet 精炼 = 可能性扇形图
- **证伪引擎**：对时间线运行对抗性 pass，输出脆弱性评估
- **用户知识注入**：标注错误 + 约束重新生成
- **吸引子检测**：跨多组假设发现收敛结局
- **具身视角**：历史真实人物作为探索代理
- **概率锥可视化**：所有分支叠加为连续概率分布

API 端点：
- `POST /api/counterfactual/generate` — 单一时间线
- `POST /api/counterfactual/explore` — Ensemble 探索
- `POST /api/counterfactual/timelines/{id}/falsify` — 证伪
- `POST /api/counterfactual/timelines/{id}/regenerate` — 约束重生成
- `POST /api/counterfactual/attractors/detect` — 吸引子检测
- `POST /api/counterfactual/explore/embodied` — 具身视角探索

### 4.4 闭环推演 (Orchestrator)

**后端**: `services/orchestrator.py` + `services/auto_loop.py` → `routers/orchestrator.py`
**前端**: `components/orchestrator/` + `store/orchestratorStore.ts` + `store/autoLoopStore.ts`

两种运行模式：

#### 反馈循环 (Feedback Loop)
将三个模块串联：反事实时间线 → 因果图 → 辩论 → 下一轮反事实。
最多 3 轮迭代，可提前收敛。

#### 自主循环探索 (Auto-Loop)
两个子模式：
- **历史模式** (`historical`)：完整 pipeline（反事实→因果→辩论→综合→提取下一假设）
- **哲学模式** (`philosophical`)：5 个哲学 persona 辩论 → 综合 → 提取子问题 → 重复

API 端点：
- `POST /api/orchestrator/feedback-loop` — 反馈循环（SSE）
- `POST /api/orchestrator/auto-loop` — 自主循环（SSE）
- `POST /api/orchestrator/auto-loop/{session_id}/cancel` — 取消

---

## 5. 自主循环高级功能（哲学模式专属）

### 5.1 认知分歧热力图 (Epistemic Divergence Map)

**触发**：`extract_stances: true`
**后端**：`auto_loop.py → _extract_stance_matrix()` 在每轮综合后调用
**前端**：`DivergenceHeatmap.tsx`

每轮辩论结束后，用 strong backend (低温 0.2) 提取 JSON：
```json
{
  "arguments": ["论点1", "论点2", ...],
  "stances": {
    "rationalist": [0.8, -0.5, ...],
    "existentialist": [-0.3, 0.9, ...],
    ...
  }
}
```
分数 -1.0（强烈反对/红色）→ 0（中立/灰色）→ +1.0（强烈支持/蓝色）。

SSE 事件：`phil_stance_matrix` → `{matrix: StanceMatrix}`

### 5.2 对抗性压力测试 (Adversarial Stress Test)

**触发**：`adversarial: true`
**后端**：`auto_loop.py`，两阶段辩论
**前端**：`AutoLoopView.tsx` 中红色 adversary 角色

Phase 1：4 个正常 persona 依次发言
Phase 2：魔鬼代言人（adversary）看到所有 Phase 1 发言，专门攻击最弱论点，给出 1-5 脆弱性评分

SSE 事件：与普通 persona 相同（`phil_persona_start/chunk/complete`），但 persona_id = "adversary"

### 5.3 决策分支树 (Decision Forking Tree)

**触发**：`branching: true`
**后端**：`auto_loop.py → _extract_candidate_questions()`
**前端**：`ForkingTree.tsx`

每轮提取 top-3 候选子问题（正交性最大化），默认选第一个继续。
UI 显示已选路径 + 可展开的未探索分支。

SSE 事件：`candidate_questions` → `{candidates: string[]}`

### 5.4 实时观战面板 (Spectator Panel)

**触发**：始终可用（点击 HUD "观战" 按钮）
**数据来源**：`autoLoopStore` 中累计的 `totalPersonaWords`、`elapsedSeconds`
**前端**：`SpectatorPanel.tsx`

纯前端计算，无额外 API 调用。显示：
- 当前轮/已用时/预计剩余/产出速率
- 各 persona 累计字数条形图
- 活跃 persona 指示器

---

## 6. 推理后端架构

### 6.1 抽象层 (`core/inference.py`)

```
InferenceBackend (ABC)
├── ClaudeBackend  — 封装 anthropic SDK
└── OllamaBackend  — 连接本地 Ollama (httpx NDJSON streaming)
```

### 6.2 工厂函数

| 函数 | 用途 | 返回 |
|---|---|---|
| `get_fast_backend(tracker)` | 高吞吐低成本任务 | Ollama（如有）或 Claude Haiku |
| `get_strong_backend(tracker, model?)` | 高质量分析/综合 | Claude Sonnet（默认）或 Ollama |
| `get_model_pool(tracker)` | 多模型多样性池 | 多个 OllamaBackend 或单个 fast |
| `get_backend_for_persona(tracker, idx)` | 为 persona 分配模型 | pool[idx % len(pool)] |

### 6.3 环境变量

所有环境变量使用 `WHATIF_` 前缀：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `WHATIF_ANTHROPIC_API_KEY` | (必填) | Claude API 密钥 |
| `WHATIF_CLAUDE_MODEL` | `claude-sonnet-4-6` | 默认 Claude 模型 |
| `WHATIF_CLAUDE_MAX_TOKENS` | 2048 | 默认 max_tokens |
| `WHATIF_CLAUDE_TEMPERATURE` | 0.7 | 默认温度 |
| `WHATIF_OLLAMA_BASE_URL` | (空) | Ollama 地址，留空则全部走 Claude |
| `WHATIF_OLLAMA_MODEL` | `qwen2.5:7b` | 单模型 Ollama |
| `WHATIF_OLLAMA_MODEL_POOL` | (空) | 逗号分隔模型池 |
| `WHATIF_STRONG_BACKEND_OVERRIDE` | (空) | 设为 "ollama" 全走本地 |
| `WHATIF_AUTO_LOOP_MAX_CYCLES` | 10 | 自主循环最大轮数 |
| `WHATIF_AUTO_LOOP_PAUSE_SECONDS` | 5.0 | 轮间暂停秒数 |
| `WHATIF_CORS_ORIGINS` | localhost:5173,3000 | CORS 白名单 |

---

## 7. SSE 流式协议

### 7.1 后端发射

```python
from app.core.streaming import sse_event, create_sse_response

# 创建事件
yield sse_event("cycle_start", {"cycle": 1, "hypothesis": "..."})

# 包装为 SSE 响应
return create_sse_response(async_generator)
```

`sse_event()` 返回 `{"type": event_type, "data": {...}}`。
`_sse_wrapper()` 格式化为 `event: {type}\ndata: {json}\n\n`。

**关键**：后端使用 `ev.get("type", "")` 读取事件类型，**不是** `ev.get("event", "")`。这个 bug 曾导致事件丢失。

### 7.2 前端消费

```typescript
import { createSSEStream } from '../services/api';

const stream = createSSEStream('/api/orchestrator/auto-loop', config);
for await (const event of stream) {
  // event = { type: string, data: Record<string, unknown> }
  switch (event.type) {
    case 'cycle_start': ...
  }
}
```

### 7.3 完整 SSE 事件类型清单

#### 辩论模块
`round_start`, `persona_start`, `persona_chunk`, `persona_complete`, `round_complete`, `error`

#### 因果图模块
`generation_start`, `chunk`, `graph_complete`, `propagation_start`, `propagation_complete`, `error`

#### 反事实模块
`generation_start`, `chunk`, `timeline_complete`, `falsify_start`, `falsify_complete`, `constrained_start`, `constrained_complete`, `explore_start`, `diverge_complete`, `cluster_complete`, `explore_complete`, `embodied_start`, `coalition_complete`, `attractor_start`, `fan_progress`, `analysis_start`, `attractor_complete`, `error`

#### 编排器
`loop_start`, `iteration_start`, `counterfactual_done`, `causal_done`, `debate_done`, `iteration_complete`, `convergence_detected`, `loop_complete`, `module_error`, `error`

#### 自主循环
`auto_start`, `cycle_start`, `cycle_complete`, `next_hypothesis`, `auto_converged`, `auto_cancelled`, `auto_complete`, `cycle_error`, `error`

历史模式子事件：`loop_iteration_start`, `loop_counterfactual_done`, `loop_causal_done`, `loop_debate_done`, `loop_iteration_complete`

哲学模式子事件：`phil_persona_start`, `phil_persona_chunk`, `phil_persona_complete`, `phil_debate_done`, `phil_synthesis_done`, `phil_stance_matrix`, `candidate_questions`

---

## 8. 前端状态管理 (Zustand)

5 个独立 store，每个对应一个模块/功能域。

### 8.1 Store 概览

| Store | 文件 | 状态字段数 | 主要职责 |
|---|---|---|---|
| `useDebateStore` | `debateStore.ts` | ~11 | 辩论会话、回合、流式发言 |
| `useCausalStore` | `causalStore.ts` | ~10 | 因果图、节点、传播分析 |
| `useCounterfactualStore` | `counterfactualStore.ts` | ~30+ | 时间线、Ensemble、证伪、吸引子、具身 |
| `useOrchestratorStore` | `orchestratorStore.ts` | ~10 | 反馈循环迭代 |
| `useAutoLoopStore` | `autoLoopStore.ts` | ~20 | 自主循环、persona、高级功能 |

### 8.2 autoLoopStore 关键状态

```typescript
interface AutoLoopState {
  // 配置
  sessionId: string | null;
  config: AutoLoopConfig | null;
  mode: 'historical' | 'philosophical';

  // 运行状态
  status: 'idle' | 'running' | 'complete' | 'cancelled' | 'error';
  currentCycle: number;
  maxCycles: number;
  cycles: CycleState[];       // 每轮的完整数据
  evolutionChain: string[];   // 假设演化链

  // 哲学模式
  activePersonaId: string | null;

  // 高级功能标志
  adversarial: boolean;       // 对抗性压力测试
  extractStances: boolean;    // 认知分歧提取
  branching: boolean;         // 决策分支

  // 观战面板
  totalPersonaWords: Record<string, number>;
  spectatorOpen: boolean;
  elapsedSeconds: number;
}

interface CycleState {
  cycle: number;
  hypothesis: string;
  personas: PhilPersonaState[];    // 每个 persona 的发言内容
  stanceMatrix: StanceMatrix | null;  // 认知分歧矩阵
  candidateQuestions: string[];       // 分支候选
  synthesisPreview: string;
  nextHypothesis: string;
  converged: boolean;
}
```

---

## 9. 深空暖调主题规范

### 9.1 色彩体系

**主色**：amber 系列 — `amber-300 (#D4A574)` 为核心
**背景**：deep 系列 — `deep-900 (#0C0A09)` 为主背景
**功能色**：earth 系列 — green (#6EBF8B), sage (#8BA888), rust (#C47D5A)
**状态色**：ok (green), warn (amber), danger (rust), info (#8B9FBF)

### 9.2 组件样式模式

| 元素 | class |
|---|---|
| 面板容器 | `glass border border-amber-300/[0.06] rounded-lg p-4` |
| 次级面板 | `glass-subtle rounded-lg` |
| 主标题 | `text-sm font-semibold text-white` |
| 副标题 | `text-[10px] font-mono text-amber-300/50 uppercase tracking-wider` |
| 正文 | `text-sm text-deep-100/80` |
| 微标注 | `text-[8px] font-mono text-deep-200/25` |
| 主按钮 | `bg-amber-300/10 text-amber-300 hover:bg-amber-300/20 border border-amber-300/20` |
| 辅助按钮 | `text-deep-200 border border-deep-400/20 hover:border-amber-300/20` |
| 活跃状态 | 添加 `shadow-glow` 或 `border-glow-active` |

### 9.3 动画

```css
/* 定义在 index.css */
fadeIn: 0.5s ease-out           /* 元素进入 */
slideUp: 0.4s ease-out          /* 向上滑入 */
pulse-slow: 3s infinite          /* 缓慢脉动 */
pingSlow: 2s infinite            /* 状态指示灯 */
breathe: 3s ease-in-out infinite /* 呼吸效果 */
sweep: 8s linear infinite        /* 扫描线 */
flowParticle: 15s+ linear infinite /* 粒子飘动 */
```

### 9.4 字体

- 正文：Inter（含中文 fallback Noto Sans SC）
- 代码/标注：JetBrains Mono

### 9.5 禁止的样式

**绝对不要使用**：neon 色（#00ff00 等）、cyber- 前缀、void- 前缀、饱和荧光色。
这个项目的视觉语言是"深空中的温暖灯火"，不是赛博朋克。

---

## 10. 哲学 Persona 系统

5 个核心 persona + 1 个可选 adversary：

| ID | 中文名 | 角色 | 颜色 (前端) |
|---|---|---|---|
| `rationalist` | 理性主义者 | 分析哲学立场 | blue-400 |
| `existentialist` | 存在主义者 | 存在主义立场 | rose-400 |
| `pragmatist` | 实用主义者 | 实用主义立场 | emerald-400 |
| `eastern_philosopher` | 东方哲学家 | 东方哲学立场 | amber-400 |
| `critical_theorist` | 批判理论家 | 批判理论立场 | purple-400 |
| `adversary` | 魔鬼代言人 | 对抗性分析 | red-400 |

每个 persona 的 system prompt 限制 300 字以内回复。
当 adversarial=true 时，第 5 个 persona 被替换为 adversary。

---

## 11. 常见维护任务指南

### 11.1 添加新的 SSE 事件类型

1. **后端**：在 service 的 async generator 中 `yield sse_event("new_event", {...})`
2. **前端 store**：在 `for await` 循环的 `switch` 中添加 `case 'new_event':`
3. **前端 api.ts**：如需新类型，在 `api.ts` 中定义 TypeScript interface

### 11.2 添加新的哲学 Persona

1. 在 `auto_loop.py` 的 `PHILOSOPHICAL_PERSONAS` 数组中添加对象
2. 在 `autoLoopStore.ts` 的 SSE handler 中无需改动（已泛化）
3. 在 `AutoLoopView.tsx` 的 `PERSONA_COLORS` 和 `PERSONA_ICONS` 中添加条目
4. 在 `SpectatorPanel.tsx` 和 `DivergenceHeatmap.tsx` 的 `PERSONA_COLORS`/`PERSONA_LABELS` 中添加条目

### 11.3 添加新的前端模块

1. 创建 `store/newModuleStore.ts`（参考 debateStore 的模式）
2. 创建 `components/newModule/` 目录
3. 在 `api.ts` 中添加 API 方法和类型
4. 在 `App.tsx` 的 `MODULES` 数组中添加标签页
5. 在 `main` 区域添加条件渲染

### 11.4 添加新的历史事件（反事实模块）

在 `services/counterfactual.py` 的预置事件数据中添加：
```python
{
    "id": "new_event",
    "title": "事件标题",
    "year": 1960,
    "summary": "事件描述...",
    "decision_nodes": [
        {"year": 1960, "description": "关键决策1", "actual_outcome": "实际结果"},
        ...
    ]
}
```

### 11.5 切换推理后端

- **全 Claude**：不设 `WHATIF_OLLAMA_BASE_URL`
- **混合**（推荐）：设 Ollama 地址 + 模型池，analysis 走 Claude
- **全本地**：加 `WHATIF_STRONG_BACKEND_OVERRIDE=ollama`（质量会下降）

---

## 12. 已知陷阱与注意事项

### 12.1 SSE 事件键名

`sse_event()` 返回 `{"type": ..., "data": ...}`。
消费端必须用 `event.type` 或 `ev.get("type", "")`。
**不要**用 `event` 或 `ev.get("event", "")`——这是一个曾经存在的 bug。

### 12.2 JSON 提取

所有 LLM 输出 JSON 的提取使用 `_extract_json()` 辅助函数，它会：
1. 尝试直接 `json.loads()`
2. 如失败，搜索 `\`\`\`json ... \`\`\`` 代码块
3. 如再失败，搜索第一个 `{` 到最后一个 `}` 之间的内容

### 12.3 中文字数统计

`autoLoopStore` 中用 `fullContent.length`（字符数）近似词数。
因为中文 1 字符 ≈ 1 词，这对中文内容准确度足够。

### 12.4 Zustand 不可变更新

所有 Zustand store 使用函数式更新 `set((s) => ({...}))`。
更新嵌套的 cycles 数组时，必须先复制数组再修改：
```typescript
set((s) => {
  const updated = [...s.cycles];
  updated[idx] = { ...updated[idx], ...patch };
  return { cycles: updated };
});
```

### 12.5 Tailwind 色彩透明度

大量使用 `/[opacity]` 语法（如 `text-amber-300/40`）。
修改时注意：
- 标题/活跃状态用较高透明度 (60-100%)
- 辅助信息用低透明度 (20-40%)
- 边框/分隔线用极低透明度 (5-10%)

### 12.6 温度参数

| 用途 | 温度 | 原因 |
|---|---|---|
| 结构化 JSON 提取 | 0.2 | 需要可靠格式 |
| 综合/分析 | 0.3-0.5 | 平衡创造性和一致性 |
| 辩论 persona 发言 | 0.7 | 鼓励多样性 |
| Ensemble 发散 | 0.9 | 最大化探索多样性 |

---

## 13. 功能状态矩阵

| 功能 | Phase | 后端 | 前端 | 状态 |
|---|---|---|---|---|
| AI 辩论室 | 1 | ✅ | ✅ | 完成 |
| 因果图谱 | 2 | ✅ | ✅ | 完成 |
| 历史反事实 | 3 | ✅ | ✅ | 完成 |
| Ensemble 探索 | 4 | ✅ | ✅ | 完成 |
| 证伪引擎 | 5 | ✅ | ✅ | 完成 |
| 用户知识注入 | 5 | ✅ | ✅ | 完成 |
| 吸引子检测 | 6 | ✅ | ✅ | 完成 |
| 具身视角 | 6 | ✅ | ✅ | 完成 |
| 跨模块闭环 | 7 | ✅ | ✅ | 完成 |
| 概率锥可视化 | 7 | N/A | ✅ | 完成 |
| 自主循环探索 | 7+ | ✅ | ✅ | 完成 |
| 认知分歧热力图 | 7+ | ✅ | ✅ | 完成 |
| 对抗性压力测试 | 7+ | ✅ | ✅ | 完成 |
| 决策分支树 | 7+ | ✅ | ✅ | 完成 |
| 实时观战面板 | 7+ | N/A | ✅ | 完成 |
| 跨会话记忆 | — | — | — | 已推迟 |

---

## 14. 快速启动

```bash
# 后端
cd backend
cp .env.example .env  # 填入 WHATIF_ANTHROPIC_API_KEY
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 前端
cd frontend
npm install
npm run dev  # → http://localhost:5173

# Docker（一键启动）
docker-compose up --build
```

---

*此文件由 Claude 生成，供未来 LLM 维护参考。*
