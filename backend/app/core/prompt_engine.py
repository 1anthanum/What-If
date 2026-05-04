"""Prompt template engine using Jinja2 for persona and scenario management."""

import yaml
from pathlib import Path
from jinja2 import Environment, FileSystemLoader, BaseLoader

# Base directory for data files
DATA_DIR = Path(__file__).parent.parent / "data"
PERSONAS_DIR = DATA_DIR / "personas"
GRAPH_TEMPLATES_DIR = DATA_DIR / "graph_templates"
HISTORICAL_DIR = DATA_DIR / "historical"


class PromptEngine:
    """Manages prompt templates for AI personas and scenario generation."""

    def __init__(self):
        self._jinja_env = Environment(loader=BaseLoader(), autoescape=False)
        self._persona_cache: dict[str, dict] = {}

    def load_persona(self, persona_id: str) -> dict:
        """Load a persona definition from YAML file."""
        if persona_id in self._persona_cache:
            return self._persona_cache[persona_id]

        persona_path = PERSONAS_DIR / f"{persona_id}.yaml"
        if not persona_path.exists():
            raise FileNotFoundError(f"Persona '{persona_id}' not found at {persona_path}")

        with open(persona_path, "r", encoding="utf-8") as f:
            persona = yaml.safe_load(f)

        self._persona_cache[persona_id] = persona
        return persona

    def list_personas(self) -> list[dict]:
        """List all available persona definitions."""
        personas = []
        if PERSONAS_DIR.exists():
            for f in PERSONAS_DIR.glob("*.yaml"):
                try:
                    persona = self.load_persona(f.stem)
                    personas.append({
                        "id": f.stem,
                        "name": persona.get("name", f.stem),
                        "role": persona.get("role", ""),
                        "domain": persona.get("domain", []),
                    })
                except Exception:
                    continue
        return personas

    def render_persona_system_prompt(self, persona: dict, scenario_context: str) -> str:
        """Render a persona's system prompt with scenario context injected."""
        template_str = persona.get("system_prompt_template", DEFAULT_PERSONA_TEMPLATE)
        template = self._jinja_env.from_string(template_str)
        return template.render(
            name=persona.get("name", "Unknown"),
            role=persona.get("role", "Analyst"),
            background=persona.get("background", ""),
            interests=persona.get("interests", ""),
            thinking_style=persona.get("thinking_style", ""),
            language_style=persona.get("language_style", ""),
            scenario_context=scenario_context,
        )

    def render_debate_user_prompt(
        self,
        scenario: str,
        previous_statements: list[dict] | None = None,
        injected_event: str | None = None,
        round_number: int = 1,
    ) -> str:
        """Build the user message for a debate round."""
        parts = [f"当前场景假设：{scenario}\n"]

        if previous_statements:
            parts.append("--- 上一轮各方发言 ---")
            for stmt in previous_statements:
                parts.append(f"【{stmt['persona_name']}】：{stmt['content']}")
            parts.append("--- 发言结束 ---\n")

        if injected_event:
            parts.append(f"⚡ 突发事件：{injected_event}\n")

        parts.append(
            f"这是第 {round_number} 轮讨论。请从你的立场出发，分析当前局势，"
            f"回应其他参与者的观点，并提出你的判断和建议。"
            f"请控制在 300 字以内，重点突出，避免泛泛而谈。"
        )

        return "\n".join(parts)

    def render_analyst_prompt(
        self,
        scenario: str,
        all_rounds: list[list[dict]],
    ) -> str:
        """Build the prompt for the analyst to summarize the debate."""
        parts = [
            "你是一位中立的系统分析师。请基于以下多轮辩论内容，生成结构化摘要。",
            f"\n场景：{scenario}\n",
        ]

        for i, round_stmts in enumerate(all_rounds, 1):
            parts.append(f"=== 第 {i} 轮 ===")
            for stmt in round_stmts:
                parts.append(f"【{stmt['persona_name']}】：{stmt['content']}")

        parts.append(
            "\n请输出以下结构：\n"
            "1. **共识点**：各方基本同意的结论\n"
            "2. **核心分歧**：观点冲突最大的领域\n"
            "3. **风险警示**：被多方提及的潜在风险\n"
            "4. **盲点**：辩论中可能被忽视的重要因素\n"
            "5. **整体评估**：2-3 句话的宏观判断"
        )

        return "\n".join(parts)

    def render_causal_system_prompt(self, domain: str = "general") -> str:
        """Build the system prompt for causal graph generation."""
        return f"""你是一位因果系统分析专家，擅长将复杂假设分解为结构化的因果网络。

你的任务：
1. 分析用户提供的 what-if 场景假设
2. 识别关键因果节点（因素、行为体、结果）
3. 建立节点间的因果关系（正向、负向、复杂）
4. 评估每条因果链的强度、时间滞后和置信度

领域重点：{domain}

输出要求：严格 JSON 格式（不要 markdown、不要解释文字），结构如下：
{{
  "title": "图谱标题",
  "nodes": [
    {{
      "id": "唯一ID（英文小写+下划线）",
      "label": "节点名称（中文）",
      "category": "economic|social|environmental|political",
      "current_state": "当前状态描述",
      "description": "该因素在场景中的角色",
      "importance_score": 0.0到1.0
    }}
  ],
  "edges": [
    {{
      "source": "源节点ID",
      "target": "目标节点ID",
      "relationship": "positive|negative|complex",
      "strength": 0.0到1.0,
      "mechanism": "因果机制说明（中文）",
      "time_lag": "immediate|6months|1year|2years|5years",
      "confidence": 0.0到1.0
    }}
  ]
}}

约束：
- 节点数量：8-25个
- 每个节点至少有1条边
- 图必须是连通的
- 因果机制说明要具体、可量化
- importance_score 反映该节点在整个系统中的关键程度"""

    def render_propagation_prompt(
        self,
        graph_context: str,
        node_label: str,
        perturbation: str,
        depth: int,
    ) -> str:
        """Build the prompt for causal propagation analysis."""
        return f"""你是因果链分析师。请分析以下因果系统中，某个节点被扰动后的级联传播效应。

当前因果图：
{graph_context}

扰动信息：
- 初始节点：{node_label}
- 扰动描述：{perturbation}
- 分析深度：{depth} 层

请按 BFS（广度优先）顺序，逐层分析受影响的节点。对每个受影响节点说明：
1. 它如何被上游变化影响
2. 它会如何影响下游节点
3. 效应的置信度（0-1）

输出严格 JSON 格式：
{{
  "steps": [
    {{
      "node_id": "节点ID",
      "node_label": "节点名称",
      "depth": 1,
      "incoming_effect": "受到的影响描述",
      "outgoing_effects": [{{"target": "下游节点ID", "effect": "影响描述"}}],
      "reasoning": "详细因果推理",
      "confidence": 0.7
    }}
  ],
  "summary": "整体传播效应的2-3句总结",
  "affected_nodes_count": 8,
  "max_depth_reached": 3
}}

要求：
- 只分析确实会被影响的节点，不要牵强附会
- 越深层的效应置信度应递减
- 注意反馈环：如果传播回到初始节点，要特别说明"""

    # ─── Phase 3: Historical Counterfactual ────────────────────

    def render_counterfactual_system_prompt(self) -> str:
        """System prompt for generating counterfactual timelines."""
        return """你是一位历史反事实分析专家，擅长基于严谨的历史学方法论推演"如果历史走了另一条路"的后果。

你的方法论：
1. 尊重历史因果链：每一步推演都必须基于已知的历史因果机制
2. 最小偏离原则：只改变用户指定的变量，其他条件保持历史真实
3. 逐步推演：从改变点出发，沿时间轴逐步推导连锁反应
4. 标注不确定性：越远离改变点，推演的置信度应越低
5. 蝴蝶效应意识：识别可能引发非线性后果的关键分岔点

输出要求：严格 JSON 格式（不要 markdown、不要解释文字），结构如下：
{
  "timeline_points": [
    {
      "year": 1944,
      "actual": "实际历史中发生了什么（简短）",
      "counterfactual": "在修改后的假设下会发生什么",
      "divergence_level": 0.0到1.0,
      "confidence": 0.0到1.0,
      "reasoning": "推理过程",
      "category": "economic|social|environmental|political|military|cultural"
    }
  ],
  "summary": "整体反事实分析的2-3段总结",
  "key_divergences": ["关键分歧点1", "关键分歧点2", ...],
  "butterfly_effects": ["蝴蝶效应1", "蝴蝶效应2", ...]
}

约束：
- timeline_points 应覆盖至少 8-15 个关键时间点
- 早期时间点的 confidence 应较高（0.7-0.9），后期递减（0.3-0.6）
- divergence_level 应随时间推移逐渐增大
- 每个 reasoning 至少 2-3 句话，说明因果逻辑
- butterfly_effects 是那些出人意料但逻辑上合理的远期后果"""

    def render_counterfactual_user_prompt(
        self,
        event_title: str,
        event_description: str,
        key_data_points: list[dict],
        decision_nodes: list[dict],
        modification: str,
        time_horizon: str = "30 years",
    ) -> str:
        """Build the user prompt for counterfactual timeline generation."""
        # Format data points
        data_str = "\n".join(
            f"  - {dp.get('year', '?')}年: {dp.get('metric', '')} = {dp.get('value', '')} (来源: {dp.get('source', '未知')})"
            for dp in key_data_points
        )

        # Format decision nodes
        nodes_str = "\n".join(
            f"  [{dn.get('year', '?')}] {dn.get('title', '')}\n"
            f"    描述: {dn.get('description', '')}\n"
            f"    实际结果: {dn.get('actual_outcome', '')}"
            for dn in decision_nodes
        )

        return f"""历史事件：{event_title}

事件概述：
{event_description}

关键数据点：
{data_str}

关键决策节点：
{nodes_str}

用户的反事实假设：
「{modification}」

时间跨度：从事件起点开始推演 {time_horizon}

请基于以上历史背景和关键数据，在用户的反事实假设下，生成一条完整的反事实时间线。
注意：
- 在每个决策节点处重新推演，考虑修改后的假设如何改变该节点的结果
- 引用具体的历史数据来支撑你的推理
- 特别关注那些可能被"蝴蝶效应"放大的微小变化"""

    def list_historical_events(self) -> list[dict]:
        """List all available historical event packages."""
        events = []
        if HISTORICAL_DIR.exists():
            for f in HISTORICAL_DIR.glob("*.yaml"):
                try:
                    data = self.load_historical_event(f.stem)
                    events.append({
                        "id": f.stem,
                        "title": data.get("title", f.stem),
                        "period": data.get("period", ""),
                        "region": data.get("region", ""),
                        "domain": data.get("domain", ""),
                        "description": data.get("description", "")[:120],
                        "decision_node_count": len(data.get("decision_nodes", [])),
                        "default_modification": data.get("default_modification", ""),
                    })
                except Exception:
                    continue
        return events

    # ─── Ensemble Explore (三阶段 prompt) ────────────────────

    PERSPECTIVES = ["military", "economic", "cultural", "technological", "political"]
    PERSPECTIVE_LABELS = {
        "military": "军事与安全",
        "economic": "经济与贸易",
        "cultural": "文化与意识形态",
        "technological": "技术与创新",
        "political": "政治与外交",
    }

    def render_divergence_prompt(
        self,
        event_summary: str,
        modification: str,
        perspective: str,
    ) -> tuple[str, str]:
        """Stage 1: Haiku 轻量探索 prompt. Returns (system, user)."""
        label = self.PERSPECTIVE_LABELS.get(perspective, perspective)
        system = f"""你是一位专注于{label}领域的历史分析师。
请从{label}角度分析历史事件的反事实可能性。
要求简洁，只输出 JSON，不加任何解释。"""

        user = f"""历史背景：{event_summary}

反事实假设：「{modification}」

请从{label}视角出发，列出 3-5 个最可能的关键分歧点——如果这个假设成立，历史将如何不同。
同时为你的分析分配 3-5 个语义标签（如 trade_disruption, military_balance, cultural_shift 等）。

严格输出 JSON，不要 markdown：
{{
  "divergence_points": ["分歧点1（中文，1-2句话）", "分歧点2", ...],
  "tags": ["标签1", "标签2", ...]
}}

限制在 200 字以内。"""
        return system, user

    def render_cluster_prompt(
        self,
        scenarios_text: str,
        n_clusters: int,
    ) -> tuple[str, str]:
        """Stage 2: Sonnet 聚类 prompt. Returns (system, user)."""
        system = """你是一位历史叙事分析专家。请将多个反事实分歧场景归类为几个不同的"叙事方向"——
即不同的历史走向大类。每个叙事方向应代表一种独特的历史可能性。

严格输出 JSON，不要 markdown。"""

        user = f"""以下是 AI 从不同视角生成的多个反事实分歧场景。
请将它们归类为 {n_clusters} 个叙事方向。

{scenarios_text}

输出 JSON：
{{
  "clusters": [
    {{
      "name": "叙事方向名称（中文，如「东方崛起」）",
      "explanation": "为什么这些场景属于同一方向（1-2句）",
      "exemplar_index": 0,
      "member_indices": [0, 3, 7]
    }}
  ]
}}

要求：
- 每个场景必须归入且仅归入一个簇
- 索引从 0 开始
- exemplar_index 是该簇中最具代表性的场景
- 不同簇的叙事方向应有实质区别"""
        return system, user

    def render_refined_timeline_prompt(
        self,
        event_data: dict,
        modification: str,
        cluster_narrative: str,
        exemplar_points: list[str],
    ) -> tuple[str, str]:
        """Stage 3: Sonnet 精炼 prompt. 复用 counterfactual 时间线 JSON 格式."""
        system = self.render_counterfactual_system_prompt()

        points_text = "\n".join(f"  - {p}" for p in exemplar_points)

        user = f"""历史事件：{event_data.get('title', '')}
事件概述：{event_data.get('description', '')}

反事实假设：「{modification}」

叙事方向：{cluster_narrative}

该方向的关键分歧点：
{points_text}

请沿着「{cluster_narrative}」这个叙事方向，基于上述分歧点，生成一条完整的反事实时间线。
时间线应包含 8-15 个关键时间点，覆盖从事件起点开始的 30 年跨度。

注意：
- 严格围绕「{cluster_narrative}」方向展开推演，不要偏离
- 早期时间点置信度高，后期递减
- 偏离度应随时间推移逐渐增大"""
        return system, user

    # ─── Phase 5: Falsification Engine ────────────────────────

    def render_falsification_prompt(
        self,
        timeline_points: list[dict],
        modification: str,
        event_title: str = "",
    ) -> tuple[str, str]:
        """Build prompt for adversarial falsification of a counterfactual timeline.
        Returns (system, user)."""
        system = """你是一位严谨的对抗性历史学家，专门寻找反事实推演中的逻辑漏洞。

你的任务：审查一条AI生成的反事实时间线，为每个时间点识别最薄弱的因果环节。

评估维度：
1. 因果跳跃：推理中是否存在未经论证的因果链？
2. 遗漏反例：历史上是否有类似假设但产生不同结果的先例？
3. 过度简化：是否忽略了会改变结论的关键约束条件？
4. 确认偏误：推演是否系统性地偏向某个预设方向？
5. 时间尺度错误：因果效应的时间尺度是否合理？

输出严格 JSON 格式（不要 markdown），结构如下：
{
  "vulnerability_points": [
    {
      "year": 1965,
      "claim": "被挑战的反事实主张",
      "attack_vector": "攻击角度（2-3句话说明为什么这个推理有问题）",
      "severity": 0.0到1.0,
      "counter_evidence": "反面证据或历史反例",
      "alternative_outcome": "更可能发生的替代结果"
    }
  ],
  "overall_vulnerability_index": 0.0到1.0,
  "methodology_note": "整体方法论评价（1-2句话）",
  "strongest_claim_year": 1966,
  "weakest_claim_year": 1970
}

约束：
- 为每个时间点都提供评估（即使 severity 很低）
- severity > 0.7 = 严重逻辑问题
- severity 0.4-0.7 = 值得商榷
- severity < 0.4 = 推理基本合理
- overall_vulnerability_index 是所有点 severity 的加权平均
- 你的目标是找问题，但也要公平——好的推理应得到认可"""

        # Format timeline points for the user prompt
        points_text = "\n".join(
            f"  [{tp.get('year', '?')}] 实际：{tp.get('actual', '')}\n"
            f"       反事实：{tp.get('counterfactual', '')}\n"
            f"       推理：{tp.get('reasoning', '')}\n"
            f"       偏离度={tp.get('divergence_level', 0):.1f}  置信度={tp.get('confidence', 0):.1f}"
            for tp in timeline_points
        )

        user = f"""请审查以下反事实时间线：

历史事件：{event_title}
反事实假设：「{modification}」

时间线（共 {len(timeline_points)} 个时间点）：
{points_text}

请对每个时间点进行对抗性分析，找出最薄弱的因果环节。"""
        return system, user

    # ─── Phase 5: User Knowledge Injection ──────────────────

    def render_constrained_timeline_prompt(
        self,
        event_data: dict,
        modification: str,
        original_points: list[dict],
        annotations: list[dict],
        preserve_uncontested: bool = True,
    ) -> tuple[str, str]:
        """Build prompt for regenerating timeline with user constraints.
        Returns (system, user)."""
        system = self.render_counterfactual_system_prompt() + """

额外要求（用户知识注入）：
用户是该领域的专家，已对部分时间点提出了修正意见。你必须：
1. 将用户的修正视为硬性约束——你的新推演必须与用户修正一致
2. 基于用户修正重新推演后续因果链
3. 如果用户修正与你的判断矛盾，遵循用户修正但在 reasoning 中标注你的保留意见
4. 未被用户标注的时间点，如果上游已被修改，也需要相应调整"""

        # Format original points
        orig_text = "\n".join(
            f"  [{tp.get('year', '?')}] 反事实：{tp.get('counterfactual', '')}"
            for tp in original_points
        )

        # Format annotations
        CONSTRAINT_LABELS = {
            "factual_error": "事实错误",
            "missing_factor": "缺失因素",
            "domain_knowledge": "领域知识",
        }
        annot_text = "\n".join(
            f"  [{a.get('year', '?')}] 类型={CONSTRAINT_LABELS.get(a.get('constraint_type', ''), a.get('constraint_type', ''))}\n"
            f"       原始主张：{a.get('original_claim', '')}\n"
            f"       用户修正：{a.get('correction', '')}\n"
            f"       来源说明：{a.get('source_description', '（用户判断）')}"
            for a in annotations
        )

        user = f"""历史事件：{event_data.get('title', '')}
事件概述：{event_data.get('description', '')}
反事实假设：「{modification}」

原始AI时间线：
{orig_text}

━━━ 用户修正（硬性约束）━━━
{annot_text}

请基于用户的修正意见，重新生成反事实时间线。
{'未被用户标注的时间点，如果不受影响可保持原样。' if preserve_uncontested else '请重新评估所有时间点。'}"""
        return system, user

    # ── Attractor Detection Prompts ──────────────────────────

    def render_attractor_analysis_prompt(
        self,
        fan_summaries: list[dict],
        event_title: str,
    ) -> tuple[str, str]:
        """Generate prompt for cross-fan attractor analysis.

        fan_summaries: list of {modification, branches: [{narrative_direction, key_divergences, summary}]}
        """
        system = """你是一名复杂系统分析师，专门研究历史进程中的"吸引子"——无论初始条件如何变化，系统倾向于收敛到的稳定状态。

你的任务是分析多组不同假设下的反事实探索结果，找出跨假设反复出现的结局模式。

分析维度：
1. 收敛吸引子：多组探索中反复出现的相似结局
2. 最早出现年份：这个趋势最早从哪年开始显现
3. 抗变性：即使大幅改变历史假设，这个结局仍然出现的频率
4. 发散结局：仅在特定假设下出现的独特结果

请输出 JSON 格式：
{
  "attractors": [
    {
      "outcome_description": "描述该收敛结局",
      "convergence_score": 0.0-1.0,
      "contributing_fan_indices": [0, 1, 2],
      "earliest_emergence_year": 1975,
      "resistance_to_change": 0.0-1.0
    }
  ],
  "divergent_outcomes": ["仅在特定假设下出现的结局描述"],
  "methodology": "简述分析方法论"
}"""

        fan_text_parts = []
        for i, fan in enumerate(fan_summaries):
            parts = [f"### 假设 {i+1}：{fan['modification']}"]
            for j, branch in enumerate(fan.get("branches", [])):
                parts.append(f"  方向 {j+1}「{branch.get('narrative_direction', '')}」")
                if branch.get("summary"):
                    parts.append(f"    摘要：{branch['summary']}")
                divs = branch.get("key_divergences", [])
                if divs:
                    parts.append(f"    关键分歧：{'; '.join(divs[:3])}")
            fan_text_parts.append("\n".join(parts))

        user = f"""# 历史事件：{event_title}

以下是对同一事件、不同假设的多组 Ensemble 探索结果：

{chr(10).join(fan_text_parts)}

请分析这些探索结果中的吸引子模式——哪些结局无论假设如何变化都反复出现？"""
        return system, user

    # ── Embodied Perspective Prompts ─────────────────────────

    def render_embodied_divergence_prompt(
        self,
        event_summary: str,
        modification: str,
        persona: dict,
    ) -> tuple[str, str]:
        """Stage 1 prompt for embodied exploration: persona-driven divergence."""
        system = f"""你正在扮演 {persona.get('name', '未知人物')}（{persona.get('role', '')}）。

世界观：{persona.get('worldview', '未指定')}
决策风格：{persona.get('decision_style', '未指定')}
已知立场：{'; '.join(persona.get('known_positions', []))}
语言风格：{persona.get('language_style', '直接、务实')}

以这个人物的视角、价值观和利益出发，思考如果历史按照给定假设发展，
你（作为此人物）会做出什么决策，产生什么连锁反应。

请输出 JSON 格式：
{{
  "divergence_points": ["基于此人物视角的3-5个关键分歧点"],
  "tags": ["3-5个语义标签"],
  "persona_reasoning": "此人物为何会做出这些判断的简要推理"
}}"""

        user = f"""历史事件概要：{event_summary}

假设变更：{modification}

请从 {persona.get('name', '此人物')} 的视角分析这个假设会如何改变历史走向。"""
        return system, user

    def render_coalition_cluster_prompt(
        self,
        scenarios_with_personas: list[dict],
        n_clusters: int = 3,
    ) -> tuple[str, str]:
        """Stage 2 prompt for embodied exploration: cluster by actor coalitions."""
        system = f"""你是一名政治联盟分析师。你的任务是将多个历史人物的反事实推演结果按"利益联盟"分组。

不同于按叙事主题聚类，你需要找出哪些历史人物会自然形成联盟——
他们有共同利益、互补能力，或面对共同的对手。

请输出 JSON 格式：
{{
  "coalitions": [
    {{
      "coalition_name": "联盟名称",
      "members": ["人物A", "人物B"],
      "shared_interest": "共同利益描述",
      "conflict_points": ["与其他联盟的冲突点"],
      "coalition_strength": 0.0-1.0,
      "member_indices": [0, 2, 5],
      "representative_index": 0
    }}
  ]
}}

目标分组数：{n_clusters}"""

        scenario_text = []
        for i, s in enumerate(scenarios_with_personas):
            scenario_text.append(
                f"[{i}] {s.get('persona_name', '未知')}（{s.get('persona_role', '')}）\n"
                f"  分歧点：{'; '.join(s.get('divergence_points', [])[:3])}\n"
                f"  标签：{', '.join(s.get('tags', []))}"
            )

        user = f"""以下是不同历史人物对同一假设的分歧探索：

{chr(10).join(scenario_text)}

请按利益联盟分组。"""
        return system, user

    def load_graph_template(self, template_id: str) -> dict:
        """Load a causal graph template from JSON."""
        import json
        template_path = GRAPH_TEMPLATES_DIR / f"{template_id}.json"
        if not template_path.exists():
            raise FileNotFoundError(f"Graph template '{template_id}' not found")
        with open(template_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def load_historical_event(self, event_id: str) -> dict:
        """Load a historical event data package."""
        event_path = HISTORICAL_DIR / f"{event_id}.yaml"
        if not event_path.exists():
            raise FileNotFoundError(f"Historical event '{event_id}' not found")
        with open(event_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)


# Default persona system prompt template
DEFAULT_PERSONA_TEMPLATE = """你是 {{ name }}，{{ role }}。

背景信息：
{{ background }}

你的核心利益与关切：
{{ interests }}

你的思维风格：
{{ thinking_style }}

语言风格要求：
{{ language_style }}

---
当前讨论的场景：
{{ scenario_context }}

请始终从你的角色立场出发，保持角色一致性。你可以质疑其他参与者的观点，但必须给出理由。"""
