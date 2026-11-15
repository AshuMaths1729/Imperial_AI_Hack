from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    """Base for every shared contract model: unknown fields are errors.

    This is what makes contract drift fail loudly in tests, and it is also what Claude's
    structured outputs need (`additionalProperties: false`).
    """

    # `json_schema_serialization_defaults_required`: in response schemas, fields that have a
    # default are always present, so generated TS types mark them required (e.g. the
    # annotation `type` discriminator).
    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)


# JSON has no NaN/Inf, and the simulation contract forbids them too.
FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]
