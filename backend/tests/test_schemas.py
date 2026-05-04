"""Tests for Pydantic schemas — Scenario, Debate models."""

import pytest
from app.schemas.scenario import Scenario, Variable
from app.schemas.debate import (
    PersonaConfig,
    DebateStartRequest,
    EventInjection,
    PersonaStatement,
    DebateRound,
    DebateSession,
)


class TestVariable:
    def test_basic_variable(self):
        v = Variable(name="grain_yield", modified_value="tripled")
        assert v.name == "grain_yield"
        assert v.modified_value == "tripled"
        assert v.region == "global"  # default

    def test_variable_with_all_fields(self):
        v = Variable(
            name="oil_price",
            original_value="$80/barrel",
            modified_value="$200/barrel",
            region="Middle East",
        )
        assert v.original_value == "$80/barrel"
        assert v.region == "Middle East"


class TestScenario:
    def test_minimal_scenario(self):
        s = Scenario(title="Test", hypothesis="What if X happens?")
        assert s.domain == "general"
        assert s.time_horizon == "10 years"
        assert s.variables == []

    def test_to_context_string_minimal(self):
        s = Scenario(title="Test", hypothesis="粮食产量翻倍")
        ctx = s.to_context_string()
        assert "粮食产量翻倍" in ctx
        assert "分析时间跨度" in ctx

    def test_to_context_string_with_variables(self):
        s = Scenario(
            title="Test",
            hypothesis="粮食产量翻倍",
            variables=[
                Variable(name="yield", original_value="1x", modified_value="2x", region="全球")
            ],
            constraints=["不考虑气候变化"],
        )
        ctx = s.to_context_string()
        assert "yield" in ctx
        assert "1x → 2x" in ctx
        assert "不考虑气候变化" in ctx


class TestDebateSchemas:
    def test_persona_config_defaults(self):
        pc = PersonaConfig(id="imf_economist")
        assert pc.name == ""
        assert pc.custom_prompt == ""

    def test_debate_start_request_defaults(self):
        req = DebateStartRequest(
            scenario_title="测试",
            scenario_hypothesis="假如AI取代所有工作",
        )
        assert req.domain == "general"
        assert req.language == "zh"
        assert req.personas == []

    def test_event_injection(self):
        event = EventInjection(description="严重旱灾袭击东南亚")
        assert event.description == "严重旱灾袭击东南亚"

    def test_persona_statement(self):
        stmt = PersonaStatement(
            persona_id="imf",
            persona_name="IMF经济学家",
            persona_role="分析师",
            content="我的观点是...",
            round_number=1,
        )
        assert stmt.round_number == 1

    def test_debate_round(self):
        dr = DebateRound(round_number=1)
        assert dr.statements == []
        assert dr.injected_event is None

    def test_debate_session(self):
        session = DebateSession(
            session_id="abc123",
            scenario_title="测试",
            scenario_hypothesis="假如...",
            scenario_context="上下文",
            personas=[{"id": "test", "name": "Test", "role": "Analyst"}],
        )
        assert session.current_round == 0
        assert session.status == "active"
        assert session.pending_event is None
