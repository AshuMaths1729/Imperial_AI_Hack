import json
from pathlib import Path

from prompting import build_instructions, greeting_instruction

CTX = json.loads((Path(__file__).parent / "fixtures/context.json").read_text())


def test_instructions_include_style_and_kps():
    text = build_instructions(CTX)
    assert text.splitlines()[0] == CTX["tutor"]["style_prompt"]
    assert "- m0:n1 [understood] Loss function" in text
    assert "- m0:n3 [not_started] Learning rate" in text
    assert "Alex" in text and "visual" in text
    # rules come after the style prompt and before the KP list
    assert text.index("look_at_board") < text.index("- m0:n1")


def test_instructions_list_tried_explanations():
    text = build_instructions(CTX)
    assert "Last lessons:" in text
    assert "Covered the loss function" in text
    assert "m0:n2: sign of the gradient step — tried: analogy, diagram" in text
    assert "m0:n1: worked example" in text


def test_greeting_mentions_last_lesson_when_present():
    g = greeting_instruction(CTX)
    assert "Alex" in g and "one sentence" in g
    assert "Covered the loss function" in g


def test_greeting_opens_the_slides():
    assert 'show_tab("slides")' in greeting_instruction(CTX)


def test_greeting_mentions_last_lesson_when_absent():
    g = greeting_instruction({**CTX, "recent_lessons": []})
    assert "Alex" in g
    assert "last lesson" not in g.lower()


def test_rules_explain_hidden_steps():
    text = build_instructions(CTX)
    assert "HIDDEN" in text and "reveal_step" in text and "group" in text


def test_rules_speak_before_drawing_and_keep_board_calls_small():
    # A long board_write with no speech first meant ~7 s of silence, and at max_tokens it was cut off entirely.
    from prompting import RULES
    assert "say one short sentence before calling board_write" in RULES
    assert "at most 8 ops" in RULES


def test_voice_llm_has_room_for_step_by_step_board_calls():
    import agent
    assert agent.VOICE_MAX_TOKENS >= 2000
