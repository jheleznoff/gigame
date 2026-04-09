from datetime import datetime

from pydantic import BaseModel


class KBCreate(BaseModel):
    name: str
    description: str | None = None


class KBUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class KBDocumentResponse(BaseModel):
    id: str
    document_id: str
    filename: str
    content_type: str
    size_bytes: int
    chunk_count: int
    status: str
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class KBResponse(BaseModel):
    id: str
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class KBDetailResponse(KBResponse):
    documents: list[KBDocumentResponse] = []
