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
