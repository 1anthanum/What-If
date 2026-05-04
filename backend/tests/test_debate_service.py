"""Tests for DebateRoomService — session management and event injection."""

import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from app.services.debate_room import DebateRoomService, DOMAIN_PERSONA_MAP
from app.schemas.debate import DebateStartRequest, PersonaConfig


class TestDebateRoomService:
    def setup_method(self):
        with patch("app.core.claude_client.get_settings") as mock_s, \
             patch("app.core.token_tracker.get_settings") as mock_t:
            for m in [mock_s, mock_t]:
                m.return_value = MagicMock(
                    anthropic_api_key="sk-test",
                    claude_model="claude-sonnet-4-6",
                    claude_max_tokens=2048,
                    claude_temperature=0.7,
                    cost_per_million_input_tokens=3.0,
                    cost_per_million_output_tokens=15.0,
                )
            self.service = DebateRoomService()

    def test_start_session_creates_session(self):
        request = DebateStartRequest(
            scenario_title="粮食危机",
            scenario_hypothesis="如果全球粮食产量减半",
            domain="agriculture",
        )
        session = self.service.start_session(request)

        assert session.session_id
        assert len(session.session_id) == 8
        assert session.scenario_hypothesis == "如果全球粮食产量减半"
        assert session.current_round == 0
        assert session.status == "active"

    def test_start_session_auto_selects_personas(self):
        request = DebateStartRequest(
            scenario_title="Test",
            scenario_hypothesis="Test hypothesis",
            domain="agriculture",
        )
        session = self.service.start_session(request)

        assert len(session.personas) == 5
        persona_ids = [p["id"] for p in session.personas]
        assert "imf_economist" in persona_ids

    def test_start_session_general_domain_fallback(self):
        request = DebateStartRequest(
            scenario_title="Test",
            scenario_hypothesis="Test hypothesis",
            domain="unknown_domain",
        )
        session = self.service.start_session(request)

        # Should fall back to "general"
        assert len(session.personas) == 5

    def test_start_session_custom_persona(self):
        request = DebateStartRequest(
            scenario_title="Test",
            scenario_hypothesis="Test hypothesis",
            personas=[
                PersonaConfig(id="custom", name="自定义角色", custom_prompt="你是一位历史学家"),
            ],
        )
        session = self.service.start_session(request)

        assert len(session.personas) == 1
        assert session.personas[0]["name"] == "自定义角色"
        assert "历史学家" in session.personas[0]["system_prompt"]

    def test_session_stored_and_retrievable(self):
        request = DebateStartRequest(
            scenario_title="Test",
            scenario_hypothesis="Test hypothesis",
        )
        session = self.service.start_session(request)
        retrieved = self.service.get_session(session.session_id)

        assert retrieved is not None
        assert retrieved.session_id == session.session_id

    def test_get_nonexistent_session(self):
        assert self.service.get_session("nonexistent") is None

    def test_inject_event_success(self):
        request = DebateStartRequest(
            scenario_title="Test",
            scenario_hypothesis="Test",
        )
        session = self.service.start_session(request)

        success = self.service.inject_event(session.session_id, "突发旱灾")
        assert success is True

        retrieved = self.service.get_session(session.session_id)
        assert retrieved.pending_event == "突发旱灾"

    def test_inject_event_nonexistent_session(self):
        assert self.service.inject_event("fake_id", "event") is False

    def test_domain_persona_map_coverage(self):
        for domain in ["agriculture", "technology", "geopolitics", "general"]:
            assert domain in DOMAIN_PERSONA_MAP
            assert len(DOMAIN_PERSONA_MAP[domain]) == 5


class TestDebateRoomServiceAsync:
    @pytest.fixture(autouse=True)
    def setup(self):
        with patch("app.core.claude_client.get_settings") as mock_s, \
             patch("app.core.token_tracker.get_settings") as mock_t:
            for m in [mock_s, mock_t]:
                m.return_value = MagicMock(
                    anthropic_api_key="sk-test",
                    claude_model="claude-sonnet-4-6",
                    claude_max_tokens=2048,
                    claude_temperature=0.7,
                    cost_per_million_input_tokens=3.0,
                    cost_per_million_output_tokens=15.0,
                )
            self.service = DebateRoomService()
            yield

    @pytest.mark.asyncio
    async def test_run_round_nonexistent_session(self):
        events = []
        async for event in self.service.run_round("fake_session"):
            events.append(event)

        assert events[0]["type"] == "error"

    @pytest.mark.asyncio
    async def test_generate_summary_no_data(self):
        result = await self.service.generate_summary("fake_session")
        assert result == "No debate data available."
