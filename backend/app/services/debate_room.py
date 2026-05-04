"""AI Debate Room — core service for multi-persona scenario debates.

Multi-model support:
    When WHATIF_OLLAMA_MODEL_POOL is configured, each persona is backed by
    a different local model (round-robin assignment), producing genuine
    cognitive diversity — different architectures reach different conclusions.
"""

import uuid
from typing import AsyncGenerator

from app.core.claude_client import ClaudeClient
from app.core.inference import InferenceBackend, get_backend_for_persona
from app.core.prompt_engine import PromptEngine
from app.core.streaming import sse_event
from app.core.token_tracker import TokenTracker
from app.schemas.scenario import Scenario, Variable
from app.schemas.debate import (
    DebateStartRequest,
    DebateSession,
    DebateRound,
    PersonaStatement,
    PersonaConfig,
)

# Default personas for auto-selection by domain
DOMAIN_PERSONA_MAP: dict[str, list[str]] = {
    "agriculture": [
        "china_agriculture_minister",
        "us_agribusiness_ceo",
        "indian_smallholder",
        "imf_economist",
        "environmental_activist",
    ],
    "technology": [
        "silicon_valley_ceo",
        "eu_regulator",
        "developing_country_minister",
        "labor_union_leader",
        "academic_researcher",
    ],
    "geopolitics": [
        "us_state_department",
        "china_foreign_ministry",
        "eu_commissioner",
        "un_secretary",
        "defense_analyst",
    ],
    "general": [
        "imf_economist",
        "environmental_activist",
        "developing_country_minister",
        "academic_researcher",
        "industry_executive",
    ],
}


