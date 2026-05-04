"""Shared test fixtures."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.fixture
def mock_settings():
    """Provide test settings without requiring a real .env file."""
    with patch("app.config.get_settings") as mock:
        settings = MagicMock()
        settings.anthropic_api_key = "sk-test-fake-key"
        settings.claude_model = "claude-sonnet-4-6"
        settings.claude_max_tokens = 2048
        settings.claude_temperature = 0.7
        settings.cost_per_million_input_tokens = 3.00
        settings.cost_per_million_output_tokens = 15.00
        settings.app_name = "What-If Simulation Platform"
        settings.debug = True
        settings.cors_origins = ["http://localhost:5173"]
        settings.debate_max_rounds = 20
        settings.debate_default_personas = 5
        settings.debate_max_personas = 8
        settings.causal_max_nodes = 30
        settings.causal_propagation_depth = 4
        mock.return_value = settings
        yield settings
