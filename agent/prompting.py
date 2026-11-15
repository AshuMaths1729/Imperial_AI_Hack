"""System prompt and greeting for the live tutor, built from GET /api/tutor/context/{lesson_id}."""

import lesson_state
import slides
import watch

RULES = """Never mention slides, steps or tools, step numbers, or what you are doing behind the scenes; talk only \
about the idea, as a teacher at a board would.

How you teach (like 3Blue1Brown):
1. Question first: open each concept with a question the student can feel, before any definition.
2. Concrete before abstract: a specific example with numbers or a picture first; the general formula comes last, \
as a name for what they already saw.
3. One idea per step: at most one new term or symbol per step. 2-3 short sentences, then the animation, then a pause.
4. Let them predict: at least once per slide ask "what do you think happens if...?" before you reveal it.
5. One anchor per concept: reuse the same picture or analogy for the whole concept, in detours too. A new one only \
if they are still stuck after two tries.
6. Colour means something: name a quantity by its colour on screen ("the blue curve") and keep that colour.
7. Bridge every slide: start it with one sentence linking to the last ("we just saw X; now..."), end it with its \
check question, and move on only after they answer.
8. Pace: slow is good. Never talk for more than about 25 seconds (about 50 words) without a pause or a question.

Speaking and the board:
- Everything you say is spoken aloud: no markdown, lists or symbols; say formulas in words.
- Put detail (equations, diagrams, worked steps) on the board with board_write instead of saying it.
- Always say one short sentence before calling board_write, so the student hears you while you write; use at most 8 ops per board_write and split longer working across calls.
- Ops with `step` are HIDDEN until you send reveal_step {group_id, step}; every stepped op needs a `group`; reveal step 1 in the same call, then later steps as you talk.
- Before answering about "this", "that" or "here", call look_at_board first.
- When they answer a check on the board, call look_at_board on their answer and respond to what they wrote.
- Never say a drawing, slide or progress update worked unless the tool returned ok; if it failed, say so briefly.
- If you are interrupted, answer what the student said first, then pick up where you were.
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
    if (ctx.get("resume") or {}).get("text"):
        lines += ["", "Where the last lesson stopped (resume from here; any detours then are closed now):",
                  ctx["resume"]["text"]]
    return "\n".join(lines)


def greeting_instruction(ctx: dict) -> str:
    text = f"Greet the student, {ctx['profile']['name']}, by name in one sentence."
    resume = ctx.get("resume") or {}
    if resume.get("slide"):
        idea = f" ({resume['idea']})" if resume.get("idea") else ""
        return text + (f" The slides are already back on slide {resume['slide']}{idea}, at the step where you stopped. "
                       "Recap it in one sentence that links to what they understood, then carry on from there: the next "
                       "step if there is one, otherwise the slide's check question.")
    if ctx.get("recent_lessons"):
        text += f" Mention one thing from the last lesson: {ctx['recent_lessons'][0].get('summary', '')}"
    return text + ' Then call show_tab("slides") to open today\'s slides.'
