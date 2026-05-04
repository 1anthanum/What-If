"""Tests for debate API endpoints using FastAPI TestClient."""

import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Create a test client with mocked settings."""
    with patch("app.config.get_settings") as mock:
        settings = MagicMock()
        settings.anthropic_api_key = "sk-test"
        settings.claude_model = "claude-sonnet-4-6"
        settings.claude_max_tokens = 2048
        settings.claude_temperature = 0.7
        settings.cost_per_million_input_tokens = 3.0
        settings.cost_per_million_output_tokens = 15.0
        settings.app_name = "What-If Test"
        settings.debug = True
        settings.cors_origins = ["http://localhost:5173"]
        settings.debate_max_rounds = 20
        settings.debate_default_personas = 5
        settings.debate_max_personas = 8
        settings.causal_max_nodes = 30
        settings.causal_propagation_depth = 4
        mock.return_value = settings

        from app.main import app
        yield TestClient(app)


class TestRootEndpoints:
    def test_root(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        data = resp.json()
        assert "name" in data
        assert data["modules"]["debate_room"] == "active"

    def test_health(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


class TestDebateEndpoints:
    def test_start_debate(self, client):
        resp = client.post("/api/debate/start", json={
            "scenario_title": "测试场景",
            "scenario_hypothesis": "如果AI取代所有工作",
            "domain": "technology",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "session_id" in data
        assert data["status"] == "active"
        assert len(data["personas"]) > 0

    def test_start_debate_minimal(self, client):
        resp = client.post("/api/debate/start", json={
            "scenario_title": "最小测试",
            "scenario_hypothesis": "最小假设",
        })
        assert resp.status_code == 200

    def test_get_session(self, client):
        # Start a session first
        start_resp = client.post("/api/debate/start", json={
            "scenario_title": "Test",
            "scenario_hypothesis": "Hypothesis",
        })
        session_id = start_resp.json()["session_id"]

        # Retrieve it
        resp = client.get(f"/api/debate/{session_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["session_id"] == session_id
        assert data["current_round"] == 0

    def test_get_nonexistent_session(self, client):
        resp = client.get("/api/debate/nonexistent")
        assert resp.status_code == 404

    def test_inject_event(self, client):
        # Start a session
        start_resp = client.post("/api/debate/start", json={
            "scenario_title": "Test",
            "scenario_hypothesis": "Hypothesis",
        })
        session_id = start_resp.json()["session_id"]

        # Inject event
        resp = client.post(f"/api/debate/{session_id}/inject", json={
            "description": "突发旱灾",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "event_queued"

    def test_inject_event_nonexistent_session(self, client):
        resp = client.post("/api/debate/nonexistent/inject", json={
            "description": "event",
        })
        assert resp.status_code == 404

    def test_summary_no_rounds(self, client):
        start_resp = client.post("/api/debate/start", json={
            "scenario_title": "Test",
            "scenario_hypothesis": "Hypothesis",
        })
        session_id = start_resp.json()["session_id"]

        resp = client.get(f"/api/debate/{session_id}/summary")
        assert resp.status_code == 400

    def test_list_personas(self, client):
        resp = client.get("/api/debate/personas/list")
        assert resp.status_code == 200
        personas = resp.json()["personas"]
        assert len(personas) >= 5
