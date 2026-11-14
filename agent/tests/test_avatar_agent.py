import json

from avatar_agent import avatar_ids, instructions, parse_meta

KENJI, ANNA = "kenji-id", "anna-id"
TUTORS = [
    {"tutor_id": "a", "name": "A", "avatar_id": KENJI, "voice_id": "v1", "style_prompt": "Style A."},
    {"tutor_id": "b", "name": "B", "avatar_id": ANNA, "voice_id": "v2", "style_prompt": "Style B."},
    {"tutor_id": "c", "name": "C", "avatar_id": KENJI, "voice_id": "v3", "style_prompt": "Style C."},
]


def test_parse_meta():
    active, tutors = parse_meta(json.dumps({"tutor_id": "b", "tutors": TUTORS}))
    assert active == "b"
    assert list(tutors) == ["a", "b", "c"]


def test_avatar_ids_put_active_first_and_dedupe():
    _, tutors = parse_meta(json.dumps({"tutor_id": "b", "tutors": TUTORS}))
    assert avatar_ids(tutors, "b") == [ANNA, KENJI]
    assert avatar_ids(tutors, "c") == [KENJI, ANNA]


def test_avatar_ids_capped_at_five():
    many = {str(i): {"avatar_id": f"id{i}"} for i in range(8)}
    assert avatar_ids(many, "7") == ["id7", "id0", "id1", "id2", "id3"]


def test_instructions_keep_persona_and_voice_rules():
    text = instructions(TUTORS[0])
    assert text.startswith("Style A.")
    assert "spoken aloud" in text
