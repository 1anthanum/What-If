"""Tests for PromptEngine — persona loading and prompt rendering."""

import pytest
from app.core.prompt_engine import PromptEngine


class TestPromptEngine:
    def setup_method(self):
        self.engine = PromptEngine()

    def test_load_existing_persona(self):
        persona = self.engine.load_persona("imf_economist")
        assert persona["name"] == "IMF首席经济学家"
        assert "role" in persona
        assert "background" in persona

    def test_load_nonexistent_persona_raises(self):
        with pytest.raises(FileNotFoundError):
            self.engine.load_persona("nonexistent_persona_xyz")

    def test_persona_cache(self):
        p1 = self.engine.load_persona("imf_economist")
        p2 = self.engine.load_persona("imf_economist")
        assert p1 is p2  # same object from cache

    def test_list_personas(self):
        personas = self.engine.list_personas()
        assert len(personas) >= 5
        ids = [p["id"] for p in personas]
        assert "imf_economist" in ids
        assert "environmental_activist" in ids

    def test_list_personas_structure(self):
        personas = self.engine.list_personas()
        for p in personas:
            assert "id" in p
            assert "name" in p
            assert "role" in p
            assert "domain" in p

    def test_render_persona_system_prompt(self):
        persona = self.engine.load_persona("imf_economist")
        prompt = self.engine.render_persona_system_prompt(persona, "测试场景")
        assert "IMF首席经济学家" in prompt
        assert "测试场景" in prompt

    def test_render_debate_user_prompt_round1(self):
        prompt = self.engine.render_debate_user_prompt(
            scenario="粮食危机",
            round_number=1,
        )
        assert "粮食危机" in prompt
        assert "第 1 轮" in prompt

    def test_render_debate_user_prompt_with_previous(self):
        prompt = self.engine.render_debate_user_prompt(
            scenario="粮食危机",
            previous_statements=[
                {"persona_name": "经济学家", "content": "我认为..."},
            ],
            round_number=2,
        )
        assert "经济学家" in prompt
        assert "我认为..." in prompt
        assert "上一轮" in prompt

    def test_render_debate_user_prompt_with_event(self):
        prompt = self.engine.render_debate_user_prompt(
            scenario="粮食危机",
            injected_event="严重旱灾袭击东南亚",
            round_number=3,
        )
        assert "突发事件" in prompt
        assert "严重旱灾袭击东南亚" in prompt

    def test_render_analyst_prompt(self):
        prompt = self.engine.render_analyst_prompt(
            scenario="粮食危机",
            all_rounds=[
                [{"persona_name": "经济学家", "content": "观点A"}],
                [{"persona_name": "农民", "content": "观点B"}],
            ],
        )
        assert "共识点" in prompt
        assert "核心分歧" in prompt
        assert "第 1 轮" in prompt
        assert "第 2 轮" in prompt
