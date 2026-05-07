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

    # Tiered model routing — cheaper models for high-frequency cheap tasks,
    # premium models reserved for actual decisions.
    # Format: "provider:model"  (provider ∈ {claude, openai, glm, deepseek, ollama})
    tier_decider:    str = "claude:claude-opus-4-7"           # final calls, branch decisions
    tier_judge:      str = "claude:claude-sonnet-4-6"         # per-round eval, synthesis
    tier_cheap:      str = "claude:claude-haiku-4-5-20251001" # tagging, injection variants

    # ── Multi-provider keys & endpoints ──────────────────────────
    openai_api_key:    str = ""
    openai_base_url:   str = "https://api.openai.com/v1"
    glm_api_key:       str = ""
    glm_base_url:      str = "https://open.bigmodel.cn/api/paas/v4"
    deepseek_api_key:  str = ""
    deepseek_base_url: str = "https://api.deepseek.com/v1"

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

    # Mixed-provider persona pool (preferred over ollama_model_pool).
    # Comma-separated provider:model specs; each persona gets one backend round-robin.
    # e.g. "ollama:qwen2.5:7b,ollama:gemma2:9b,glm:glm-4-flash,deepseek:deepseek-chat,openai:gpt-5-mini"
    persona_pool: str = ""

    # Local summarizer — used for compressing each persona statement into
    # a one-sentence core takeaway shown in the right-side dock. A larger
    # model gives better summaries; qwen3.5:27b is a good default if pulled.
    # Leave blank to fall back to ollama_model.
    ollama_summarizer_model: str = ""

    # Strong backend override — set to "ollama" to use local models for
    # synthesis/analysis too (not recommended for quality, but useful for
    # fully offline experiments). Leave blank to always use Claude.
    strong_backend_override: str = ""  # "ollama" or ""

    # Auto-loop: max sequential feedback loops before stopping
    auto_loop_max_cycles: int = 10
    auto_loop_pause_seconds: float = 5.0

    # .env.local (gitignored) overrides .env — keep secrets like API keys there.
    model_config = {"env_file": (".env", ".env.local"), "env_prefix": "WHATIF_"}


@lru_cache()
def get_settings() -> Settings:
    return Settings()
