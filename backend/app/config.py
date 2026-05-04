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

    # Local Model (Ollama) — leave blank to use Claude for everything
    ollama_base_url: str = ""  # e.g. "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b"  # default model tag in Ollama

    # Multi-model pool — comma-separated list of Ollama model tags
    # e.g. "qwen2.5:7b,llama3.1:8b,mistral:7b,yi:6b,gemma2:9b"
    # Each model is assigned to a debate persona for cognitive diversity.
    # If blank, falls back to ollama_model for all personas.
    ollama_model_pool: str = ""

    # Strong backend override — set to "ollama" to use local models for
    # synthesis/analysis too (not recommended for quality, but useful for
    # fully offline experiments). Leave blank to always use Claude.
    strong_backend_override: str = ""  # "ollama" or ""

    # Auto-loop: max sequential feedback loops before stopping
    auto_loop_max_cycles: int = 10
    auto_loop_pause_seconds: float = 5.0

    model_config = {"env_file": ".env", "env_prefix": "WHATIF_"}


@lru_cache()
def get_settings() -> Settings:
    return Settings()
