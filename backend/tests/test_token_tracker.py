"""Tests for TokenTracker — token usage tracking and cost estimation."""

import pytest
from app.core.token_tracker import TokenTracker, TokenRecord


class TestTokenRecord:
    def test_record_creation(self):
        record = TokenRecord(input_tokens=100, output_tokens=50, label="test")
        assert record.input_tokens == 100
        assert record.output_tokens == 50
        assert record.label == "test"
        assert record.timestamp  # auto-generated

    def test_record_has_utc_timestamp(self):
        record = TokenRecord(input_tokens=0, output_tokens=0, label="")
        assert "T" in record.timestamp  # ISO format


class TestTokenTracker:
    def test_empty_tracker(self, mock_settings):
        tracker = TokenTracker()
        assert tracker.total_input_tokens() == 0
        assert tracker.total_output_tokens() == 0
        assert tracker.estimated_cost_usd() == 0.0

    def test_single_record(self, mock_settings):
        tracker = TokenTracker()
        tracker.record(input_tokens=1000, output_tokens=500, label="call_1")
        assert tracker.total_input_tokens() == 1000
        assert tracker.total_output_tokens() == 500

    def test_multiple_records_accumulate(self, mock_settings):
        tracker = TokenTracker()
        tracker.record(input_tokens=1000, output_tokens=200, label="a")
        tracker.record(input_tokens=2000, output_tokens=300, label="b")
        assert tracker.total_input_tokens() == 3000
        assert tracker.total_output_tokens() == 500

    def test_cost_estimation(self, mock_settings):
        tracker = TokenTracker()
        # 1M input tokens * $3.00 + 1M output tokens * $15.00 = $18.00
        tracker.record(input_tokens=1_000_000, output_tokens=1_000_000, label="big")
        assert tracker.estimated_cost_usd() == 18.0

    def test_cost_estimation_fractional(self, mock_settings):
        tracker = TokenTracker()
        # 1000 input tokens = $0.003, 500 output tokens = $0.0075
        tracker.record(input_tokens=1000, output_tokens=500, label="small")
        cost = tracker.estimated_cost_usd()
        assert cost == pytest.approx(0.0105, abs=0.0001)

    def test_summary_structure(self, mock_settings):
        tracker = TokenTracker()
        tracker.record(input_tokens=100, output_tokens=50, label="test_call")
        summary = tracker.summary()

        assert summary["total_input_tokens"] == 100
        assert summary["total_output_tokens"] == 50
        assert summary["total_api_calls"] == 1
        assert "estimated_cost_usd" in summary
        assert len(summary["records"]) == 1
        assert summary["records"][0]["label"] == "test_call"

    def test_reset_clears_all(self, mock_settings):
        tracker = TokenTracker()
        tracker.record(input_tokens=100, output_tokens=50, label="x")
        tracker.reset()
        assert tracker.total_input_tokens() == 0
        assert len(tracker.records) == 0
