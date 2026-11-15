"""Lesson memory: the main branch (the deck: one idea per slide, in order) and side branches (detours), with the
student's understanding and the chosen visual anchor per concept. Checkpointed into the chat context and to the
backend. Built in v3 WS-1."""

import asyncio
import logging
from typing import Literal

from livekit.agents import llm
from livekit.agents.llm.chat_context import DYNAMIC_INSTRUCTIONS_MESSAGE_ID

logger = logging.getLogger("tutor.lesson")

STATE_ID = "lesson-state"
LEVELS = ("not_yet", "shaky", "got_it")
SHOW_CONCEPTS = 4
SHOW_DETOURS = 2

RULES = """Lesson state (the deck is the main branch; questions off it are detours):
- A "Lesson state" note in your context says where the lesson is, the open detours, how well the student understood \
each concept and its anchor, and what to do next. Follow its "Next".
- When the student asks about something that is not the open slide's idea, call detour_start(topic, why) first, then \
answer it briefly, on this slide or the board. When it is answered, call detour_end(resolved) and do what it returns: \
one sentence linking the detour back to the slide's idea, then carry on from the same slide and step.
- The first time you explain a concept with a picture or analogy, call set_anchor(concept, anchor). Reuse that anchor \
every time the concept comes up, in detours too.
- After every check answer, call mark_understanding(concept, level, evidence): got_it = they explained or applied it \
themselves; shaky = partly right; not_yet = wrong or no idea."""


def _cut(s: str, n: int) -> str:
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


