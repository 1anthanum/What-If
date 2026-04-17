"""Application configuration management."""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # API Keys
    anthropic_api_key: str = ""

    # Claude Model Configuration
    claude_model: str = "claude-sonnet-4-6"
    claude_max_tokens: int = 2048
    claude_temperature: float = 0.7

    # Token Cost Tracking (per million tokens, USD)
    cost_per_million_input_tokens: float = 3.00
    cost_per_million_output_tokens: float = 15.00

    # Application Settings
    app_name: str = "What-If Simulation Platform"
    debug: bool = False
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Debate Room Defaults
    debate_max_rounds: int = 20
    debate_default_personas: int = 5
    debate_max_personas: int = 8

    # Causal Graph Defaults
    causal_max_nodes: int = 30
    causal_propagation_depth: int = 4

    model_config = {"env_file": ".env", "env_prefix": "WHATIF_"}


@lru_cache()
def get_settings() -> Settings:
    return Settings()
