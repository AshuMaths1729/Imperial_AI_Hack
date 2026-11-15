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


def test_tutor_can_teach_a_whole_slide_in_one_turn():
    # LiveKit's default (3 tool calls per reply) stops the tutor mid-slide, waiting for the student
    import agent
    import slides
    assert agent.MAX_TOOL_STEPS >= 10
    assert "without waiting" in slides.RULES


RESUME = {"slide": 3, "step": 2, "idea": "A chord's gradient is rise over run.", "lesson_id": "l1",
          "detours": [], "concepts": [], "text": "Lesson state:\nMain: slide 3, step 2 - chords\nNext: slide 3, step 3."}


def test_rules_carry_the_teaching_contract():
    from prompting import RULES
    for phrase in ("Question first", "Concrete before abstract", "One idea per step", "predict",
                   "same picture or analogy", "colour", "Bridge every slide", "25 seconds"):
        assert phrase in RULES, phrase


def test_lesson_state_rules_are_in_the_instructions():
    import lesson_state
    text = build_instructions(CTX)
    assert lesson_state.RULES in text and "detour_start" in text


def test_instructions_include_where_the_last_lesson_stopped():
    text = build_instructions({**CTX, "resume": RESUME})
    assert "Where the last lesson stopped" in text and "Main: slide 3, step 2 - chords" in text
    assert "Where the last lesson stopped" not in build_instructions(CTX)


def test_greeting_resumes_from_the_saved_slide():
    g = greeting_instruction({**CTX, "resume": RESUME})
    # the agent restores slide and step before the greeting, so the recap points at a picture the student can see
    assert "slide_go" not in g and "already" in g and "slide 3" in g
    assert "rise over run" in g and "Alex" in g


def test_greeting_without_a_saved_slide_starts_at_the_top():
    g = greeting_instruction({**CTX, "resume": {**RESUME, "slide": 0}})
    assert "slide_go" not in g and 'show_tab("slides")' in g


def test_rules_stay_short_for_the_voice_model():
    import lesson_state
    from prompting import RULES
    assert len(RULES) + len(lesson_state.RULES) < 4000


def test_voice_llm_makes_one_tool_call_at_a_time():
    # live: three slide_step calls fired at once (steps 1, 3, 2) and broke the pacing
    import agent
    assert agent.VoiceLLM(model="claude-haiku-5-5")._opts.parallel_tool_calls is False


def test_rules_forbid_narrating_the_machinery():
    from prompting import RULES
    assert "never mention slides, steps or tools" in RULES.lower()


def test_voice_llm_answers_without_thinking_and_the_first_call_has_room():
    # measured live: Haiku 5.5's default thinking made each reply start ~3 s late (~1 s without); the first,
    # cache-writing call takes 5-9 s and hit the 10 s default timeout
    import agent
    assert agent.VoiceLLM.EXTRA["thinking"] == {"type": "disabled"}
    assert agent.LLM_TIMEOUT_S >= 20
