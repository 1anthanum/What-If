"""Token usage tracking and cost estimation."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from app.config import get_settings


@dataclass
class TokenRecord:
    """A single API call's token usage."""
    input_tokens: int
    output_tokens: int
    label: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class TokenTracker:
    """Tracks token usage across a session and estimates cost."""

    def __init__(self):
        self.records: list[TokenRecord] = []

    def record(self, input_tokens: int, output_tokens: int, label: str = ""):
        self.records.append(TokenRecord(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            label=label,
        ))

    def total_input_tokens(self) -> int:
        return sum(r.input_tokens for r in self.records)

    def total_output_tokens(self) -> int:
        return sum(r.output_tokens for r in self.records)

    def estimated_cost_usd(self) -> float:
        settings = get_settings()
        input_cost = (self.total_input_tokens() / 1_000_000) * settings.cost_per_million_input_tokens
        output_cost = (self.total_output_tokens() / 1_000_000) * settings.cost_per_million_output_tokens
        return round(input_cost + output_cost, 4)

    def summary(self) -> dict:
        return {
            "total_input_tokens": self.total_input_tokens(),
            "total_output_tokens": self.total_output_tokens(),
            "total_api_calls": len(self.records),
            "estimated_cost_usd": self.estimated_cost_usd(),
            "records": [
                {
                    "label": r.label,
                    "input_tokens": r.input_tokens,
                    "output_tokens": r.output_tokens,
                    "timestamp": r.timestamp,
                }
                for r in self.records
            ],
        }

    def reset(self):
        self.records.clear()