class LessonState:
    def __init__(self, lesson_id: str, post=None, resume: dict | None = None):
        self.lesson_id = lesson_id
        self.post = post  # async (path, body) -> dict: the backend, for checkpoints
        self.slide = 0  # 1-based open slide; 0 = slides not opened yet
        self.step = 0
        self.idea = ""
        self.detours: list[dict] = []  # stack, outermost first: {topic, why, from_slide, from_step, from_idea}
        # normalised concept -> {concept, level, evidence, anchor, tries}; most recently touched last
        self.concepts: dict[str, dict] = {}
        self._lock = asyncio.Lock()  # serialises checkpoint POSTs so an older snapshot never lands last
        self._saved: dict | None = None
        for c in (resume or {}).get("concepts") or []:  # understanding and anchors carry over between lessons
            if c.get("concept"):
                self.concepts[c["concept"].strip().lower()] = {
                    "concept": c["concept"], "level": c.get("level"), "evidence": c.get("evidence") or "",
                    "anchor": c.get("anchor") or "", "tries": c.get("tries") or 0,
                }

    # --- main branch ---------------------------------------------------------------------------------------------

    def note_slide(self, index: int, step: int, idea: str = "") -> None:
        """Called by the slide tools whenever the open slide or step changes."""
        if index != self.slide or idea:
            self.idea = idea
        self.slide, self.step = index, step

    def _main(self) -> tuple[int, int, str]:
        """Where the main branch is: the open slide, or where the outermost detour left it."""
        if self.detours:
            d = self.detours[0]
            return d["from_slide"], d["from_step"], d["from_idea"]
        return self.slide, self.step, self.idea

    # --- side branches -------------------------------------------------------------------------------------------

    async def detour_start(self, topic: str, why: str) -> str:
        self.detours.append({"topic": topic, "why": why, "from_slide": self.slide, "from_step": self.step,
                             "from_idea": self.idea})
        anchor = self._anchor_hint()
        return (f"ok: detour on {topic} (from slide {self.slide}, step {self.step}). Answer it in 2-3 short sentences"
                f"{anchor}, check it landed, then call detour_end.")

    async def detour_end(self, resolved: bool) -> str:
        if not self.detours:
            return f"No detour is open; carry on with slide {self.slide}, step {self.step}."
        d = self.detours.pop()
        idea = d["from_idea"] or "the slide"
        text = ""
        if self.slide != d["from_slide"]:  # a follow-up slide opened during the detour: return to the deck
            text += f"First call slide_go({d['from_slide']})" + (
                f" and slide_step({d['from_step']}). " if d["from_step"] else ". ")
        text += (f"Back to {idea} on slide {d['from_slide']}, step {d['from_step']}: connect what we just saw to it "
                 "in one sentence, then continue.")
        if not resolved:
            text += (f" The detour on {d['topic']} is not resolved: mark_understanding it as shaky or not_yet and "
                     "tell the student you will come back to it.")
        return text

    # --- understanding and anchors ---------------------------------------------------------------------------------

    def _concept(self, concept: str) -> dict:
        key = concept.strip().lower()
        c = self.concepts.pop(key, None) or {"concept": concept.strip(), "level": None, "evidence": "", "anchor": "",
                                             "tries": 0}
        self.concepts[key] = c  # most recently touched last
        return c

    def _anchor_hint(self) -> str:
        anchors = [c for c in self.concepts.values() if c["anchor"]]
        return f', reusing the anchor "{anchors[-1]["anchor"]}"' if anchors else ""

    async def mark_understanding(self, concept: str, level: str, evidence: str) -> str:
        if level not in LEVELS:
            return f"failed: level must be one of {', '.join(LEVELS)}"
        c = self._concept(concept)
        c["level"], c["evidence"] = level, evidence
        if level == "got_it":
            c["tries"] = 0
            return f"ok: {c['concept']} = got_it. Move on: the next step, or the slide's check if not asked yet."
        c["tries"] += 1
        if c["tries"] >= 2:
            return (f"ok: {c['concept']} = {level}, still stuck after {c['tries']} tries. You may pick a new anchor now "
                    "(call set_anchor), or step back to a simpler prerequisite.")
        anchor = f" with the same anchor ({c['anchor']})" if c["anchor"] else ""
        return f"ok: {c['concept']} = {level}. Re-explain it{anchor} from a new angle, smaller steps, then check again."

    async def set_anchor(self, concept: str, anchor: str) -> str:
        c = self._concept(concept)
        c["anchor"] = anchor
        return f'ok: use "{anchor}" for every explanation of {c["concept"]}, in detours too.'

    # --- the note and the checkpoint -------------------------------------------------------------------------------

    def _next(self) -> str:
        if self.detours:
            d = self.detours[-1]
            return (f'finish the detour "{_cut(d["topic"], 40)}" (short, same anchor), then detour_end and bridge back '
                    f"to slide {d['from_slide']}, step {d['from_step']}.")
        if not self.slide:
            return 'show_tab("slides") and open slide 1 with its question.'
        last = next(reversed(self.concepts.values()), None)
        if last and last["level"] in ("not_yet", "shaky"):
            return (f"{_cut(last['concept'], 25)} is {last['level']}: re-explain it with its anchor from a new angle, "
                    "then check again.")
        return (f"slide {self.slide}, step {self.step + 1}. Before slide_go, ask the slide's check and wait for the "
                "answer; bridge into the next slide in one sentence.")

    def context_text(self) -> str:
        """The compact "Lesson state" note the tutor sees every turn."""
        slide, step, idea = self._main()
        lines = ["Lesson state:"]
        lines.append(f"Main: slide {slide}, step {step}" + (f" - {_cut(idea, 120)}" if idea else "")
                     if slide else "Main: slides not opened yet.")
        if self.detours:
            if (self.slide, self.step) != (slide, step):
                lines.append(f"Now: slide {self.slide}, step {self.step} (in a detour)")
            shown = [f'"{_cut(d["topic"], 40)}" ({_cut(d["why"], 20)}) from slide {d["from_slide"]} step {d["from_step"]}'
                     for d in reversed(self.detours[-SHOW_DETOURS:])]
            more = len(self.detours) - SHOW_DETOURS
            lines.append("Detours open, innermost first: " + "; ".join(shown) + (f"; +{more} more" if more > 0 else ""))
        concepts = list(self.concepts.values())[-SHOW_CONCEPTS:]
        if concepts:
            parts = []
            for c in concepts:
                p = f"{_cut(c['concept'], 25)}: {c['level'] or 'not checked'}"
                if c["evidence"] and c["level"] != "got_it":
                    p += f" ({_cut(c['evidence'], 25)})"
                if c["anchor"]:
                    p += f', anchor "{_cut(c["anchor"], 30)}"'
                parts.append(p)
            lines.append("Concepts: " + "; ".join(parts))
        lines.append("Next: " + self._next())
        return "\n".join(lines)

    def snapshot(self) -> dict:
        slide, step, idea = self._main()  # the main branch: a follow-up slide opened in a detour is not a resume point
        return {
            "slide": slide, "step": step, "idea": idea,
            "detours": [dict(d) for d in self.detours],
            "concepts": [dict(c) for c in self.concepts.values()],
            "text": self.context_text(),
        }

    def apply(self, chat: llm.ChatContext) -> bool:
        """Put the note into `chat` as one system message right after the instructions; False if already there."""
        text = self.context_text()
        old = chat.get_by_id(STATE_ID)
        if old is not None and old.text_content == text:
            return False
        items = chat.items
        items[:] = [i for i in items if i.id != STATE_ID]
        pos = 1 if items and items[0].type == "message" and items[0].role in ("system", "developer") else 0
        if pos and len(items) > 1 and items[1].id == DYNAMIC_INSTRUCTIONS_MESSAGE_ID:
            pos = 2
        items.insert(pos, llm.ChatMessage(id=STATE_ID, role="system", content=[text]))
        return True

    async def checkpoint(self, agent) -> None:
        """After every tutor turn and every 60 s: refresh the note in the chat context and save the state.
        Never raises (it runs as a background task). Copy-modify-update has no await before update_chat_ctx
        assigns the new context, so it cannot clobber a concurrent fold or note."""
        try:
            chat = agent.chat_ctx.copy()
            if self.apply(chat):
                await agent.update_chat_ctx(chat)
        except Exception:
            logger.exception("lesson state: chat context update failed")
        if self.post is None:
            return
        async with self._lock:
            snap = self.snapshot()
            if snap == self._saved:
                return
            try:
                await self.post(f"/api/lesson/lessons/{self.lesson_id}/state", snap)
                self._saved = snap
            except Exception as e:
                logger.warning("lesson state: checkpoint not saved (%r)", e)

    def function_tools(self) -> list[llm.FunctionTool | llm.RawFunctionTool]:
        """detour_start, detour_end, mark_understanding, set_anchor."""
        s = self

        @llm.function_tool
        async def detour_start(topic: str, why: str) -> str:
            """Start a side branch: call this BEFORE answering a question that is not the open slide's idea. The lesson remembers the slide and step to come back to.

            Args:
                topic: what the detour is about, a few words (e.g. "what a limit is")
                why: why we are leaving the slide, a few words (e.g. "student asked", "missing prerequisite")
            """
            return await s.detour_start(topic, why)

        @llm.function_tool
        async def detour_end(resolved: bool) -> str:
            """End the innermost detour once it is answered. Returns how to bridge back to the main slide; do exactly that.

            Args:
                resolved: true if the student now gets it, false if it is still unclear (come back to it later)
            """
            return await s.detour_end(resolved)

        @llm.function_tool
        async def mark_understanding(concept: str, level: Literal["not_yet", "shaky", "got_it"], evidence: str) -> str:
            """Record how well the student understands a concept, after every check answer.

            Args:
                concept: the concept, a few words, the same name every time (e.g. "gradient of a line")
                level: got_it = explained or applied it themselves; shaky = partly right; not_yet = wrong or no idea
                evidence: what they said or did, in a few words
            """
            return await s.mark_understanding(concept, level, evidence)

        @llm.function_tool
        async def set_anchor(concept: str, anchor: str) -> str:
            """Record the one picture or analogy you use for a concept, the first time you use it, so you reuse it every time the concept comes up.

            Args:
                concept: the concept, same name as in mark_understanding
                anchor: the picture or analogy, a few words (e.g. "the car's speedometer")
            """
            return await s.set_anchor(concept, anchor)

        return [detour_start, detour_end, mark_understanding, set_anchor]
