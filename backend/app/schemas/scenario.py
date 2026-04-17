"""Generic scenario definition schemas."""

from pydantic import BaseModel, Field


class Variable(BaseModel):
    """A single variable being modified in the scenario."""
    name: str = Field(..., description="Variable name, e.g. 'grain_yield'")
    original_value: str = Field("", description="Original state description")
    modified_value: str = Field(..., description="Modified state, e.g. 'tripled'")
    region: str = Field("global", description="Geographic scope")


class Scenario(BaseModel):
    """A what-if scenario definition."""
    title: str = Field(..., description="Short scenario title")
    hypothesis: str = Field(..., description="The core what-if hypothesis")
    domain: str = Field("general", description="Domain: agriculture, technology, geopolitics, etc.")
    variables: list[Variable] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list, description="Additional constraints or assumptions")
    time_horizon: str = Field("10 years", description="Time scope for analysis")

    def to_context_string(self) -> str:
        """Convert scenario to a readable context string for prompts."""
        parts = [f"假设场景：{self.hypothesis}"]
        if self.variables:
            parts.append("具体变量变化：")
            for v in self.variables:
                parts.append(f"  - {v.name}: {v.original_value} → {v.modified_value} (范围: {v.region})")
        if self.constraints:
            parts.append("额外约束条件：")
            for c in self.constraints:
                parts.append(f"  - {c}")
        parts.append(f"分析时间跨度：{self.time_horizon}")
        return "\n".join(parts)