class DebateRoomService:
    """Manages debate sessions: creation, rounds, event injection, summaries."""

    def __init__(self):
        self.tracker = TokenTracker()
        self.claude = ClaudeClient(token_tracker=self.tracker)
        self.prompt_engine = PromptEngine()
        self.sessions: dict[str, DebateSession] = {}

    def start_session(self, request: DebateStartRequest) -> DebateSession:
        """Create a new debate session."""
        session_id = str(uuid.uuid4())[:8]

        # Build scenario
        scenario = Scenario(
            title=request.scenario_title,
            hypothesis=request.scenario_hypothesis,
            domain=request.domain,
            variables=[Variable(**v) for v in request.variables] if request.variables else [],
            constraints=request.constraints,
            time_horizon=request.time_horizon,
        )
        scenario_context = scenario.to_context_string()

        # Resolve personas
        personas = self._resolve_personas(request.personas, request.domain, scenario_context)

        session = DebateSession(
            session_id=session_id,
            scenario_title=request.scenario_title,
            scenario_hypothesis=request.scenario_hypothesis,
            scenario_context=scenario_context,
            personas=personas,
        )

        self.sessions[session_id] = session
        return session

    def _resolve_personas(
        self,
        persona_configs: list[PersonaConfig],
        domain: str,
        scenario_context: str,
    ) -> list[dict]:
        """Resolve persona configs into full persona dicts with system prompts."""
        resolved = []

        if not persona_configs:
            # Auto-select based on domain
            persona_ids = DOMAIN_PERSONA_MAP.get(domain, DOMAIN_PERSONA_MAP["general"])
            persona_configs = [PersonaConfig(id=pid) for pid in persona_ids]

        for config in persona_configs:
            if config.id == "custom" and config.custom_prompt:
                resolved.append({
                    "id": f"custom_{len(resolved)}",
                    "name": config.name or f"自定义角色 {len(resolved) + 1}",
                    "role": "自定义角色",
                    "system_prompt": config.custom_prompt,
                })
            else:
                try:
                    persona_data = self.prompt_engine.load_persona(config.id)
                    system_prompt = self.prompt_engine.render_persona_system_prompt(
                        persona_data, scenario_context
                    )
                    resolved.append({
                        "id": config.id,
                        "name": config.name or persona_data.get("name", config.id),
                        "role": persona_data.get("role", ""),
                        "system_prompt": system_prompt,
                    })
                except FileNotFoundError:
                    # Fallback: create a generic persona
                    resolved.append({
                        "id": config.id,
                        "name": config.name or config.id.replace("_", " ").title(),
                        "role": "分析师",
                        "system_prompt": (
                            f"你是{config.name or config.id.replace('_', ' ').title()}。"
                            f"请从你的专业角度分析以下场景：\n{scenario_context}"
                        ),
                    })

        return resolved

    async def run_round(self, session_id: str) -> AsyncGenerator[dict, None]:
        """Execute one debate round, streaming each persona's response."""
        session = self.sessions.get(session_id)
        if not session:
            yield sse_event("error", {"message": f"Session {session_id} not found"})
            return

        session.current_round += 1
        round_num = session.current_round

        # Gather previous round statements
        previous_statements = []
        if session.rounds:
            last_round = session.rounds[-1]
            previous_statements = [
                {"persona_name": s.persona_name, "content": s.content}
                for s in last_round.statements
            ]

        # Check for pending injected event
        injected_event = session.pending_event
        session.pending_event = None

        current_round = DebateRound(
            round_number=round_num,
            injected_event=injected_event,
        )

        yield sse_event("round_start", {
            "round_number": round_num,
            "injected_event": injected_event,
        })

        # Each persona takes a turn
        for idx, persona in enumerate(session.personas):
            # Select backend for this persona (round-robin from model pool)
            backend: InferenceBackend = get_backend_for_persona(self.tracker, idx)
            model_name = backend.backend_name()

            yield sse_event("persona_start", {
                "persona_id": persona["id"],
                "persona_name": persona["name"],
                "persona_role": persona["role"],
                "model": model_name,
            })

            # Build the user prompt for this persona
            user_prompt = self.prompt_engine.render_debate_user_prompt(
                scenario=session.scenario_hypothesis,
                previous_statements=previous_statements,
                injected_event=injected_event,
                round_number=round_num,
            )

            # Stream the response via the assigned backend
            full_response = []
            async for chunk in backend.stream(
                system_prompt=persona["system_prompt"],
                messages=[{"role": "user", "content": user_prompt}],
                max_tokens=800,
            ):
                full_response.append(chunk)
                yield sse_event("persona_chunk", {
                    "persona_id": persona["id"],
                    "text": chunk,
                })

            content = "".join(full_response)
            statement = PersonaStatement(
                persona_id=persona["id"],
                persona_name=persona["name"],
                persona_role=persona["role"],
                content=content,
                round_number=round_num,
            )
            current_round.statements.append(statement)

            yield sse_event("persona_complete", {
                "persona_id": persona["id"],
                "persona_name": persona["name"],
                "content": content,
            })

        session.rounds.append(current_round)

        yield sse_event("round_complete", {
            "round_number": round_num,
            "statements_count": len(current_round.statements),
            "token_usage": self.tracker.summary(),
        })

    def inject_event(self, session_id: str, event_description: str) -> bool:
        """Queue an event to be injected in the next round."""
        session = self.sessions.get(session_id)
        if not session:
            return False
        session.pending_event = event_description
        return True

    async def generate_summary(self, session_id: str) -> str:
        """Generate an analyst summary of all debate rounds."""
        session = self.sessions.get(session_id)
        if not session or not session.rounds:
            return "No debate data available."

        all_rounds_data = []
        for r in session.rounds:
            round_stmts = [
                {"persona_name": s.persona_name, "content": s.content}
                for s in r.statements
            ]
            all_rounds_data.append(round_stmts)

        analyst_prompt = self.prompt_engine.render_analyst_prompt(
            scenario=session.scenario_hypothesis,
            all_rounds=all_rounds_data,
        )

        summary = await self.claude.complete(
            system_prompt="你是一位中立、严谨的系统分析师，擅长从多方辩论中提炼关键洞察。",
            messages=[{"role": "user", "content": analyst_prompt}],
            max_tokens=1500,
        )

        return summary

    def get_session(self, session_id: str) -> DebateSession | None:
        return self.sessions.get(session_id)

    def get_usage(self) -> dict:
        return self.tracker.summary()
