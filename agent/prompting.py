"""System prompt and greeting for the live tutor, built from GET /api/tutor/context/{lesson_id}."""

import lesson_state
import slides
import watch

RULES = """Rules:
- Everything you say is spoken aloud: 1-3 short sentences per turn, no markdown, lists or symbols.
- Put detail (equations, diagrams, steps, plots) on the board with board_write instead of saying it.
- Always say one short sentence before calling board_write, so the student hears you while you write; use at most 8 ops per board_write and split longer working across calls.
- Ops with `step` are HIDDEN until you send reveal_step {group_id, step}; every stepped op needs a `group`; reveal step 1 in the same call, then later steps as you talk.
- Before answering about "this", "that" or "here", call look_at_board first.
- Never say a drawing or progress update worked unless the tool returned ok; if it failed, say so briefly.
- When re-explaining after confusion, pick a style not yet listed as tried, in this order: analogy, diagram, worked example, simpler prerequisite.
- After explaining a knowledge point, ask one short check question, ask the student to answer on the board, then call look_at_board on their answer and respond.
- If you are interrupted, address what the student said before continuing.
- Use mark_progress, note_struggle and note_worked to record how the student is doing.
- While you talk about something on the board, point_at it; the board camera follows what you write."""


def build_instructions(ctx: dict) -> str:
    p = ctx["profile"]
    lines = [
        ctx["tutor"]["style_prompt"],
        "",
        RULES,
        *(r for r in (lesson_state.RULES, watch.RULES, slides.RULES) if r),
        "",
        f"Learner: {p['name']}, prefers {p['style']} explanations, level {p['level']}, pace {p.get('pace', 'normal')}."
        + (f" Notes: {'; '.join(p['notes'])}." if p.get("notes") else ""),
        "",
        f"Track: {ctx['track']['title']}. Knowledge points:",
        *(f"- {kp['kp_id']} [{kp['status']}] {kp['title']}" for kp in ctx["track"]["knowledge_points"]),
    ]
    if ctx.get("recent_lessons"):
        lines += ["", "Last lessons:"]
        for lesson in ctx["recent_lessons"]:
            lines.append(f"- {lesson.get('summary') or '(no summary)'}")
            for s in lesson.get("struggles", []):
                lines.append(f"  struggled: {s['kp_id']}: {s['what']} — tried: {', '.join(s['tried_explanations'])}")
            for w in lesson.get("worked", []):
                lines.append(f"  worked: {w['kp_id']}: {w['explanation_style']}")
    return "\n".join(lines)


def greeting_instruction(ctx: dict) -> str:
    text = f"Greet the student, {ctx['profile']['name']}, by name in one sentence."
    if ctx.get("recent_lessons"):
        text += f" Mention one thing from the last lesson: {ctx['recent_lessons'][0].get('summary', '')}"
    return text + ' Then call show_tab("slides") to open today\'s slides.'
