"""`POST /api/ask-spatial` (Circle-to-Ask) contract, guide §3.3.

The frontend speaks one `Segment` at a time and fires that segment's `ui_annotations` when
it starts, so speech and graphics stay in sync with any voice/avatar implementation.

Annotation coordinates carry a `space`:
  * `node`: anchored to a node or edge id (`target_id`); no x/y needed
  * `data`: plot data coordinates (x/y[/w/h] in axis units)
  * `view`: normalised 0-1 within the captured view (origin top-left)
For rectangles (`circle_region`), x/y is the top-left corner and w/h the size.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.schemas.base import FiniteFloat, StrictModel

View = Literal["sim", "lecture", "hypothesis"]
Space = Literal["node", "data", "view"]
AvatarState = Literal["explaining", "emphatic", "questioning"]


# ----------------------------------------------------------------------------- request
class PlotRange(StrictModel):
    x: tuple[FiniteFloat, FiniteFloat]
    y: tuple[FiniteFloat, FiniteFloat]


class HitMetadata(StrictModel):
    node_ids: list[str] = Field(default_factory=list)
    edge_ids: list[str] = Field(default_factory=list)
    plot_range: PlotRange | None = None
    bbox: tuple[FiniteFloat, FiniteFloat, FiniteFloat, FiniteFloat] | None = Field(
        default=None, description="[x, y, w, h] of the lasso bounding box, in screen pixels"
    )


class ActiveContext(StrictModel):
    view: View
    graph_id: str | None = None
    paper_id: str | None = None
    params: dict[str, FiniteFloat] | None = None


class AskSpatialRequest(StrictModel):
    transcript: str
    cropped_image_base64: str | None = Field(
        default=None, description="PNG of the circled region, downscaled to <= 1024 px"
    )
    hit_metadata: HitMetadata = Field(default_factory=HitMetadata)
    active_context: ActiveContext


# ------------------------------------------------------------------------- annotations
class PulseNode(StrictModel):
    type: Literal["pulse_node"] = "pulse_node"
    id: str = Field(description="Node id")
    label: str | None = None


class HighlightEdge(StrictModel):
    type: Literal["highlight_edge"] = "highlight_edge"
    id: str = Field(description="Edge id")
    label: str | None = None


class _Positional(StrictModel):
    """Annotation placed somewhere; see the module docstring for `space`."""

    space: Space
    target_id: str | None = Field(
        default=None, description='Node or edge id; required when space == "node"'
    )
    x: FiniteFloat | None = None
    y: FiniteFloat | None = None
    label: str | None = None

    def _need_point(self) -> None:
        if self.space == "node":
            if not self.target_id:
                raise ValueError('target_id is required when space == "node"')
        elif self.x is None or self.y is None:
            raise ValueError(f'x and y are required when space == "{self.space}"')


class DrawArrow(_Positional):
    type: Literal["draw_arrow"] = "draw_arrow"

    @model_validator(mode="after")
    def _check(self) -> DrawArrow:
        self._need_point()
        return self


class CircleRegion(_Positional):
    type: Literal["circle_region"] = "circle_region"
    w: FiniteFloat | None = None
    h: FiniteFloat | None = None

    @model_validator(mode="after")
    def _check(self) -> CircleRegion:
        self._need_point()
        if self.space != "node" and (self.w is None or self.h is None):
            raise ValueError(f'w and h are required when space == "{self.space}"')
        return self


class CalloutBox(_Positional):
    type: Literal["callout_box"] = "callout_box"
    label: str  # the callout text (required, unlike the other positional annotations)

    @model_validator(mode="after")
    def _check(self) -> CalloutBox:
        self._need_point()
        return self


class ShowCard(StrictModel):
    type: Literal["show_card"] = "show_card"
    card: str = Field(description='Inspector card to open, e.g. "quiz", "evidence", "slide"')
    id: str | None = Field(default=None, description="Node / edge / page the card is about")


Annotation = Annotated[
    PulseNode | HighlightEdge | DrawArrow | CircleRegion | ShowCard | CalloutBox,
    Field(discriminator="type"),
]


# ---------------------------------------------------------------------------- response
class Segment(StrictModel):
    text: str
    ui_annotations: list[Annotation] = Field(default_factory=list)


class FollowUp(StrictModel):
    type: Literal["quiz"] = "quiz"
    node_id: str


class AskSpatialResponse(StrictModel):
    spoken_answer: str = Field(description="Full text, for captions and fallback TTS")
    segments: list[Segment] = Field(min_length=1)
    follow_up: FollowUp | None = None
    avatar_state: AvatarState | None = None
