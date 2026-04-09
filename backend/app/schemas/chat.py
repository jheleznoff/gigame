from datetime import datetime

from pydantic import BaseModel


class ConversationCreate(BaseModel):
    title: str | None = None
    knowledge_base_id: str | None = None


class ConversationResponse(BaseModel):
    id: str
    title: str
    knowledge_base_id: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageResponse(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    document_ids: list[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class ConversationWithMessages(ConversationResponse):
    messages: list[MessageResponse] = []


class SendMessageRequest(BaseModel):
    content: str
