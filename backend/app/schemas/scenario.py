from datetime import datetime
from typing import Any

from pydantic import BaseModel


class ScenarioCreate(BaseModel):
    name: str
    description: str | None = None
    graph_data: dict = {}


class ScenarioUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    graph_data: dict | None = None


class ScenarioResponse(BaseModel):
    id: str
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ScenarioDetailResponse(ScenarioResponse):
    graph_data: dict


class ScenarioRunStepResponse(BaseModel):
    id: str
    node_id: str
    node_type: str
    status: str
    input_data: Any | None
    output_data: Any | None
    prompt_used: str | None
    tokens_used: int | None
    started_at: datetime | None
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class ScenarioRunResponse(BaseModel):
    id: str
    scenario_id: str
    status: str
    input_document_ids: list[str]
    result: Any | None
    started_at: datetime | None
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class ScenarioRunDetailResponse(ScenarioRunResponse):
    steps: list[ScenarioRunStepResponse] = []
